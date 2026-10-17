import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  formatProjectAgentInstructions,
  projectAgentInstructionsPath,
} from "../core/agent-instructions.js";
import { resolveDatabasePath } from "../db/paths.js";
import { resolveProjectRoot } from "../project/project-context.js";
import { runtimeVersion } from "../server/runtime-version.js";
import { isInsideDirectory, resolveEntryPath } from "./entry-path.js";
import type { CliOutput } from "./output.js";

export type NpmCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export type NpmRunner = (args: readonly string[]) => NpmCommandResult;

export type UpdateDependencies = {
  resolveEntryPath: () => string;
  runNpm: NpmRunner;
};

export type UpdateOptions = {
  projectPath?: string | undefined;
  check: boolean;
};

const queryTimeoutMs = 60_000;
const installTimeoutMs = 300_000;
const maxNpmOutputBytes = 16 * 1024 * 1024;

export function npmExecutable(platform: NodeJS.Platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

function defaultRunNpm(args: readonly string[]): NpmCommandResult {
  const result = spawnSync(npmExecutable(process.platform), [...args], {
    encoding: "utf8",
    timeout: args[0] === "install" ? installTimeoutMs : queryTimeoutMs,
    maxBuffer: maxNpmOutputBytes,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
}

export const defaultUpdateDependencies: UpdateDependencies = {
  resolveEntryPath,
  runNpm: defaultRunNpm,
};

type EntryLocation =
  | { kind: "npm-global" }
  | { kind: "source-repo"; packageRoot: string }
  | { kind: "pnpm-global" }
  | { kind: "npx" }
  | { kind: "unknown" };

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

function findPackageRoot(
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

// pnpm global installs live at <pnpm home>/global/<major>/node_modules/milestack;
// pnpm link --global resolves into the source checkout instead, so it never
// matches this layout.
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
  const packageIndex = segments.lastIndexOf("milestack");
  if (packageIndex < 3) {
    return false;
  }
  return (
    segments[packageIndex - 1] === "node_modules" &&
    /^\d+$/.test(segments[packageIndex - 2] ?? "") &&
    segments[packageIndex - 3] === "global"
  );
}

function classifyEntry(entryPath: string, runNpm: NpmRunner): EntryLocation {
  const prefixResult = runNpm(["prefix", "--global"]);
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
  return { kind: "unknown" };
}

type Semver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

const semverPattern = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseSemver(value: string): Semver | undefined {
  const match = semverPattern.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const majorText = match[1];
  const minorText = match[2];
  const patchText = match[3];
  if (majorText === undefined || minorText === undefined || patchText === undefined) {
    return undefined;
  }
  const prereleaseText = match[4];
  return {
    major: Number(majorText),
    minor: Number(minorText),
    patch: Number(patchText),
    prerelease: prereleaseText === undefined ? [] : prereleaseText.split("."),
  };
}

function compareSemver(left: string, right: string): number | undefined {
  const leftVersion = parseSemver(left);
  const rightVersion = parseSemver(right);
  if (leftVersion === undefined || rightVersion === undefined) {
    return undefined;
  }
  if (leftVersion.major !== rightVersion.major) {
    return leftVersion.major < rightVersion.major ? -1 : 1;
  }
  if (leftVersion.minor !== rightVersion.minor) {
    return leftVersion.minor < rightVersion.minor ? -1 : 1;
  }
  if (leftVersion.patch !== rightVersion.patch) {
    return leftVersion.patch < rightVersion.patch ? -1 : 1;
  }
  if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length === 0) {
    return 0;
  }
  if (leftVersion.prerelease.length === 0) {
    return 1;
  }
  if (rightVersion.prerelease.length === 0) {
    return -1;
  }
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index];
    const rightIdentifier = rightVersion.prerelease[index];
    if (leftIdentifier === undefined) {
      return -1;
    }
    if (rightIdentifier === undefined) {
      return 1;
    }
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number(leftIdentifier);
      const rightNumber = Number(rightIdentifier);
      if (leftNumber !== rightNumber) {
        return leftNumber < rightNumber ? -1 : 1;
      }
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (leftIdentifier !== rightIdentifier) {
      return leftIdentifier < rightIdentifier ? -1 : 1;
    }
  }
  return 0;
}

