import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatProjectAgentInstructions } from "../../src/core/agent-instructions.js";
import { runServe, type ServeDependencies, type ServeServer } from "../../src/cli/serve.js";
import { defaultServePortRange, type PortRange } from "../../src/server/port-selection.js";
import { startHttpServer, type HttpServerOptions } from "../../src/server/server.js";
import type { CommandRunner } from "../../src/update/command-runner.js";

const temporaryPaths: string[] = [];
const closers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) {
    await close();
  }
  for (const target of temporaryPaths.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

function createProject(): { projectRoot: string; staticDir: string; instructionsPath: string } {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "milestack-serve-port-"));
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

// The real default range starts at 7331, which a developer's own serve may be
// holding, so tests search a range of ports near a currently free one.
async function freeBasePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

type Responder = (request: http.IncomingMessage, response: http.ServerResponse) => void;

async function occupy(port: number, responder: Responder): Promise<void> {
  const server = http.createServer(responder);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  closers.push(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
}

const unrelatedProgram: Responder = (_request, response) => {
  response.writeHead(200, { "content-type": "text/html" }).end("<h1>something else</h1>");
};

const silentProgram: Responder = () => {
  // Accepts the request and never answers.
};

async function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

type ServeRun = {
  exitCode: number;
  stdout: string;
  stderr: string;
  server: ServeServer | null;
  health: { status: string; version: string; update: { latestVersion: string } | null } | null;
};

// Runs the real serve flow against a test range instead of the default one.
async function serveInRange(
  project: ReturnType<typeof createProject>,
  range: PortRange | number,
  options: { currentVersion?: string; latestVersion?: string } = {},
): Promise<ServeRun> {
  const currentVersion = options.currentVersion ?? "unknown";
  const stdout: string[] = [];
  const stderr: string[] = [];
  let server: ServeServer | null = null;
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
    startServer: (startOptions) =>
      startHttpServer({ ...startOptions, staticDir: project.staticDir, port: range }),
    versionCheck: { currentVersion, resolveEntryPath: () => entryPath, runCommand },
    instructions: { currentVersion, writeFile: (target, content) => writeFileSync(target, content) },
    waitForShutdown: async (started) => {
      server = started;
      await started.versionCheck?.done;
      health = await (await fetch(`${started.url}/api/health`)).json();
    },
  };
  const exitCode = await runServe(
    project.projectRoot,
    undefined,
    {
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    },
    dependencies,
  );
  return { exitCode, stdout: stdout.join(""), stderr: stderr.join(""), server, health };
}

