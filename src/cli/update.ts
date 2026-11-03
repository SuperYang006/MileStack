import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
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
import { createStepReporter, detectStepDisplay, type Step, type StepDisplay, type StepReporter } from "./step-progress.js";

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

export type CommandRunner = (invocation: CommandInvocation) => Promise<CommandResult>;

export type UpdateDependencies = {
  resolveEntryPath: () => string;
  runCommand: CommandRunner;
  // Left unset, taken from the terminal that stdout is attached to.
  display?: StepDisplay;
};

export type UpdateOptions = {
  projectPath?: string | undefined;
  check: boolean;
};

const queryTimeoutMs = 60_000;
const installTimeoutMs = 300_000;
const maxCommandOutputChars = 1024 * 1024;

export function npmExecutable(platform: NodeJS.Platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function pnpmExecutable(platform: NodeJS.Platform): string {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

// Runs without blocking the event loop so the progress display keeps redrawing
// while the package manager works.
function defaultRunCommand(invocation: CommandInvocation): Promise<CommandResult> {
  const isQuery = invocation.args[0] === "prefix" || invocation.args[0] === "view";
  const timeoutMs = isQuery ? queryTimeoutMs : installTimeoutMs;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    let settled = false;
    const settle = (status: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr, ...(failure ? { error: failure } : {}) });
    };
    const keepTail = (current: string, chunk: Buffer) =>
      (current + chunk.toString("utf8")).slice(-maxCommandOutputChars);

    const child = spawn(invocation.command, [...invocation.args], {
      ...(invocation.cwd !== undefined ? { cwd: invocation.cwd } : {}),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      failure = new Error(`命令超过 ${timeoutMs / 1000} 秒未结束，已终止`);
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = keepTail(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = keepTail(stderr, chunk);
    });
    child.on("error", (error) => {
      failure = error;
      settle(null);
    });
    child.on("close", (status) => settle(status));
  });
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

