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

// Holds a port that the OS picked as free and never releases it mid-test: the
// listen(0) socket serves the responder directly, so no concurrent allocator
// can take the port between a probe and a bind. Ports within 10 of the top of
// the port space are re-drawn so a test range above the hold still fits.
async function holdEphemeralPort(responder: Responder): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const server = http.createServer(responder);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    if (port <= 65525) {
      closers.push(async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      });
      return port;
    }
    await new Promise((resolve) => server.close(resolve));
  }
  throw new Error("could not hold an ephemeral port with room for a range above it");
}

// Takes an exact port for our own use, waiting out short-lived occupants. A
// persistent listener never yields within the budget, which is fine: the
// ascending scan skips it all the same. The answer only tells the caller who
// will be holding the port when the scan runs; either way it stays occupied.
async function holdExactPort(port: number, responder: Responder): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await occupy(port, responder);
      return;
    } catch (error) {
      if (!(error instanceof Error && (error as NodeJS.ErrnoException).code === "EADDRINUSE")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
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
    // `base` is held by our own socket with no probe-to-bind gap, so no other
    // process on this machine can take it. The other project's serve then
    // takes the first bindable port above it: every port it could not take
    // stays occupied, so the ascending scan reaches the held serve before any
    // free port and skips both occupant types.
    const base = await holdEphemeralPort(unrelatedProgram);
    const other = createProject();
    const lastPort = base + 10;
    type OtherServe = Awaited<ReturnType<typeof startHttpServer>>;
    let otherServe: OtherServe | null = null;
    let otherPort = 0;
    for (let port = base + 1; port <= lastPort; port += 1) {
      if (await isListening(port)) {
        // The squatter may be short-lived and free the port before the scan,
        // which would let the scan land below the real serve. Hold it
        // ourselves, or confirm its occupant is persistent; either way the
        // scan will skip this port.
        await holdExactPort(port, unrelatedProgram);
        continue;
      }
      try {
        otherServe = await startHttpServer({
          projectRoot: other.projectRoot,
          staticDir: other.staticDir,
          port,
        });
        otherPort = port;
        break;
      } catch (error) {
        // Lost a race with an allocator that appeared during startup; hold
        // the port so the skipped prefix stays stable, then try the next one.
        // A failed explicit-port start leaks its project context, so this
        // loop normally stops at the first bindable port: base + 1.
        if (!(error instanceof Error && (error as NodeJS.ErrnoException).code === "EADDRINUSE")) {
          throw error;
        }
        await holdExactPort(port, unrelatedProgram);
      }
    }
    if (otherServe === null) {
      throw new Error(`could not place the other project's serve above ${base}`);
    }
    const heldServe = otherServe;
    closers.push(() => heldServe.app.close());
    const project = createProject();

    const run = await serveInRange(project, { first: base, last: lastPort });

    expect(run.exitCode).toBe(0);
    // Unrelated processes may take further ports at any moment, so the exact
    // landing port is not asserted. The scan is ascending, so landing above
    // the held serve still proves that the other program and the other
    // project's serve were both skipped, and the notice must name the actual
    // landing port.
    const servedUrl = run.server?.url ?? "";
    expect(servedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const servedPort = Number(new URL(servedUrl).port);
    expect(servedPort).toBeGreaterThan(otherPort);
    const lines = run.stdout.trim().split("\n");
    expect(lines[0]).toMatch(new RegExp(`^端口 ${base}(?:、\\d+)*、${otherPort}(?:、\\d+)* 已被占用，改用 ${servedPort}。$`));
    expect(lines[1]).toBe(`MileStack HTTP service running at http://127.0.0.1:${servedPort}`);
    expect(run.health).toMatchObject({ status: "ok" });
  }, 15_000); // real servers and SQLite inits on a machine shared with other agents

  it("keeps the generated-file refresh and the version check working on a fallback port", async () => {
    const base = await holdEphemeralPort(unrelatedProgram);
    const project = createProject();
    mkdirSync(path.dirname(project.instructionsPath), { recursive: true });
    writeFileSync(project.instructionsPath, formatProjectAgentInstructions("0.2.2"));

    const run = await serveInRange(project, { first: base, last: base + 9 }, {
      currentVersion: "0.2.3",
      latestVersion: "9.9.9",
    });

    // Unrelated processes may take ports next to the controlled occupant at
    // any moment, so the exact landing port is not asserted. The scan is
    // ascending, so landing above `base` still proves the real fallback
    // happened, on whatever port this machine left free.
    const servedUrl = run.server?.url ?? "";
    expect(servedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const servedPort = Number(new URL(servedUrl).port);
    expect(servedPort).toBeGreaterThan(base);
    const lines = run.stdout.trim().split("\n");
    expect(lines[0]).toMatch(new RegExp(`^端口 ${base}(?:、\\d+)* 已被占用，改用 ${servedPort}。$`));
    expect(lines[1]).toBe(`MileStack HTTP service running at http://127.0.0.1:${servedPort}`);
    expect(readFileSync(project.instructionsPath, "utf8")).toBe(formatProjectAgentInstructions("0.2.3"));
    expect(run.stdout).toContain("从 0.2.2 刷新到 0.2.3");
    expect(run.stdout).toContain("MileStack 0.2.3 → 9.9.9 可用；");
    expect(run.health?.update?.latestVersion).toBe("9.9.9");
  }, 15_000); // real servers and SQLite inits on a machine shared with other agents

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

  it("does not follow a redirect from an occupant, so nothing beyond it is contacted or trusted", async () => {
    const base = await freeBasePort();
    const project = createProject();
    const existing = await startHttpServer({
      projectRoot: project.projectRoot,
      staticDir: project.staticDir,
      port: 0,
    });
    const projectId = existing.context.project.id;
    await existing.app.close();
    // The redirect target answers as this very project; following it would make
    // the unrelated occupant look like an already-running serve.
    const targetPort = base + 10;
    let targetRequests = 0;
    await occupy(targetPort, (_request, response) => {
      targetRequests += 1;
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: projectId }));
    });
    await occupy(base, (_request, response) => {
      response.writeHead(302, { location: `http://127.0.0.1:${targetPort}/api/project` }).end();
    });

    const run = await serveInRange(project, { first: base, last: base + 3 });

    expect(run.exitCode).toBe(0);
    expect(run.server?.url).toBe(`http://127.0.0.1:${base + 1}`);
    expect(targetRequests).toBe(0);
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
