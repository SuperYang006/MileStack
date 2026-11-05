import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  runServe,
  type ServeDependencies,
  type ServeServer,
} from "../../src/cli/serve.js";
import type {
  CommandInvocation,
  CommandResult,
  CommandRunner,
} from "../../src/update/command-runner.js";
import { startVersionCheck } from "../../src/update/version-check.js";

const currentVersion = "0.2.2";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const target of temporaryPaths.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), `milestack-serve-${prefix}-`));
  temporaryPaths.push(directory);
  return directory;
}

function createNpmGlobalEntry(): { prefix: string; entryPath: string } {
  const prefix = createTemporaryDirectory("prefix");
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

function createProjectLocalEntry(): string {
  const projectRoot = createTemporaryDirectory("project-local");
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "consumer", dependencies: { milestack: "^0.2.0" } }),
  );
  writeFileSync(path.join(projectRoot, "package-lock.json"), "{}\n");
  const packageRoot = path.join(projectRoot, "node_modules", "milestack");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "milestack" }),
  );
  const entryPath = path.join(packageRoot, "dist", "index.js");
  mkdirSync(path.dirname(entryPath), { recursive: true });
  writeFileSync(entryPath, "// project-local entry\n");
  return entryPath;
}

function createSourceRepoEntry(): string {
  const packageRoot = createTemporaryDirectory("repo");
  writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "milestack", version: "9.9.9" }),
  );
  writeFileSync(path.join(packageRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const entryPath = path.join(packageRoot, "dist", "index.js");
  mkdirSync(path.dirname(entryPath), { recursive: true });
  writeFileSync(entryPath, "// source entry\n");
  return entryPath;
}

function createNpxEntry(): string {
  const root = createTemporaryDirectory("npx");
  const npxRoot = path.join(root, ".npm", "_npx", "a1b2c3");
  const packageRoot = path.join(npxRoot, "node_modules", "milestack");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "milestack" }),
  );
  const entryPath = path.join(packageRoot, "dist", "index.js");
  mkdirSync(path.dirname(entryPath), { recursive: true });
  writeFileSync(entryPath, "// npx entry\n");
  return entryPath;
}

function outputCapture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    output: {
      writeStdout: (message: string) => stdout.push(message),
      writeStderr: (message: string) => stderr.push(message),
    },
  };
}

type QueryBehavior =
  | { kind: "latest"; version: string }
  | { kind: "error"; error: Error };

function createCommandFake(prefix: string | null, behavior: QueryBehavior): {
  calls: CommandInvocation[];
  runCommand: CommandRunner;
} {
  const calls: CommandInvocation[] = [];
  const runCommand: CommandRunner = async (invocation) => {
    calls.push({
      command: invocation.command,
      args: [...invocation.args],
      ...(invocation.cwd !== undefined ? { cwd: invocation.cwd } : {}),
    });
    if (invocation.args[0] === "prefix") {
      return prefix === null
        ? { status: 1, stdout: "", stderr: "npm: not found" }
        : { status: 0, stdout: `${prefix}\n`, stderr: "" };
    }
    if (invocation.args[0] === "view") {
      if (behavior.kind === "latest") {
        return { status: 0, stdout: `${behavior.version}\n`, stderr: "" };
      }
      return { status: 1, stdout: "", stderr: behavior.error.message };
    }
    return { status: 1, stdout: "", stderr: "unexpected command" };
  };
  return { calls, runCommand };
}

function createServeDependencies(
  entryPath: string,
  runCommand: CommandRunner,
  closed: () => void,
): ServeDependencies {
  return {
    versionCheck: {
      currentVersion,
      resolveEntryPath: () => entryPath,
      runCommand,
    },
    instructions: { currentVersion: "unknown", writeFile: () => {} },
    startServer: async (options): Promise<ServeServer> => ({
      app: {
        close: async () => {
          closed();
        },
      },
      url: "http://127.0.0.1:7331",
      versionCheck: options.versionCheck
        ? startVersionCheck(options.versionCheck)
        : null,
    }),
    waitForShutdown: async (server) => {
      await server.versionCheck?.done;
    },
  };
}