function npmFailureDetail(result: NpmCommandResult): string {
  if (result.error?.message !== undefined) {
    return result.error.message;
  }
  const stderr = result.stderr.trim();
  return stderr.length > 0 ? stderr : `退出码 ${result.status ?? "unknown"}`;
}

type LatestVersionQuery = { version: string } | { error: string };

function queryLatestVersion(runNpm: NpmRunner): LatestVersionQuery {
  const result = runNpm(["view", "milestack", "version"]);
  if (result.status !== 0 || result.error) {
    return { error: npmFailureDetail(result) };
  }
  const matches = result.stdout.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g);
  const version = matches?.at(-1) ?? "";
  if (parseSemver(version) === undefined) {
    return { error: `npm view 返回了无法解析的版本：'${result.stdout.trim()}'` };
  }
  return { version };
}

type InstallResult = { ok: true } | { ok: false; error: string };

function installLatest(runNpm: NpmRunner): InstallResult {
  const result = runNpm(["install", "--global", "milestack@latest"]);
  if (result.status === 0 && !result.error) {
    return { ok: true };
  }
  return { ok: false, error: npmFailureDetail(result) };
}

type ProjectRefreshTarget =
  | { kind: "uninitialized"; projectRoot: string }
  | { kind: "initialized"; projectRoot: string; instructionsPath: string };

function resolveRefreshTarget(projectPath: string | undefined): ProjectRefreshTarget {
  const projectRoot = resolveProjectRoot(projectPath);
  let initialized = false;
  try {
    initialized = statSync(resolveDatabasePath(projectRoot)).isFile();
  } catch {
    initialized = false;
  }
  if (!initialized) {
    return { kind: "uninitialized", projectRoot };
  }
  return {
    kind: "initialized",
    projectRoot,
    instructionsPath: path.join(projectRoot, projectAgentInstructionsPath),
  };
}

type ReportSection = {
  lines: string[];
  failed: boolean;
};

function refreshProjectSection(target: ProjectRefreshTarget): ReportSection {
  if (target.kind === "uninitialized") {
    return {
      lines: [
        `  跳过：${target.projectRoot} 未初始化（没有 .milestack/milestack.db），未创建 .milestack。`,
      ],
      failed: false,
    };
  }
  try {
    writeFileSync(
      target.instructionsPath,
      formatProjectAgentInstructions(runtimeVersion),
      "utf8",
    );
    return { lines: [`  ✓ 已刷新 ${target.instructionsPath}`], failed: false };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      lines: [`  ✗ 刷新生成文件失败：${detail}（${target.instructionsPath}）`],
      failed: true,
    };
  }
}

function checkProjectSection(target: ProjectRefreshTarget): ReportSection {
  if (target.kind === "uninitialized") {
    return {
      lines: [
        `  跳过：${target.projectRoot} 未初始化（没有 .milestack/milestack.db），未创建 .milestack。`,
      ],
      failed: false,
    };
  }

  let existing: string;
  try {
    existing = readFileSync(target.instructionsPath, "utf8");
  } catch {
    return {
      lines: [`  ✗ 生成文件不存在，与当前 CLI 的完整生成结果不一致：${target.instructionsPath}`],
      failed: false,
    };
  }
  if (existing === formatProjectAgentInstructions(runtimeVersion)) {
    return {
      lines: [`  ✓ 生成文件与当前 CLI 的完整生成结果一致：${target.instructionsPath}`],
      failed: false,
    };
  }
  return {
    lines: [`  ✗ 生成文件与当前 CLI 的完整生成结果不一致：${target.instructionsPath}`],
    failed: false,
  };
}