describe("milestack serve port selection", () => {
  it("passes the 7331–7350 range by default and exactly the given port when explicit", async () => {
    const received: Array<HttpServerOptions["port"]> = [];
    const dependencies: ServeDependencies = {
      startServer: async (options) => {
        received.push(options.port);
        return { app: { close: async () => {} }, url: "http://127.0.0.1:7331", versionCheck: null };
      },
      versionCheck: { currentVersion: "unknown", resolveEntryPath: () => "", runCommand: async () => ({ status: 1, stdout: "", stderr: "" }) },
      instructions: { currentVersion: "unknown", writeFile: () => {} },
      waitForShutdown: async () => {},
    };
    const output = { writeStdout: () => {}, writeStderr: () => {} };

    await runServe(undefined, undefined, output, dependencies);
    await runServe(undefined, 7331, output, dependencies);

    expect(received).toEqual([defaultServePortRange, 7331]);
    expect(defaultServePortRange).toEqual({ first: 7331, last: 7350 });
  });

  it("moves past ports held by other programs and by another project's serve, and says so", async () => {
    const base = await freeBasePort();
    const range = { first: base, last: base + 5 };
    const other = createProject();
    const otherServe = await startHttpServer({
      projectRoot: other.projectRoot,
      staticDir: other.staticDir,
      port: range,
    });
    closers.push(() => otherServe.app.close());
    expect(otherServe.url).toBe(`http://127.0.0.1:${base}`);
    await occupy(base + 1, unrelatedProgram);
    const project = createProject();

    const run = await serveInRange(project, range);

    expect(run.exitCode).toBe(0);
    expect(run.server?.url).toBe(`http://127.0.0.1:${base + 2}`);
    const lines = run.stdout.trim().split("\n");
    expect(lines).toEqual([
      `端口 ${base}、${base + 1} 已被占用，改用 ${base + 2}。`,
      `MileStack HTTP service running at http://127.0.0.1:${base + 2}`,
    ]);
    expect(run.health).toMatchObject({ status: "ok" });
  });

  it("keeps the generated-file refresh and the version check working on a fallback port", async () => {
    const base = await freeBasePort();
    await occupy(base, unrelatedProgram);
    const project = createProject();
    mkdirSync(path.dirname(project.instructionsPath), { recursive: true });
    writeFileSync(project.instructionsPath, formatProjectAgentInstructions("0.2.2"));

    const run = await serveInRange(project, { first: base, last: base + 3 }, {
      currentVersion: "0.2.3",
      latestVersion: "9.9.9",
    });

    expect(run.server?.url).toBe(`http://127.0.0.1:${base + 1}`);
    expect(readFileSync(project.instructionsPath, "utf8")).toBe(formatProjectAgentInstructions("0.2.3"));
    expect(run.stdout).toContain("从 0.2.2 刷新到 0.2.3");
    expect(run.stdout).toContain("MileStack 0.2.3 → 9.9.9 可用；");
    expect(run.health?.update?.latestVersion).toBe("9.9.9");
  });

  it("does not wait on a silent or unrelated occupant before trying the next port", async () => {
    const base = await freeBasePort();
    await occupy(base, silentProgram);
    await occupy(base + 1, unrelatedProgram);
    await occupy(base + 2, (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: 42 }));
    });
    const project = createProject();
    const startedAt = Date.now();

    const run = await serveInRange(project, { first: base, last: base + 5 });

    expect(run.exitCode).toBe(0);
    expect(run.server?.url).toBe(`http://127.0.0.1:${base + 3}`);
    expect(run.stderr).toBe("");
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });

  it("reports the whole range and suggests --port when every port is taken", async () => {
    const base = await freeBasePort();
    for (const port of [base, base + 1, base + 2]) {
      await occupy(port, unrelatedProgram);
    }
    const project = createProject();

    await expect(serveInRange(project, { first: base, last: base + 2 })).rejects.toThrow(
      `${base}–${base + 2} 端口均已被占用，无法自动选择；请用 --port 指定一个可用端口。`,
    );
  });

  it("does not search for another port when an explicit port is taken", async () => {
    const base = await freeBasePort();
    await occupy(base, unrelatedProgram);
    const project = createProject();

    await expect(serveInRange(project, base)).rejects.toThrow(/EADDRINUSE/);

    expect(await isListening(base + 1)).toBe(false);
  });

  it("reports the existing address and starts nothing when this project's serve is already running", async () => {
    const base = await freeBasePort();
    const range = { first: base, last: base + 5 };
    await occupy(base, unrelatedProgram);
    const project = createProject();
    mkdirSync(path.dirname(project.instructionsPath), { recursive: true });
    const stale = formatProjectAgentInstructions("0.2.2");
    writeFileSync(project.instructionsPath, stale);
    const past = new Date("2020-01-01T00:00:00Z");
    utimesSync(project.instructionsPath, past, past);
    const running = await startHttpServer({
      projectRoot: project.projectRoot,
      staticDir: project.staticDir,
      port: range,
    });
    closers.push(() => running.app.close());
    expect(running.url).toBe(`http://127.0.0.1:${base + 1}`);

    const run = await serveInRange(project, range, { currentVersion: "0.2.3" });

    expect(run.exitCode).toBe(0);
    expect(run.server).toBeNull();
    expect(run.stdout).toBe(`本项目的 serve 已在 http://127.0.0.1:${base + 1} 运行。\n`);
    expect(run.stderr).toBe("");
    expect(await isListening(base + 2)).toBe(false);
    expect(readFileSync(project.instructionsPath, "utf8")).toBe(stale);
    expect(statSync(project.instructionsPath).mtimeMs).toBe(past.getTime());
  });
});
