import {
  failureOutputLines,
  type CommandRunner,
} from "./command-runner.js";
import {
  classifyEntry,
  latestVersionExecutable,
  upgradeGuidance,
} from "./install-location.js";

export type VersionCheckDependencies = {
  currentVersion: string;
  resolveEntryPath: () => string;
  runCommand: CommandRunner;
};

export type VersionCheckResult =
  | {
      status: "available";
      currentVersion: string;
      latestVersion: string;
      command: string;
      reason: string;
    }
  | { status: "not-newer"; latestVersion: string }
  | { status: "unavailable" };

export type VersionCheckHandle = {
  done: Promise<VersionCheckResult>;
  result: () => VersionCheckResult | null;
};

type Semver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

const semverPattern = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(value: string): Semver | undefined {
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

export function compareSemver(left: string, right: string): number | undefined {
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

export type LatestEvaluation =
  | { kind: "error"; detail: string; outputLines: string[] }
  | { kind: "latest"; latest: string }
  | { kind: "update-available"; latest: string }
  | { kind: "not-newer"; latest: string };

export async function evaluateLatest(
  command: string,
  runCommand: CommandRunner,
  currentVersion: string,
): Promise<LatestEvaluation> {
  const latest = await queryLatestVersion(command, runCommand);
  if ("error" in latest) {
    return { kind: "error", detail: latest.error, outputLines: latest.outputLines };
  }
  const comparison = compareSemver(latest.version, currentVersion);
  if (comparison === undefined) {
    return {
      kind: "error",
      detail: "无法比较版本",
      outputLines: [
        `无法比较当前版本与最新版本（当前：${currentVersion}，最新：${latest.version}）；未执行安装。`,
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

// One best-effort registry check. Callers must treat every non-available
// result as "show nothing": a failed, slow, or incomparable query never
// changes command behavior or output.
export async function checkForUpdate(
  dependencies: VersionCheckDependencies,
): Promise<VersionCheckResult> {
  if (parseSemver(dependencies.currentVersion) === undefined) {
    return { status: "unavailable" };
  }
  try {
    const entryPath = dependencies.resolveEntryPath();
    const location = await classifyEntry(entryPath, dependencies.runCommand);
    const guidance = upgradeGuidance(location);
    if (guidance.command === null) {
      return { status: "unavailable" };
    }
    const evaluation = await evaluateLatest(
      latestVersionExecutable(location, process.platform),
      dependencies.runCommand,
      dependencies.currentVersion,
    );
    if (evaluation.kind === "error") {
      return { status: "unavailable" };
    }
    if (evaluation.kind === "not-newer" || evaluation.kind === "latest") {
      return { status: "not-newer", latestVersion: evaluation.latest };
    }
    return {
      status: "available",
      currentVersion: dependencies.currentVersion,
      latestVersion: evaluation.latest,
      command: guidance.command,
      reason: guidance.reason,
    };
  } catch {
    return { status: "unavailable" };
  }
}

// Starts the check without awaiting it so a slow registry can never delay the
// caller. `result()` stays null until the check settles.
export function startVersionCheck(
  dependencies: VersionCheckDependencies,
): VersionCheckHandle {
  let result: VersionCheckResult | null = null;
  const done = checkForUpdate(dependencies).then((checked) => {
    result = checked;
    return checked;
  });
  return { done, result: () => result };
}
