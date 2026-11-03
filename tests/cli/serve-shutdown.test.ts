import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const temporaryPaths: string[] = [];
const runningChildren = new Set<ChildProcess>();

afterEach(async () => {
  for (const child of runningChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
  runningChildren.clear();
  for (const target of temporaryPaths.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), `milestack-serve-shutdown-${prefix}-`));
  temporaryPaths.push(directory);
  return directory;
}

function writeExecutable(filePath: string, contents: string): void {
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

async function waitFor(
  label: string,
  predicate: () => boolean,
  child: ChildProcess,
  output: () => string,
  timeoutMs = 8_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${label} failed: child exited early.\n${output()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${label} timed out.\n${output()}`);
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(null);
    }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    child.once("exit", onExit);
  });
}

describe("milestack serve shutdown", () => {
  it("exits promptly on SIGTERM while a registry query is still pending", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../..");
    const tsxLoader = path.join(
      repositoryRoot,
      "node_modules",
      ".pnpm",
      "node_modules",
      "tsx",
      "dist",
      "loader.mjs",
    );
    expect(existsSync(tsxLoader)).toBe(true);

    const temporaryRoot = createTemporaryDirectory("run");
    const projectRoot = path.join(temporaryRoot, "project");
    const staticDir = path.join(temporaryRoot, "dist", "ui");
    const binDir = path.join(temporaryRoot, "bin");
    const prefix = path.join(temporaryRoot, "npm-prefix");
    const entryPath = path.join(
      prefix,
      "lib",
      "node_modules",
      "milestack",
      "dist",
      "index.js",
    );
    const markerPath = path.join(temporaryRoot, "query-started");
    const scriptPath = path.join(temporaryRoot, "serve-child.ts");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(staticDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    mkdirSync(path.dirname(entryPath), { recursive: true });
    writeFileSync(path.join(staticDir, "index.html"), "<h1>MileStack test UI</h1>\n");
    writeFileSync(entryPath, "// installed CLI entry\n");
    writeExecutable(
      path.join(binDir, "npm"),
      [
        "#!/bin/sh",
        'if [ "$1" = "prefix" ]; then echo "$FAKE_PREFIX"; exit 0; fi',
        'if [ "$1" = "view" ]; then echo started > "$QUERY_MARKER"; exec sleep 30; fi',
        "exit 1",
        "",
      ].join("\n"),
    );

    const moduleUrls = {
      serve: pathToFileURL(path.join(repositoryRoot, "src/cli/serve.ts")).href,
      server: pathToFileURL(path.join(repositoryRoot, "src/server/server.ts")).href,
      runner: pathToFileURL(path.join(repositoryRoot, "src/update/command-runner.ts")).href,
    };
    writeFileSync(
      scriptPath,
      [
        'const [projectRoot, staticDir, entryPath] = process.argv.slice(2);',
        "const main = async () => {",
        "const [{ runServe }, { startHttpServer }, { defaultRunCommand }] = await Promise.all([",
        "  import(process.env.MILESTACK_SERVE_URL),",
        "  import(process.env.MILESTACK_SERVER_URL),",
        "  import(process.env.MILESTACK_RUNNER_URL),",
        "]);",
        "await runServe(projectRoot, 0, {",
        "  writeStdout: (message) => process.stdout.write(message),",
        "  writeStderr: (message) => process.stderr.write(message),",
        "}, {",
        "  startServer: (options) => startHttpServer({ ...options, staticDir }),",
        "  versionCheck: {",
        '    currentVersion: "0.2.2",',
        "    resolveEntryPath: () => entryPath,",
        "    runCommand: defaultRunCommand,",
        "  },",
        "  waitForShutdown: (_server, beginShutdown) => new Promise((resolve) => {",
        "    const handleSignal = () => {",
        '      process.off("SIGTERM", handleSignal);',
        '      process.off("SIGINT", handleSignal);',
        "      beginShutdown();",
        "      resolve();",
        "    };",
        '    process.on("SIGTERM", handleSignal);',
        '    process.on("SIGINT", handleSignal);',
        "  }),",
        "});",
        "};",
        "main().catch((error) => { console.error(error); process.exit(1); });",
        "",
      ].join("\n"),
    );

    const child = spawn(
      process.execPath,
      ["--import", tsxLoader, scriptPath, projectRoot, staticDir, entryPath],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
          FAKE_PREFIX: prefix,
          QUERY_MARKER: markerPath,
          MILESTACK_SERVE_URL: moduleUrls.serve,
          MILESTACK_SERVER_URL: moduleUrls.server,
          MILESTACK_RUNNER_URL: moduleUrls.runner,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    runningChildren.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    try {
      await waitFor(
        "HTTP server startup",
        () => stdout.includes("MileStack HTTP service running at"),
        child,
        () => `stdout:\n${stdout}\nstderr:\n${stderr}`,
      );
      await waitFor(
        "pending registry query",
        () => existsSync(markerPath),
        child,
        () => `stdout:\n${stdout}\nstderr:\n${stderr}`,
      );

      const signalledAt = Date.now();
      child.kill("SIGTERM");
      const exit = await waitForExit(child, 3_000);
      const elapsedMs = Date.now() - signalledAt;
      if (exit === null) {
        throw new Error(
          `serve did not exit within 3s after SIGTERM.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        );
      }

      expect(exit.code === 0 || exit.signal === "SIGTERM").toBe(true);
      expect(elapsedMs).toBeLessThan(3_000);
      expect(stdout).not.toContain("9.9.9");
      expect(readFileSync(markerPath, "utf8")).toContain("started");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 2_000);
      }
      runningChildren.delete(child);
    }
  }, 15_000);
});
