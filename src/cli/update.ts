import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  formatProjectAgentInstructions,
  projectAgentInstructionsPath,
} from "../core/agent-instructions.js";
import { resolveDatabasePath } from "../db/paths.js";
import { readGeneratedHeaderLine } from "../project/generated-instructions.js";
import { resolveProjectRoot } from "../project/project-context.js";
import { runtimeVersion } from "../server/runtime-version.js";
import {
  defaultRunCommand,
  failureOutputLines,
  npmExecutable,
  pnpmExecutable,
  type CommandRunner,
} from "../update/command-runner.js";
import {
  classifyEntry,
  findPackageRoot,
  upgradeGuidance,
  type EntryLocation,
} from "../update/install-location.js";
import {
  evaluateLatest,
  parseSemver,
} from "../update/version-check.js";
import { resolveEntryPath } from "./entry-path.js";
import type { CliOutput } from "./output.js";
import { createStepReporter, detectStepDisplay, type Step, type StepDisplay, type StepReporter } from "./step-progress.js";

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

export const defaultUpdateDependencies: UpdateDependencies = {
  resolveEntryPath,
  runCommand: defaultRunCommand,
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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
  if (!readGeneratedHeaderLine(target.instructionsPath).includes(`version: ${latest}. -->`)) {
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
    const reason = upgradeGuidance(location).reason;
    if (options.check) {
      reporter.skip(manual, "未执行自动安装", [reason]);
    } else {
      reporter.fail(manual, "未执行自动安装", [reason]);
      failed = true;
    }
  } else {
    const query = reporter.addStep("查询最新版本", refresh);
    reporter.start(query);
    const evaluation = await evaluateLatest(installer.executable, runCommand, runtimeVersion);
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
