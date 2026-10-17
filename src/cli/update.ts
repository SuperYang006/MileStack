import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

export type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export type CommandInvocation = {
  command: string;
  args: readonly string[];
  cwd?: string | undefined;
};

export type CommandRunner = (invocation: CommandInvocation) => CommandResult;

export type UpdateDependencies = {
  resolveEntryPath: () => string;
  runCommand: CommandRunner;
};

export type UpdateOptions = {
  projectPath?: string | undefined;
  check: boolean;
};

const queryTimeoutMs = 60_000;
const installTimeoutMs = 300_000;
const maxCommandOutputBytes = 16 * 1024 * 1024;

export function npmExecutable(platform: NodeJS.Platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function pnpmExecutable(platform: NodeJS.Platform): string {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function defaultRunCommand(invocation: CommandInvocation): CommandResult {
  const isQuery = invocation.args[0] === "prefix" || invocation.args[0] === "view";
  const result = spawnSync(invocation.command, [...invocation.args], {
    ...(invocation.cwd !== undefined ? { cwd: invocation.cwd } : {}),
    encoding: "utf8",
    timeout: isQuery ? queryTimeoutMs : installTimeoutMs,
    maxBuffer: maxCommandOutputBytes,
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
  runCommand: defaultRunCommand,
};

type PackageManager = "npm" | "pnpm";

type EntryLocation =
  | { kind: "npm-global" }
  | { kind: "project-local"; projectRoot: string; packageManager: PackageManager }
  | { kind: "project-local-ambiguous"; projectRoot: string }
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

function classifyEntry(entryPath: string, runCommand: CommandRunner): EntryLocation {
  const prefixResult = runCommand({
    command: npmExecutable(process.platform),
    args: ["prefix", "--global"],
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

function commandFailureDetail(result: CommandResult): string {
  if (result.error?.message !== undefined) {
    return result.error.message;
  }
  const stderr = result.stderr.trim();
  return stderr.length > 0 ? stderr : `退出码 ${result.status ?? "unknown"}`;
}

type LatestVersionQuery = { version: string } | { error: string };

function queryLatestVersion(command: string, runCommand: CommandRunner): LatestVersionQuery {
  const result = runCommand({ command, args: ["view", "milestack", "version"] });
  if (result.status !== 0 || result.error) {
    return { error: commandFailureDetail(result) };
  }
  const matches = result.stdout.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g);
  const version = matches?.at(-1) ?? "";
  if (parseSemver(version) === undefined) {
    return { error: `查询命令返回了无法解析的版本：'${result.stdout.trim()}'` };
  }
  return { version };
}

type LatestEvaluation =
  | { kind: "error"; line: string }
  | { kind: "latest"; latest: string }
  | { kind: "update-available"; latest: string }
  | { kind: "not-newer"; latest: string };

function evaluateLatest(command: string, runCommand: CommandRunner): LatestEvaluation {
  const latest = queryLatestVersion(command, runCommand);
  if ("error" in latest) {
    return { kind: "error", line: `  ✗ 查询最新版本失败：${latest.error}` };
  }
  const comparison = compareSemver(latest.version, runtimeVersion);
  if (comparison === undefined) {
    return {
      kind: "error",
      line: `  ✗ 无法比较当前版本与最新版本（当前：${runtimeVersion}，最新：${latest.version}）；未执行安装。`,
    };
  }
  if (comparison === 0) {
    return { kind: "latest", latest: latest.version };
  }
  if (comparison > 0) {
    return { kind: "update-available", latest: latest.version };
  }
  return { kind: "not-newer", latest: latest.version };
}

type InstallResult = { ok: true } | { ok: false; error: string };

function runInstaller(invocation: CommandInvocation, runCommand: CommandRunner): InstallResult {
  const result = runCommand(invocation);
  if (result.status === 0 && !result.error) {
    return { ok: true };
  }
  return { ok: false, error: commandFailureDetail(result) };
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
  runCommand: CommandRunner,
): ReportSection {
  const lines: string[] = [];

  if (location.kind === "npm-global") {
    lines.push(`  当前版本：${runtimeVersion}`);
    lines.push(`  入口：${entryPath}（npm 全局安装）`);
    const evaluation = evaluateLatest(npmExecutable(process.platform), runCommand);
    if (evaluation.kind === "error") {
      lines.push(evaluation.line);
      return { lines, failed: true };
    }
    lines.push(`  最新版本：${evaluation.latest}`);
    if (evaluation.kind === "latest") {
      lines.push("  ✓ 已是最新版本，未执行安装。");
      return { lines, failed: false };
    }
    if (evaluation.kind === "not-newer") {
      lines.push("  → registry 的最新版本不高于当前版本，未执行安装。");
      return { lines, failed: false };
    }
    if (options.check) {
      lines.push("  → 有可用更新；--check 未执行安装。");
      return { lines, failed: false };
    }
    lines.push("  执行：npm install --global milestack@latest");
    const install = runInstaller(
      {
        command: npmExecutable(process.platform),
        args: ["install", "--global", "milestack@latest"],
      },
      runCommand,
    );
    if (!install.ok) {
      lines.push(`  ✗ 安装失败：${install.error}`);
      return { lines, failed: true };
    }
    lines.push(`  ✓ 升级完成：${runtimeVersion} -> ${evaluation.latest}`);
    lines.push("  提醒：请新开终端后运行 milestack -v 确认版本，并重启 MCP 客户端和 serve。");
    return { lines, failed: false };
  }

  if (location.kind === "project-local") {
    lines.push(`  当前版本：${runtimeVersion}`);
    lines.push(`  入口：${entryPath}（项目内安装：${location.projectRoot}）`);
    const executable =
      location.packageManager === "npm"
        ? npmExecutable(process.platform)
        : pnpmExecutable(process.platform);
    const evaluation = evaluateLatest(executable, runCommand);
    if (evaluation.kind === "error") {
      lines.push(evaluation.line);
      return { lines, failed: true };
    }
    lines.push(`  最新版本：${evaluation.latest}`);
    if (evaluation.kind === "latest") {
      lines.push("  ✓ 已是最新版本，未执行安装。");
      return { lines, failed: false };
    }
    if (evaluation.kind === "not-newer") {
      lines.push("  → registry 的最新版本不高于当前版本，未执行安装。");
      return { lines, failed: false };
    }
    if (options.check) {
      lines.push("  → 有可用更新；--check 未执行安装。");
      return { lines, failed: false };
    }
    const installArgs =
      location.packageManager === "npm"
        ? ["install", "milestack@latest"]
        : ["update", "milestack", "--latest"];
    lines.push(
      `  执行：${location.packageManager} ${installArgs.join(" ")}（目录：${location.projectRoot}）`,
    );
    const install = runInstaller(
      { command: executable, args: installArgs, cwd: location.projectRoot },
      runCommand,
    );
    if (!install.ok) {
      lines.push(`  ✗ 安装失败：${install.error}`);
      return { lines, failed: true };
    }
    lines.push(`  ✓ 升级完成：${runtimeVersion} -> ${evaluation.latest}`);
    lines.push(
      "  提醒：请新开终端后运行 ./node_modules/.bin/milestack -v 确认版本，并重启 MCP 客户端和 serve。",
    );
    lines.push(
      "  说明：本次只升级项目内依赖；若 MCP 配置使用全局命令 milestack，其版本不会改变。",
    );
    return { lines, failed: false };
  }

  lines.push(`  当前版本：${runtimeVersion}`);

  if (location.kind === "project-local-ambiguous") {
    lines.push(`  入口：${entryPath}（项目内安装：${location.projectRoot}）`);
    lines.push(
      "  未执行自动安装：无法确定单一包管理器（需要且只需要 package-lock.json 或 pnpm-lock.yaml 之一）。",
    );
    return { lines, failed: !options.check };
  }
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
    "  未执行自动安装：无法确认当前入口的安装方式；请使用安装该 CLI 的包管理器升级，本命令不会静默改跑 npm。",
  );
  return { lines, failed: !options.check };
}

export function runUpdate(
  options: UpdateOptions,
  output: CliOutput,
  dependencies: UpdateDependencies = defaultUpdateDependencies,
): number {
  const entryPath = dependencies.resolveEntryPath();
  const location = classifyEntry(entryPath, dependencies.runCommand);
  const target = resolveRefreshTarget(options.projectPath);

  const cli = cliUpdateSection(location, entryPath, options, dependencies.runCommand);
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
