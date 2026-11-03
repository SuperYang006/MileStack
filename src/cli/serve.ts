import { runtimeVersion } from "../server/runtime-version.js";
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
  versionCheck: VersionCheckHandle | null;
};

export type ServeDependencies = {
  startServer: (options: HttpServerOptions) => Promise<ServeServer>;
  versionCheck: VersionCheckDependencies;
  waitForShutdown: (server: ServeServer) => Promise<void>;
};

function waitForSignals(): Promise<void> {
  return new Promise((resolve) => {
    const handleSignal = () => {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
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

export async function runServe(
  projectPath: string | undefined,
  port: number,
  output: CliOutput,
  dependencies: ServeDependencies = defaultServeDependencies,
): Promise<number> {
  const server = await dependencies.startServer({
    projectRoot: projectPath,
    port,
    versionCheck: dependencies.versionCheck,
  });
  output.writeStdout(`MileStack HTTP service running at ${server.url}\n`);

  if (server.versionCheck !== null) {
    void server.versionCheck.done.then((result) => {
      const hint = formatVersionCheckHint(result);
      if (hint !== null) {
        output.writeStdout(`${hint}\n`);
      }
    });
  }

  try {
    await dependencies.waitForShutdown(server);
  } finally {
    await server.app.close();
  }
  return 0;
}
