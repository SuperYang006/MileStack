import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatProjectAgentInstructions } from "../../src/core/agent-instructions.js";
import { runServe, type ServeDependencies } from "../../src/cli/serve.js";
import {
  writeFileAtomically,
} from "../../src/project/generated-instructions.js";
import { startHttpServer } from "../../src/server/server.js";
import type { CommandRunner } from "../../src/update/command-runner.js";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const target of temporaryPaths.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

function createProject(): { projectRoot: string; staticDir: string; instructionsPath: string } {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "milestack-serve-refresh-"));
  temporaryPaths.push(projectRoot);
  const staticDir = path.join(projectRoot, "static");
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(path.join(staticDir, "index.html"), "<h1>MileStack test UI</h1>\n");
  return {
    projectRoot,
    staticDir,
    instructionsPath: path.join(projectRoot, ".milestack", "agent-instructions.md"),
  };
}

function writeInstructions(instructionsPath: string, content: string): void {
  mkdirSync(path.dirname(instructionsPath), { recursive: true });
  writeFileSync(instructionsPath, content, "utf8");
}

type ServeRun = {
  exitCode: number;
  stdout: string;
  stderr: string;
  health: { status: string; version: string } | null;
};

// Starts the real HTTP service for the project, reads /api/health once it is
// listening, and shuts down. The registry query is stubbed so no network or
// package manager is touched.
async function serveProject(
  project: ReturnType<typeof createProject>,
  currentVersion: string,
  options: {
    writeFile?: ServeDependencies["instructions"]["writeFile"];
    latestVersion?: string;
  } = {},
): Promise<ServeRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let health: ServeRun["health"] = null;
  const prefix = path.join(project.projectRoot, "prefix");
  const entryPath = path.join(prefix, "lib", "node_modules", "milestack", "dist", "index.js");
  mkdirSync(path.dirname(entryPath), { recursive: true });
  writeFileSync(entryPath, "// installed CLI entry\n");
  const runCommand: CommandRunner = async (invocation) => {
    if (invocation.args[0] === "prefix") {
      return { status: 0, stdout: `${prefix}\n`, stderr: "" };
    }
    if (invocation.args[0] === "view" && options.latestVersion !== undefined) {
      return { status: 0, stdout: `${options.latestVersion}\n`, stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "offline" };
  };
  const dependencies: ServeDependencies = {
    startServer: (options) => startHttpServer({ ...options, staticDir: project.staticDir, port: 0 }),
    versionCheck: {
      currentVersion,
      resolveEntryPath: () => entryPath,
      runCommand,
    },
    instructions: { currentVersion, writeFile: options.writeFile ?? writeFileAtomically },
    waitForShutdown: async (server) => {
      const app = (server as unknown as { app: { inject: (o: object) => Promise<{ json: () => never }> } }).app;
      health = (await app.inject({ method: "GET", url: "/api/health" })).json();
      await server.versionCheck?.done;
    },
  };
  const exitCode = await runServe(
    project.projectRoot,
    0,
    {
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    },
    dependencies,
  );
  return { exitCode, stdout: stdout.join(""), stderr: stderr.join(""), health };
}

describe("milestack serve refreshes a stale agent-instructions.md", () => {
  it("rewrites a file from an older version to the full current generation and reports it", async () => {
    const project = createProject();
    writeInstructions(project.instructionsPath, formatProjectAgentInstructions("0.2.2"));

    const run = await serveProject(project, "0.2.3");

    expect(run.exitCode).toBe(0);
    expect(readFileSync(project.instructionsPath, "utf8")).toBe(
      formatProjectAgentInstructions("0.2.3"),
    );
    const lines = run.stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^MileStack HTTP service running at /);
    expect(lines[1]).toBe(`已将 ${project.instructionsPath} 从 0.2.2 刷新到 0.2.3。`);
    expect(run.stderr).toBe("");
    // The file sits beside the project database, with no temporary leftovers.
    expect(readdirSync(path.dirname(project.instructionsPath)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(run.health).toMatchObject({ status: "ok" });
  });

  it("still reports a newer registry version and keeps /api/health working after a refresh", async () => {
    const project = createProject();
    writeInstructions(project.instructionsPath, formatProjectAgentInstructions("0.2.2"));

    const run = await serveProject(project, "0.2.3", { latestVersion: "9.9.9" });

    expect(run.stdout).toContain("MileStack 0.2.3 → 9.9.9 可用；");
    expect(run.stdout).toContain("从 0.2.2 刷新到 0.2.3");
    expect(run.health).toMatchObject({ status: "ok" });
  });

  for (const [label, fileVersion, runningVersion] of [
    ["the same version", "0.2.3", "0.2.3"],
    ["a newer file version", "0.3.0", "0.2.3"],
    ["an unknown running version", "0.2.2", "unknown"],
  ]) {
    it(`leaves the file and output alone for ${label}`, async () => {
      const project = createProject();
      const original = formatProjectAgentInstructions(fileVersion ?? "");
      writeInstructions(project.instructionsPath, original);
      const past = new Date("2020-01-01T00:00:00Z");
      utimesSync(project.instructionsPath, past, past);

      const run = await serveProject(project, runningVersion ?? "");

      expect(readFileSync(project.instructionsPath, "utf8")).toBe(original);
      expect(statSync(project.instructionsPath).mtimeMs).toBe(past.getTime());
      expect(run.stdout.trim().split("\n")).toHaveLength(1);
      expect(run.stderr).toBe("");
    });
  }

  it("does not create a missing file and points to milestack update", async () => {
    const project = createProject();

    const run = await serveProject(project, "0.2.3");

    expect(run.exitCode).toBe(0);
    expect(() => statSync(project.instructionsPath)).toThrow();
    const lines = run.stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("milestack update");
    expect(run.health).toMatchObject({ status: "ok" });
  });

  it("does not overwrite a file whose first line has no generation marker", async () => {
    const project = createProject();
    const edited = "# My own instructions\n\nhand written\n";
    writeInstructions(project.instructionsPath, edited);

    const run = await serveProject(project, "0.2.3");

    expect(run.exitCode).toBe(0);
    expect(readFileSync(project.instructionsPath, "utf8")).toBe(edited);
    const lines = run.stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("milestack update");
    expect(run.health).toMatchObject({ status: "ok" });
  });

  it("warns and keeps the old file intact when the write fails, while serve still starts", async () => {
    const project = createProject();
    const original = formatProjectAgentInstructions("0.2.2");
    writeInstructions(project.instructionsPath, original);

    const run = await serveProject(project, "0.2.3", {
      writeFile: () => {
        throw new Error("EACCES: permission denied");
      },
    });

    expect(run.exitCode).toBe(0);
    expect(readFileSync(project.instructionsPath, "utf8")).toBe(original);
    expect(run.stdout.trim().split("\n")).toHaveLength(1);
    expect(run.stdout).toMatch(/^MileStack HTTP service running at /);
    expect(run.stderr.trim().split("\n")).toHaveLength(1);
    expect(run.stderr).toContain("EACCES: permission denied");
    expect(run.stderr).toContain(project.instructionsPath);
    expect(run.health).toMatchObject({ status: "ok" });
  });

  it("removes its temporary file when the atomic write cannot complete", () => {
    const project = createProject();
    const targetDirectory = path.join(project.projectRoot, "target-is-a-directory");
    mkdirSync(targetDirectory);

    expect(() => writeFileAtomically(targetDirectory, "content")).toThrow();

    expect(readdirSync(project.projectRoot).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
