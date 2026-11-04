import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createHttpServer } from "../../src/server/server.js";
import { runtimeVersion } from "../../src/server/runtime-version.js";
import type {
  CommandInvocation,
  CommandResult,
  CommandRunner,
} from "../../src/update/command-runner.js";

const currentVersion = "0.2.2";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const target of temporaryPaths.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), `milestack-version-check-${prefix}-`));
  temporaryPaths.push(directory);
  return directory;
}

function createProjectDirectory(): string {
  const projectRoot = createTemporaryDirectory("project");
  const staticDir = path.join(projectRoot, "dist", "ui");
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(path.join(staticDir, "index.html"), "<h1>MileStack test UI</h1>\n");
  return projectRoot;
}

function createNpmGlobalEntry(projectRoot: string): { prefix: string; entryPath: string } {
  const prefix = path.join(projectRoot, "npm-prefix");
  const entryPath = path.join(
    prefix,
    "lib",
    "node_modules",
    "milestack",
    "dist",
    "index.js",
  );
  mkdirSync(path.dirname(entryPath), { recursive: true });
  writeFileSync(entryPath, "// installed CLI entry\n");
  return { prefix, entryPath };
}

type QueryBehavior =
  | { kind: "latest"; version: string }
  | { kind: "error"; error: Error }
  | { kind: "pending" }
  | { kind: "delayed-timeout"; error: Error };

type CommandFake = {
  calls: CommandInvocation[];
  runCommand: CommandRunner;
  viewCalls: () => number;
  resolvePending: (result: CommandResult) => void;
};

function createCommandFake(prefix: string, behavior: QueryBehavior): CommandFake {
  const calls: CommandInvocation[] = [];
  let pendingResolver: ((result: CommandResult) => void) | undefined;

  const runCommand: CommandRunner = async (invocation) => {
    calls.push({
      command: invocation.command,
      args: [...invocation.args],
      ...(invocation.cwd !== undefined ? { cwd: invocation.cwd } : {}),
    });
    if (invocation.args[0] === "prefix") {
      return { status: 0, stdout: `${prefix}\n`, stderr: "" };
    }
    if (invocation.args[0] === "view") {
      if (behavior.kind === "latest") {
        return { status: 0, stdout: `${behavior.version}\n`, stderr: "" };
      }
      if (behavior.kind === "error") {
        return { status: 1, stdout: "", stderr: behavior.error.message };
      }
      if (behavior.kind === "delayed-timeout") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { status: null, stdout: "", stderr: "", error: behavior.error };
      }
      return new Promise<CommandResult>((resolve) => {
        pendingResolver = resolve;
      });
    }
    return { status: 1, stdout: "", stderr: "unexpected command" };
  };

  return {
    calls,
    runCommand,
    viewCalls: () => calls.filter((call) => call.args[0] === "view").length,
    resolvePending: (result) => {
      pendingResolver?.(result);
      pendingResolver = undefined;
    },
  };
}

async function openServer(
  projectRoot: string,
  entryPath: string,
  fake: CommandFake,
  version = currentVersion,
): Promise<Awaited<ReturnType<typeof createHttpServer>>> {
  return createHttpServer({
    projectRoot,
    staticDir: path.join(projectRoot, "dist", "ui"),
    versionCheck: {
      currentVersion: version,
      resolveEntryPath: () => entryPath,
      runCommand: fake.runCommand,
    },
  });
}

async function readHealth(
  server: Awaited<ReturnType<typeof createHttpServer>>,
): Promise<Record<string, unknown>> {
  const response = await server.app.inject({ method: "GET", url: "/api/health" });
  expect(response.statusCode).toBe(200);
  return JSON.parse(response.payload) as Record<string, unknown>;
}

describe("HTTP server startup version check", () => {
  it("keeps health status, timestamp, and version while exposing an available update", async () => {
    const projectRoot = createProjectDirectory();
    const { prefix, entryPath } = createNpmGlobalEntry(projectRoot);
    const fake = createCommandFake(prefix, { kind: "latest", version: "9.9.9" });
    const server = await openServer(projectRoot, entryPath, fake);

    try {
      const before = await readHealth(server);
      expect(before.status).toBe("ok");
      expect(typeof before.timestamp).toBe("string");
      expect(typeof before.version).toBe("string");

      const checked = await server.versionCheck?.done;
      expect(checked).toMatchObject({
        status: "available",
        currentVersion,
        latestVersion: "9.9.9",
        command: "milestack update",
      });

      const after = await readHealth(server);
      expect(after).toMatchObject({
        status: "ok",
        update: { latestVersion: "9.9.9", command: "milestack update" },
      });
      expect(after.version).toBe(before.version);

      await readHealth(server);
      await readHealth(server);
      expect(fake.viewCalls()).toBe(1);
    } finally {
      server.context.database.close();
      await server.app.close();
    }
  });

  it("returns health immediately while the latest-version query is still pending", async () => {
    const projectRoot = createProjectDirectory();
    const { prefix, entryPath } = createNpmGlobalEntry(projectRoot);
    const fake = createCommandFake(prefix, { kind: "pending" });
    const server = await openServer(projectRoot, entryPath, fake);

    try {
      const startedAt = Date.now();
      const health = await readHealth(server);
      expect(Date.now() - startedAt).toBeLessThan(1000);
      expect(health).toMatchObject({ status: "ok", update: null });

      fake.resolvePending({ status: 0, stdout: "9.9.9\n", stderr: "" });
      await server.versionCheck?.done;
      const after = await readHealth(server);
      expect(after).toMatchObject({
        update: { latestVersion: "9.9.9", command: "milestack update" },
      });
    } finally {
      server.context.database.close();
      await server.app.close();
    }
  });

  it("keeps health intact and reports no update when the query fails or times out", async () => {
    for (const behavior of [
      { kind: "error", error: new Error("ENOTFOUND registry.npmjs.org") },
      { kind: "delayed-timeout", error: new Error("命令超过 60 秒未结束，已终止") },
    ] satisfies QueryBehavior[]) {
      const projectRoot = createProjectDirectory();
      const { prefix, entryPath } = createNpmGlobalEntry(projectRoot);
      const fake = createCommandFake(prefix, behavior);
      const server = await openServer(projectRoot, entryPath, fake);

      try {
        const checked = await server.versionCheck?.done;
        expect(checked).toEqual({ status: "unavailable" });
        const health = await readHealth(server);
        expect(health).toMatchObject({ status: "ok", update: null });
        expect(typeof health.timestamp).toBe("string");
        expect(health.version).toBe(runtimeVersion);
      } finally {
        server.context.database.close();
        await server.app.close();
      }
    }
  });

  it("reports no update when the latest version is not newer or the current version is unknown", async () => {
    for (const [latest, current, expectedViewCalls] of [
      ["0.2.2", currentVersion, 1],
      ["0.0.1", currentVersion, 1],
      ["9.9.9", "unknown", 0],
    ] as const) {
      const projectRoot = createProjectDirectory();
      const { prefix, entryPath } = createNpmGlobalEntry(projectRoot);
      const fake = createCommandFake(prefix, { kind: "latest", version: latest });
      const server = await openServer(projectRoot, entryPath, fake, current);

      try {
        await server.versionCheck?.done;
        const health = await readHealth(server);
        expect(health).toMatchObject({ status: "ok", update: null });
        expect(fake.viewCalls()).toBe(expectedViewCalls);
      } finally {
        server.context.database.close();
        await server.app.close();
      }
    }
  });
});
