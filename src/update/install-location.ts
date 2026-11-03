import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { isInsideDirectory } from "../project/path-containment.js";
import {
  npmExecutable,
  pnpmExecutable,
  type CommandRunner,
} from "./command-runner.js";

type PackageManager = "npm" | "pnpm";

export type EntryLocation =
  | { kind: "npm-global" }
  | { kind: "project-local"; projectRoot: string; packageManager: PackageManager }
  | { kind: "project-local-ambiguous"; projectRoot: string }
  | { kind: "source-repo"; packageRoot: string }
  | { kind: "pnpm-global" }
  | { kind: "npx" }
  | { kind: "unknown" };

// The command a developer can run to upgrade this entry, plus the wording
// `milestack update --check` uses for entries it cannot upgrade itself.
export type UpgradeGuidance = {
  command: string | null;
  reason: string;
};

function readPackageName(directory: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(path.join(directory, "package.json"), "utf8"),
    );
    if (typeof parsed === "object" && parsed !== null && "name" in parsed) {
      const name = (parsed as { name?: unknown }).name;
      return typeof name === "string" ? name : undefined;
    }
  } catch {
    // Missing or invalid package.json: keep walking up.
  }
  return undefined;
}

export function findPackageRoot(
  startDirectory: string,
): { packageRoot: string; packageName: string } | undefined {
  let current = path.resolve(startDirectory);
  while (true) {
    const name = readPackageName(current);
    if (name !== undefined) {
      return { packageRoot: current, packageName: name };
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function pathSegments(value: string): string[] {
  return path.resolve(value).split(path.sep).filter((segment) => segment !== "");
}

function isNpxEntry(entryPath: string): boolean {
  return pathSegments(entryPath).includes("_npx");
}

// pnpm global installs live under <pnpm home>/global/<major>/node_modules.
// A real install may resolve through the .pnpm virtual store
// (global/<major>/node_modules/.pnpm/milestack@<version>/node_modules/milestack),
// so without PNPM_HOME the whole global/<major>/node_modules tree counts as an
// install that this command must not touch. pnpm link --global resolves into
// the source checkout instead, so it never matches this layout.
function isPnpmGlobalEntry(entryPath: string): boolean {
  const pnpmHome = process.env["PNPM_HOME"];
  if (
    pnpmHome !== undefined &&
    pnpmHome !== "" &&
    isInsideDirectory(entryPath, path.resolve(pnpmHome))
  ) {
    return true;
  }
  const segments = pathSegments(entryPath);
  return segments.some(
    (segment, index) =>
      segment === "global" &&
      /^\d+$/.test(segments[index + 1] ?? "") &&
      segments[index + 2] === "node_modules",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// True when the project's package.json declares milestack as a regular or
// development dependency, which is what makes a node_modules/milestack entry
// a project-local install this command may upgrade.
function declaresMileStack(projectRoot: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  } catch {
    return false;
  }
  if (!isRecord(parsed)) {
    return false;
  }
  return ["dependencies", "devDependencies"].some((field) => {
    const section = parsed[field];
    return isRecord(section) && Object.prototype.hasOwnProperty.call(section, "milestack");
  });
}

// Walks up the node_modules ancestors of the installed package to find the
// project that declares the dependency.  For pnpm installs the resolved entry
// lives in the virtual store (<project>/node_modules/.pnpm/<pkg>/node_modules/
// milestack), so the declaring package.json is the outer project root, not the
// inner virtual-store directory.
function findDeclaringProjectRoot(packageRoot: string): string | undefined {
  let current = path.dirname(packageRoot);
  while (true) {
    if (path.basename(current) === "node_modules" && declaresMileStack(path.dirname(current))) {
      return path.dirname(current);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

// Only one of the two supported lockfiles may be present: with both, or with
// neither, the package manager is ambiguous and no installer is run.
function detectPackageManager(projectRoot: string): PackageManager | undefined {
  const hasNpmLock = existsSync(path.join(projectRoot, "package-lock.json"));
  const hasPnpmLock = existsSync(path.join(projectRoot, "pnpm-lock.yaml"));
  if (hasNpmLock === hasPnpmLock) {
    return undefined;
  }
  return hasNpmLock ? "npm" : "pnpm";
}

export async function classifyEntry(
  entryPath: string,
  runCommand: CommandRunner,
  signal?: AbortSignal,
): Promise<EntryLocation> {
  const prefixResult = await runCommand({
    command: npmExecutable(process.platform),
    args: ["prefix", "--global"],
    ...(signal !== undefined ? { signal } : {}),
  });
  if (prefixResult.status === 0 && !prefixResult.error) {
    const globalPrefix = prefixResult.stdout.trim();
    if (globalPrefix.length > 0) {
      const globalNodeModules = path.join(
        globalPrefix,
        process.platform === "win32" ? "node_modules" : "lib/node_modules",
      );
      if (isInsideDirectory(entryPath, path.resolve(globalNodeModules))) {
        return { kind: "npm-global" };
      }
    }
  }

  const packageRoot = findPackageRoot(path.dirname(entryPath));
  if (packageRoot === undefined || packageRoot.packageName !== "milestack") {
    return { kind: "unknown" };
  }
  if (path.basename(path.dirname(packageRoot.packageRoot)) !== "node_modules") {
    return { kind: "source-repo", packageRoot: packageRoot.packageRoot };
  }
  if (isNpxEntry(entryPath)) {
    return { kind: "npx" };
  }
  if (isPnpmGlobalEntry(entryPath)) {
    return { kind: "pnpm-global" };
  }
  const projectRoot = findDeclaringProjectRoot(packageRoot.packageRoot);
  if (projectRoot !== undefined) {
    const packageManager = detectPackageManager(projectRoot);
    return packageManager === undefined
      ? { kind: "project-local-ambiguous", projectRoot }
      : { kind: "project-local", projectRoot, packageManager };
  }
  return { kind: "unknown" };
}

// Which package manager can read the registry for this installation. The
// source checkout follows its own lockfile; every other managed install already
// has a known package manager.
export function latestVersionExecutable(
  location: EntryLocation,
  platform: NodeJS.Platform,
): string {
  if (location.kind === "project-local") {
    return location.packageManager === "pnpm"
      ? pnpmExecutable(platform)
      : npmExecutable(platform);
  }
  if (location.kind === "pnpm-global") {
    return pnpmExecutable(platform);
  }
  if (location.kind === "source-repo") {
    return detectPackageManager(location.packageRoot) === "pnpm"
      ? pnpmExecutable(platform)
      : npmExecutable(platform);
  }
  return npmExecutable(platform);
}

// The upgrade route for an entry. `reason` keeps the exact wording
// `milestack update` prints for entries it cannot install itself; `command` is
// the line the Web UI can show beside the version.
export function upgradeGuidance(location: EntryLocation): UpgradeGuidance {
  if (location.kind === "npm-global") {
    return {
      command: "milestack update",
      reason: "npm 全局安装，可运行 milestack update 升级。",
    };
  }
  if (location.kind === "project-local") {
    return {
      command: "milestack update",
      reason: `项目内安装（${location.packageManager}），可运行 milestack update 升级。`,
    };
  }
  if (location.kind === "project-local-ambiguous") {
    return {
      command: null,
      reason:
        "无法确定单一包管理器（需要且只需要 package-lock.json 或 pnpm-lock.yaml 之一）。",
    };
  }
  if (location.kind === "source-repo") {
    return {
      command: "pnpm build",
      reason: `源码仓库入口（含 pnpm link --global）请在该仓库手动执行 pnpm build（仓库：${location.packageRoot}）。`,
    };
  }
  if (location.kind === "pnpm-global") {
    return {
      command: "pnpm update --global milestack --latest",
      reason: "请沿用原来的 pnpm 方式自行升级；本命令不会改跑 npm。",
    };
  }
  if (location.kind === "npx") {
    return {
      command: "npm install --global milestack@latest",
      reason: "如需全局安装，可手动执行 npm install --global milestack@latest（本次未执行）。",
    };
  }
  return {
    command: null,
    reason: "无法确认当前入口的安装方式；请使用安装该 CLI 的包管理器升级，本命令不会静默改跑 npm。",
  };
}