describe("milestack serve version hint", () => {
  it("prints one line with both versions and the update command for npm global installs", async () => {
    const { prefix, entryPath } = createNpmGlobalEntry();
    const fake = createCommandFake(prefix, { kind: "latest", version: "9.9.9" });
    const capture = outputCapture();
    let closed = false;

    const exitCode = await runServe(
      undefined,
      7331,
      capture.output,
      createServeDependencies(entryPath, fake.runCommand, () => {
        closed = true;
      }),
    );

    expect(exitCode).toBe(0);
    expect(closed).toBe(true);
    const stdout = capture.stdout.join("");
    expect(stdout).toContain("MileStack HTTP service running at http://127.0.0.1:7331");
    expect(stdout).toContain(
      `MileStack ${currentVersion} → 9.9.9 可用；npm 全局安装，可运行 milestack update 升级。`,
    );
    expect(stdout.trim().split("\n")).toHaveLength(2);
    expect(capture.stderr).toEqual([]);
    expect(fake.calls.filter((call) => call.args[0] === "view")).toHaveLength(1);
  });

  it("prints the update command for a project-local installation", async () => {
    const entryPath = createProjectLocalEntry();
    const fake = createCommandFake(null, { kind: "latest", version: "9.9.9" });
    const capture = outputCapture();

    await runServe(
      undefined,
      7331,
      capture.output,
      createServeDependencies(entryPath, fake.runCommand, () => {}),
    );

    const stdout = capture.stdout.join("");
    expect(stdout).toContain(
      `MileStack ${currentVersion} → 9.9.9 可用；项目内安装（npm），可运行 milestack update 升级。`,
    );
  });

  it("prints the source-checkout build command for source and pnpm link --global entries", async () => {
    const entryPath = createSourceRepoEntry();
    const fake = createCommandFake(null, { kind: "latest", version: "9.9.9" });
    const capture = outputCapture();

    await runServe(
      undefined,
      7331,
      capture.output,
      createServeDependencies(entryPath, fake.runCommand, () => {}),
    );

    const stdout = capture.stdout.join("");
    expect(stdout).toContain("pnpm build");
    expect(stdout).not.toContain("milestack update");
  });

  it("prints the npx install command instead of milestack update", async () => {
    const entryPath = createNpxEntry();
    const fake = createCommandFake(null, { kind: "latest", version: "9.9.9" });
    const capture = outputCapture();

    await runServe(
      undefined,
      7331,
      capture.output,
      createServeDependencies(entryPath, fake.runCommand, () => {}),
    );

    const stdout = capture.stdout.join("");
    expect(stdout).toContain("npm install --global milestack@latest");
    expect(stdout).not.toContain("milestack update");
  });

  for (const [label, behavior] of [
    ["already latest", { kind: "latest", version: currentVersion }],
    ["older than current", { kind: "latest", version: "0.0.1" }],
    ["query failure", { kind: "error", error: new Error("ENOTFOUND") }],
  ] satisfies Array<[string, QueryBehavior]>) {
    it(`prints no update hint for ${label}`, async () => {
      const { prefix, entryPath } = createNpmGlobalEntry();
      const fake = createCommandFake(prefix, behavior);
      const capture = outputCapture();

      await runServe(
        undefined,
        7331,
        capture.output,
        createServeDependencies(entryPath, fake.runCommand, () => {}),
      );

      const stdout = capture.stdout.join("");
      expect(stdout).toBe("MileStack HTTP service running at http://127.0.0.1:7331\n");
      expect(capture.stderr).toEqual([]);
    });
  }

  it("drops a late update hint once shutdown has started", async () => {
    const { prefix, entryPath } = createNpmGlobalEntry();
    let resolveView: (result: CommandResult) => void = () => {};
    let markViewStarted: () => void = () => {};
    const viewStarted = new Promise<void>((resolve) => {
      markViewStarted = resolve;
    });
    const runCommand: CommandRunner = async (invocation) => {
      if (invocation.args[0] === "prefix") {
        return { status: 0, stdout: `${prefix}\n`, stderr: "" };
      }
      if (invocation.args[0] === "view") {
        markViewStarted();
        return new Promise<CommandResult>((resolve) => {
          resolveView = resolve;
        });
      }
      return { status: 1, stdout: "", stderr: "unexpected command" };
    };
    const capture = outputCapture();

    const dependencies: ServeDependencies = {
      versionCheck: {
        currentVersion,
        resolveEntryPath: () => entryPath,
        runCommand,
      },
      instructions: { currentVersion: "unknown", writeFile: () => {} },
      startServer: async (options): Promise<ServeServer> => ({
        app: { close: async () => {} },
        url: "http://127.0.0.1:7331",
        versionCheck: options.versionCheck
          ? startVersionCheck(options.versionCheck)
          : null,
      }),
      waitForShutdown: async (server, beginShutdown) => {
        await viewStarted;
        beginShutdown();
        resolveView({ status: 0, stdout: "9.9.9\n", stderr: "" });
        await server.versionCheck?.done;
      },
    };

    await runServe(undefined, 7331, capture.output, dependencies);

    expect(capture.stdout.join("")).toBe(
      "MileStack HTTP service running at http://127.0.0.1:7331\n",
    );
  });

  it("does not query the registry when the running version is unknown", async () => {
    const { prefix, entryPath } = createNpmGlobalEntry();
    const fake = createCommandFake(prefix, { kind: "latest", version: "9.9.9" });
    const capture = outputCapture();
    const dependencies = createServeDependencies(entryPath, fake.runCommand, () => {});
    dependencies.versionCheck.currentVersion = "unknown";

    await runServe(undefined, 7331, capture.output, dependencies);

    expect(fake.calls).toEqual([]);
    expect(capture.stdout.join("")).toBe(
      "MileStack HTTP service running at http://127.0.0.1:7331\n",
    );
  });
});