async function classifyEntry(entryPath: string, runCommand: CommandRunner): Promise<EntryLocation> {
  const prefixResult = await runCommand({
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

const failureOutputLineLimit = 20;

// The package manager's own words, last lines first-class: the cause of a
// failure is almost always at the end.
function failureOutputLines(result: CommandResult): string[] {
  if (result.error?.message !== undefined) {
    return [result.error.message];
  }
  const lines = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return [`退出码 ${result.status ?? "unknown"}`];
  }
  return lines.slice(-failureOutputLineLimit);
}

type LatestVersionQuery = { version: string } | { error: string; outputLines: string[] };

async function queryLatestVersion(
  command: string,
  runCommand: CommandRunner,
): Promise<LatestVersionQuery> {
  const result = await runCommand({ command, args: ["view", "milestack", "version"] });
  if (result.status !== 0 || result.error) {
    return { error: "查询失败", outputLines: failureOutputLines(result) };
  }
  const matches = result.stdout.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g);
  const version = matches?.at(-1) ?? "";
  if (parseSemver(version) === undefined) {
    return {
      error: "返回了无法解析的版本",
      outputLines: [`查询命令返回了无法解析的版本：'${result.stdout.trim()}'`],
    };
  }
  return { version };
}

type LatestEvaluation =
  | { kind: "error"; detail: string; outputLines: string[] }
  | { kind: "latest"; latest: string }
  | { kind: "update-available"; latest: string }
  | { kind: "not-newer"; latest: string };

async function evaluateLatest(
  command: string,
  runCommand: CommandRunner,
): Promise<LatestEvaluation> {
  const latest = await queryLatestVersion(command, runCommand);
  if ("error" in latest) {
    return { kind: "error", detail: latest.error, outputLines: latest.outputLines };
  }
  const comparison = compareSemver(latest.version, runtimeVersion);
  if (comparison === undefined) {
    return {
      kind: "error",
      detail: "无法比较版本",
      outputLines: [
        `无法比较当前版本与最新版本（当前：${runtimeVersion}，最新：${latest.version}）；未执行安装。`,
      ],
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

// How one step ended. failsRun is separate from the glyph because a --check
// mismatch is shown as a failure without changing the exit code.
type StepOutcome = {
  state: "done" | "failed" | "skipped";
  detail: string;
  notes: string[];
  failsRun: boolean;
};

function recordOutcome(reporter: StepReporter, step: Step, outcome: StepOutcome): void {
  if (outcome.state === "done") {
    reporter.succeed(step, outcome.detail, outcome.notes);
  } else if (outcome.state === "failed") {
    reporter.fail(step, outcome.detail, outcome.notes);
  } else {
    reporter.skip(step, outcome.detail, outcome.notes);
  }
}

// The CLI that the installer just put on disk. The running process still holds
// the code of the version it was started from, so it must not generate files
// for the new version itself.
type InstalledCli = { entryPath: string; version: string };

// Set once the installer succeeded; installedCli is undefined when the new CLI
// could not be located afterwards.
type Upgrade = { installedCli: InstalledCli | undefined; latest: string };

function readInstalledCli(packageRoot: string): InstalledCli | undefined {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    );
    if (!isRecord(manifest) || manifest["name"] !== "milestack") {
      return undefined;
    }
    const version = manifest["version"];
    const bin = manifest["bin"];
    const binPath = typeof bin === "string" ? bin : isRecord(bin) ? bin["milestack"] : undefined;
    if (typeof version !== "string" || parseSemver(version) === undefined) {
      return undefined;
    }
    if (typeof binPath !== "string") {
      return undefined;
    }
    return { entryPath: realpathSync(path.join(packageRoot, binPath)), version };
  } catch {
    return undefined;
  }
}

// An npm global install replaces the package in place, but pnpm may put the new
// version at a different real path, so the entry is resolved again from the
// project's node_modules instead of reusing the old entry path.
function locateInstalledCli(location: EntryLocation, entryPath: string): InstalledCli | undefined {
  if (location.kind === "npm-global") {
    const packageRoot = findPackageRoot(path.dirname(entryPath));
    return packageRoot === undefined ? undefined : readInstalledCli(packageRoot.packageRoot);
  }
  if (location.kind === "project-local") {
    try {
      return readInstalledCli(
        realpathSync(path.join(location.projectRoot, "node_modules", "milestack")),
      );
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function generatedHeaderVersionLine(instructionsPath: string): string {
  try {
    return readFileSync(instructionsPath, "utf8").split("\n", 1)[0] ?? "";
  } catch {
    return "";
  }
}

function skippedUninitialized(target: ProjectRefreshTarget): StepOutcome {
  return {
    state: "skipped",
    detail: "跳过：项目未初始化",
    notes: [`${target.projectRoot} 没有 .milestack/milestack.db，未创建 .milestack。`],
    failsRun: false,
  };
}

async function refreshProject(
  target: ProjectRefreshTarget,
  upgrade: Upgrade | undefined,
  runCommand: CommandRunner,
): Promise<StepOutcome> {
  if (target.kind === "uninitialized") {
    return skippedUninitialized(target);
  }
  if (upgrade !== undefined) {
    return refreshWithInstalledCli(target, upgrade, runCommand);
  }
  try {
    writeFileSync(
      target.instructionsPath,
      formatProjectAgentInstructions(runtimeVersion),
      "utf8",
    );
    return { state: "done", detail: target.instructionsPath, notes: [], failsRun: false };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      state: "failed",
      detail: "刷新生成文件失败",
      notes: [`${detail}（${target.instructionsPath}）`],
      failsRun: true,
    };
  }
}

// Asks the newly installed CLI to generate the files, then confirms from the
// file itself that it carries the new version before reporting success.
async function refreshWithInstalledCli(
  target: Extract<ProjectRefreshTarget, { kind: "initialized" }>,
  upgrade: Upgrade,
  runCommand: CommandRunner,
): Promise<StepOutcome> {
  const { installedCli, latest } = upgrade;
  const rerun = "生成文件未更新到新版本，请再运行一次 milestack update。";
  const failure = (detail: string, notes: string[]): StepOutcome => ({
    state: "failed",
    detail,
    notes: [...notes, rerun],
    failsRun: true,
  });
  if (installedCli === undefined) {
    return failure("无法确定新安装的 CLI", []);
  }
  // The installer can exit 0 while the located package is still an older
  // version; never run that entry, and never accept its version as the result.
  if (installedCli.version !== latest) {
    return failure(`安装后定位到的 CLI 版本是 ${installedCli.version}，不是 ${latest}`, []);
  }
  const result = await runCommand({
    command: process.execPath,
    args: [installedCli.entryPath, "update", "--project", target.projectRoot],
  });
  if (!generatedHeaderVersionLine(target.instructionsPath).includes(`version: ${latest}. -->`)) {
    const succeeded = result.status === 0 && !result.error;
    return failure(
      `用新版本 ${latest} 刷新生成文件失败`,
      succeeded ? [] : failureOutputLines(result),
    );
  }
  return {
    state: "done",
    detail: `${target.instructionsPath}（由新版本 ${latest} 生成）`,
    notes: [],
    failsRun: false,
  };
}

function checkProject(target: ProjectRefreshTarget): StepOutcome {
  if (target.kind === "uninitialized") {
    return skippedUninitialized(target);
  }
  let existing: string;
  try {
    existing = readFileSync(target.instructionsPath, "utf8");
  } catch {
    return {
      state: "failed",
      detail: "生成文件不存在，与当前 CLI 的完整生成结果不一致",
      notes: [target.instructionsPath],
      failsRun: false,
    };
  }
  if (existing === formatProjectAgentInstructions(runtimeVersion)) {
    return {
      state: "done",
      detail: "生成文件与当前 CLI 的完整生成结果一致",
      notes: [target.instructionsPath],
      failsRun: false,
    };
  }
  return {
    state: "failed",
    detail: "生成文件与当前 CLI 的完整生成结果不一致",
    notes: [target.instructionsPath],
    failsRun: false,
  };
}

function describeLocation(
  location: EntryLocation,
  entryPath: string,
): { detail: string; notes: string[] } {
  const entry = `入口：${entryPath}`;
  if (location.kind === "npm-global") {
    return { detail: "npm 全局安装", notes: [entry] };
  }
  if (location.kind === "project-local") {
    return {
      detail: `项目内安装（${location.packageManager}）`,
      notes: [entry, `项目：${location.projectRoot}`],
    };
  }
  if (location.kind === "project-local-ambiguous") {
    return {
      detail: "项目内安装（包管理器不明）",
      notes: [entry, `项目：${location.projectRoot}`],
    };
  }
  if (location.kind === "source-repo") {
    return { detail: "源码仓库", notes: [entry] };
  }
  if (location.kind === "pnpm-global") {
    return { detail: "pnpm 全局安装", notes: [entry] };
  }
  if (location.kind === "npx") {
    return { detail: "npx 临时副本", notes: [entry] };
  }
  return { detail: "无法确认安装方式", notes: [entry] };
}

// Why no installer ran for an entry this command does not upgrade.
function manualUpgradeReason(location: EntryLocation): string {
  if (location.kind === "project-local-ambiguous") {
    return "无法确定单一包管理器（需要且只需要 package-lock.json 或 pnpm-lock.yaml 之一）。";
  }
  if (location.kind === "source-repo") {
    return `源码仓库入口（含 pnpm link --global）请在该仓库手动执行 pnpm build（仓库：${location.packageRoot}）。`;
  }
  if (location.kind === "pnpm-global") {
    return "请沿用原来的 pnpm 方式自行升级；本命令不会改跑 npm。";
  }
  if (location.kind === "npx") {
    return "如需全局安装，可手动执行 npm install --global milestack@latest（本次未执行）。";
  }
  return "无法确认当前入口的安装方式；请使用安装该 CLI 的包管理器升级，本命令不会静默改跑 npm。";
}

type Installer = {
  executable: string;
  installArgs: string[];
  cwd?: string;
  // What a developer can run by hand.
  manualInstall: string;
  manualQuery: string;
  reminders: string[];
};

function installerFor(location: EntryLocation): Installer | undefined {
  if (location.kind === "npm-global") {
    const executable = npmExecutable(process.platform);
    return {
      executable,
      installArgs: ["install", "--global", "milestack@latest"],
      manualInstall: "npm install --global milestack@latest",
      manualQuery: "npm view milestack version",
      reminders: ["请新开终端后运行 milestack -v 确认版本。"],
    };
  }
  if (location.kind === "project-local") {
    const executable =
      location.packageManager === "npm"
        ? npmExecutable(process.platform)
        : pnpmExecutable(process.platform);
    const installArgs =
      location.packageManager === "npm"
        ? ["install", "milestack@latest"]
        : ["update", "milestack", "--latest"];
    return {
      executable,
      installArgs,
      cwd: location.projectRoot,
      manualInstall: `cd ${location.projectRoot} && ${location.packageManager} ${installArgs.join(" ")}`,
      manualQuery: `${location.packageManager} view milestack version`,
      reminders: [
        "请新开终端后运行 ./node_modules/.bin/milestack -v 确认版本。",
        "本次只升级项目内依赖；若 MCP 配置使用全局命令 milestack，其版本不会改变。",
      ],
    };
  }
  return undefined;
}

function titleText(options: UpdateOptions, latest?: string): string {
  const base = options.check ? "MileStack update --check（不安装、不写文件）" : "MileStack update";
  return latest === undefined
    ? `${base}  ${runtimeVersion}`
    : `${base}  ${runtimeVersion} → ${latest}`;
}

export async function runUpdate(
  options: UpdateOptions,
  output: CliOutput,
  dependencies: UpdateDependencies = defaultUpdateDependencies,
): Promise<number> {
  const reporter = createStepReporter(output, dependencies.display ?? detectStepDisplay());
  try {
    return await executeUpdate(options, reporter, dependencies);
  } finally {
    reporter.close();
  }
}

async function executeUpdate(
  options: UpdateOptions,
  reporter: StepReporter,
  dependencies: UpdateDependencies,
): Promise<number> {
  const { runCommand } = dependencies;
  reporter.setTitle(titleText(options));

  const detect = reporter.addStep("检测安装方式");
  const refresh = reporter.addStep(options.check ? "检查项目生成文件" : "刷新项目生成文件");
  reporter.start(detect);
  const entryPath = dependencies.resolveEntryPath();
  const location = await classifyEntry(entryPath, runCommand);
  const described = describeLocation(location, entryPath);
  reporter.succeed(detect, described.detail, described.notes);

  const target = resolveRefreshTarget(options.projectPath);
  let failed = false;
  let upgrade: Upgrade | undefined;
  let reminders: string[] = [];

  const installer = installerFor(location);
  if (installer === undefined) {
    reporter.finalizeTitle();
    const manual = reporter.addStep("升级 CLI", refresh);
    const reason = manualUpgradeReason(location);
    if (options.check) {
      reporter.skip(manual, "未执行自动安装", [reason]);
    } else {
      reporter.fail(manual, "未执行自动安装", [reason]);
      failed = true;
    }
  } else {
    const query = reporter.addStep("查询最新版本", refresh);
    reporter.start(query);
    const evaluation = await evaluateLatest(installer.executable, runCommand);
    if (evaluation.kind === "error") {
      reporter.fail(query, evaluation.detail, [
        ...evaluation.outputLines,
        `手动执行：${installer.manualQuery}`,
      ]);
      reporter.discardPending();
      return 1;
    }
    if (evaluation.kind === "latest") {
      reporter.succeed(query, `${evaluation.latest} 已是最新版本，未执行安装`);
      reporter.finalizeTitle();
    } else if (evaluation.kind === "not-newer") {
      reporter.succeed(
        query,
        `registry 的最新版本 ${evaluation.latest} 不高于当前版本，未执行安装`,
      );
      reporter.finalizeTitle();
    } else if (options.check) {
      reporter.succeed(query, `${evaluation.latest} 可用；--check 未执行安装`);
      reporter.finalizeTitle();
    } else {
      reporter.succeed(query, `${evaluation.latest} 可用`);
      reporter.setTitle(titleText(options, evaluation.latest), true);
      const install = reporter.addStep(`安装 milestack@${evaluation.latest}`, refresh);
      reporter.start(install);
      const result = await runCommand({
        command: installer.executable,
        args: installer.installArgs,
        ...(installer.cwd !== undefined ? { cwd: installer.cwd } : {}),
      });
      if (result.status !== 0 || result.error) {
        reporter.fail(install, "安装失败", [
          ...failureOutputLines(result),
          `手动执行：${installer.manualInstall}`,
        ]);
        reporter.discardPending();
        return 1;
      }
      reporter.succeed(install, "", [`执行：${installer.manualInstall}`]);
      upgrade = {
        installedCli: locateInstalledCli(location, entryPath),
        latest: evaluation.latest,
      };
      reminders = installer.reminders;
    }
  }

  reporter.start(refresh);
  const outcome = options.check
    ? checkProject(target)
    : await refreshProject(target, upgrade, runCommand);
  recordOutcome(reporter, refresh, outcome);
  failed = failed || outcome.failsRun;

  if (upgrade !== undefined) {
    reporter.summary(
      outcome.failsRun ? "failure" : "success",
      [
        outcome.failsRun
          ? `已安装 ${upgrade.latest}，但项目生成文件未刷新 · 请重启 MCP 客户端和 milestack serve`
          : `已升级到 ${upgrade.latest} · 请重启 MCP 客户端和 milestack serve`,
        ...reminders,
      ].join("\n"),
    );
  }
  return failed ? 1 : 0;
}
