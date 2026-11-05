import {
  refreshStaleInstructions,
  writeFileAtomically,
  type InstructionsRefreshResult,
} from "../project/generated-instructions.js";
import { resolveProjectRoot } from "../project/project-context.js";
import { runtimeVersion } from "../server/runtime-version.js";
import { defaultServePortRange, ServeAlreadyRunningError } from "../server/port-selection.js";
import { startHttpServer, type HttpServerOptions } from "../server/server.js";
import { defaultRunCommand } from "../update/command-runner.js";
import type {
  VersionCheckDependencies,
  VersionCheckHandle,
  VersionCheckResult,
} from "../update/version-check.js";
import { resolveEntryPath } from "./entry-path.js";
import type { CliOutput } from "./output.js";

// The parts of the HTTP server that serve owns. Keeping this structural lets a
// test provide the same contract without opening a real port.
export type ServeServer = {
  app: { close: () => Promise<unknown> };
  url: string;
  // Ports tried and found occupied before this one; absent when none were.
  skippedPorts?: readonly number[];
  versionCheck: VersionCheckHandle | null;
};

export type ServeDependencies = {
  startServer: (options: HttpServerOptions) => Promise<ServeServer>;
  versionCheck: VersionCheckDependencies;
  instructions: {
    currentVersion: string;
    writeFile: (target: string, content: string) => void;
  };
  waitForShutdown: (server: ServeServer, beginShutdown: () => void) => Promise<void>;
};

function waitForSignals(_server: ServeServer, beginShutdown: () => void): Promise<void> {
  return new Promise((resolve) => {
    const handleSignal = () => {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
      beginShutdown();
      resolve();
    };
    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);
  });
}

export const defaultServeDependencies: ServeDependencies = {
  startServer: startHttpServer,
  versionCheck: {
    currentVersion: runtimeVersion,
    resolveEntryPath,
    runCommand: defaultRunCommand,
  },
  instructions: { currentVersion: runtimeVersion, writeFile: writeFileAtomically },
  waitForShutdown: waitForSignals,
};

// One line for the terminal. It reuses the same install-method guidance as
// `milestack update --check`; entries it cannot upgrade stay silent.
export function formatVersionCheckHint(result: VersionCheckResult): string | null {
  if (result.status !== "available") {
    return null;
  }
  const reason = result.reason.includes(result.command)
    ? result.reason
    : `${result.reason.replace(/。$/, "")}；可运行 ${result.command}。`;
  return `MileStack ${result.currentVersion} → ${result.latestVersion} 可用；${reason}`;
}

// One line for the terminal, or null when nothing was refreshed or flagged.
export function formatInstructionsRefreshNotice(
  result: InstructionsRefreshResult,
): { stream: "stdout" | "stderr"; line: string } | null {
  if (result.kind === "refreshed") {
    return {
      stream: "stdout",
      line: `已将 ${result.instructionsPath} 从 ${result.from} 刷新到 ${result.to}。`,
    };
  }
  if (result.kind === "not-generated") {
    return {
      stream: "stdout",
      line: `${result.instructionsPath} 不存在或缺少 MileStack 生成标记，未刷新；可在该项目运行 milestack update。`,
    };
  }
  if (result.kind === "failed") {
    return {
      stream: "stderr",
      line: `警告：未能刷新 ${result.instructionsPath}（${result.reason}）；可在该项目运行 milestack update。`,
    };
  }
  return null;
}

// One line for the terminal when the default port was occupied, or null.
export function formatPortFallbackNotice(
  skippedPorts: readonly number[],
  url: string,
): string | null {
  if (skippedPorts.length === 0) {
    return null;
  }
  return `端口 ${skippedPorts.join("、")} 已被占用，改用 ${new URL(url).port}。`;
}

// An explicit port is used exactly as given. Without one, the default range is
// searched in order.
export async function runServe(
  projectPath: string | undefined,
  port: number | undefined,
  output: CliOutput,
  dependencies: ServeDependencies = defaultServeDependencies,
): Promise<number> {
  let server: ServeServer;
  try {
    server = await dependencies.startServer({
      projectRoot: projectPath,
      port: port ?? defaultServePortRange,
      versionCheck: dependencies.versionCheck,
    });
  } catch (error) {
    if (error instanceof ServeAlreadyRunningError) {
      output.writeStdout(`${error.message}\n`);
      return 0;
    }
    throw error;
  }
  const fallbackNotice = formatPortFallbackNotice(server.skippedPorts ?? [], server.url);
  if (fallbackNotice !== null) {
    output.writeStdout(`${fallbackNotice}\n`);
  }
  output.writeStdout(`MileStack HTTP service running at ${server.url}\n`);

  // Runs after the service is listening and never throws, so a stale generated
  // file can neither delay nor stop startup.
  const notice = formatInstructionsRefreshNotice(
    refreshStaleInstructions(
      resolveProjectRoot(projectPath),
      dependencies.instructions.currentVersion,
      dependencies.instructions.writeFile,
    ),
  );
  if (notice !== null) {
    if (notice.stream === "stdout") {
      output.writeStdout(`${notice.line}\n`);
    } else {
      output.writeStderr(`${notice.line}\n`);
    }
  }

  const versionCheck = server.versionCheck;
  let shuttingDown = false;
  const beginShutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    versionCheck?.cancel();
  };

  if (versionCheck !== null) {
    void versionCheck.done.then((result) => {
      if (shuttingDown) {
        return;
      }
      const hint = formatVersionCheckHint(result);
      if (hint !== null) {
        output.writeStdout(`${hint}\n`);
      }
    });
  }

  try {
    await dependencies.waitForShutdown(server, beginShutdown);
  } finally {
    beginShutdown();
    await server.app.close();
  }
  return 0;
}