function cliUpdateSection(
  location: EntryLocation,
  entryPath: string,
  options: UpdateOptions,
  runNpm: NpmRunner,
): ReportSection {
  const lines: string[] = [];

  if (location.kind === "npm-global") {
    lines.push(`  当前版本：${runtimeVersion}`);
    lines.push(`  入口：${entryPath}（npm 全局安装）`);
    const latest = queryLatestVersion(runNpm);
    if ("error" in latest) {
      lines.push(`  ✗ 查询最新版本失败：${latest.error}`);
      return { lines, failed: true };
    }
    lines.push(`  最新版本：${latest.version}`);
    const comparison = compareSemver(latest.version, runtimeVersion);
    if (comparison === undefined) {
      lines.push("  ✗ 无法比较当前版本与最新版本；未执行安装。");
      return { lines, failed: true };
    }
    if (comparison === 0) {
      lines.push("  ✓ 已是最新版本，未执行安装。");
      return { lines, failed: false };
    }
    if (comparison < 0) {
      lines.push("  → registry 的最新版本不高于当前版本，未执行安装。");
      return { lines, failed: false };
    }
    if (options.check) {
      lines.push("  → 有可用更新；--check 未执行安装。");
      return { lines, failed: false };
    }
    lines.push("  执行：npm install --global milestack@latest");
    const install = installLatest(runNpm);
    if (!install.ok) {
      lines.push(`  ✗ 安装失败：${install.error}`);
      return { lines, failed: true };
    }
    lines.push(`  ✓ 升级完成：${runtimeVersion} -> ${latest.version}`);
    lines.push("  提醒：请新开终端后运行 milestack -v 确认版本，并重启 MCP 客户端和 serve。");
    return { lines, failed: false };
  }

  lines.push(`  当前版本：${runtimeVersion}`);

  if (location.kind === "source-repo") {
    lines.push(`  入口：${entryPath}（源码仓库内）`);
    lines.push(
      `  未执行自动安装：源码仓库入口（含 pnpm link --global）请在该仓库手动执行 pnpm build（仓库：${location.packageRoot}）。`,
    );
    return { lines, failed: !options.check };
  }
  if (location.kind === "pnpm-global") {
    lines.push(`  入口：${entryPath}（pnpm 全局安装）`);
    lines.push(
      "  未执行自动安装：请沿用原来的 pnpm 方式自行升级；本命令不会改跑 npm。",
    );
    return { lines, failed: !options.check };
  }
  if (location.kind === "npx") {
    lines.push(`  入口：${entryPath}（npx 临时副本）`);
    lines.push(
      "  未执行自动安装：如需全局安装，可手动执行 npm install --global milestack@latest（本次未执行）。",
    );
    return { lines, failed: !options.check };
  }
  lines.push(`  入口：${entryPath}`);
  lines.push(
    "  未执行自动安装：无法确认当前入口来自 npm 全局安装；请使用安装该 CLI 的包管理器升级，本命令不会静默改跑 npm。",
  );
  return { lines, failed: !options.check };
}

export function runUpdate(
  options: UpdateOptions,
  output: CliOutput,
  dependencies: UpdateDependencies = defaultUpdateDependencies,
): number {
  const entryPath = dependencies.resolveEntryPath();
  const location = classifyEntry(entryPath, dependencies.runNpm);
  const target = resolveRefreshTarget(options.projectPath);

  const cli = cliUpdateSection(location, entryPath, options, dependencies.runNpm);
  const project = options.check
    ? checkProjectSection(target)
    : refreshProjectSection(target);

  const lines = [
    options.check ? "MileStack update --check（不安装、不写文件）" : "MileStack update",
    "",
    "CLI 自更新：",
    ...cli.lines,
    "",
    "项目生成文件：",
    ...project.lines,
    "",
  ];
  output.writeStdout(lines.join("\n"));

  return cli.failed || project.failed ? 1 : 0;
}
