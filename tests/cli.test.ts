import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { helpText, runCli } from "../src/cli/command.js";
import { openProjectContext } from "../src/project/project-context.js";

const temporaryProjects: string[] = [];

function createTemporaryProject(): string {
  const projectRoot = path.join(os.tmpdir(), `milestack-cli-${randomUUID()}`);
  mkdirSync(projectRoot, { recursive: true });
  temporaryProjects.push(projectRoot);
  return projectRoot;
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

afterEach(() => {
  for (const projectRoot of temporaryProjects.splice(0)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

describe("CLI entry point", () => {
  it("prints help and exits successfully", async () => {
    const capture = outputCapture();

    const exitCode = await runCli(["--help"], capture.output);

    expect(exitCode).toBe(0);
    expect(capture.stdout.join("")).toBe(helpText);
    expect(capture.stderr).toHaveLength(0);
  });

  it("initializes idempotently and preserves existing gitignore content", async () => {
    const projectRoot = createTemporaryProject();
    writeFileSync(path.join(projectRoot, ".gitignore"), "dist/\n.milestack/\n");
    const first = outputCapture();

    expect(await runCli(["init", "--project", projectRoot], first.output)).toBe(0);
    expect(first.stderr).toEqual([]);
    expect(readFileSync(path.join(projectRoot, ".gitignore"), "utf8")).toBe(
      "dist/\n.milestack/\n",
    );

    const second = outputCapture();
    expect(await runCli(["init", "--project", projectRoot], second.output)).toBe(0);
    const gitignore = readFileSync(path.join(projectRoot, ".gitignore"), "utf8");
    expect(gitignore.match(/^\.milestack\/$/gm)).toHaveLength(1);
    expect(second.stdout.join("")).toContain("Already initialized");
  });

  it("prints status through TaskService and distinguishes runnable work", async () => {
    const projectRoot = createTemporaryProject();
    const init = outputCapture();
    expect(await runCli(["init", "--project", projectRoot], init.output)).toBe(0);

    const context = await openProjectContext(projectRoot);
    const prerequisite = context.service.createTask({
      projectId: context.project.id,
      title: "Prerequisite",
      createdBy: "developer",
      queuePosition: 1,
    });
    context.service.createTask({
      projectId: context.project.id,
      title: "Waiting task",
      createdBy: "developer",
      queuePosition: 2,
      dependencyIds: [prerequisite.task.id],
    });
    context.database.close();

    const status = outputCapture();
    expect(await runCli(["status", "--project", projectRoot], status.output)).toBe(0);
    expect(status.stdout.join("")).toContain("[可执行]");
    expect(status.stdout.join("")).toContain("[等待依赖]");
    expect(status.stdout.join("")).toContain("Prerequisite");
    expect(status.stdout.join("")).toContain("Waiting task");
  });

  it("outputs structured JSON format when --json is provided", async () => {
    const projectRoot = createTemporaryProject();
    const init = outputCapture();
    expect(await runCli(["init", "--project", projectRoot], init.output)).toBe(0);

    const context = await openProjectContext(projectRoot);
    context.service.createTask({
      projectId: context.project.id,
      title: "Json Task",
      status: "inbox",
      createdBy: "developer",
    });
    context.database.close();

    const status = outputCapture();
    expect(await runCli(["status", "--project", projectRoot, "--json"], status.output)).toBe(0);
    const parsed = JSON.parse(status.stdout.join(""));
    expect(parsed.project.id).toBeDefined();
    expect(parsed.inbox.length).toBe(1);
    expect(parsed.inbox[0].title).toBe("Json Task");
  });

  it("strips ANSI color escape codes when NO_COLOR environment variable is set", async () => {
    const projectRoot = createTemporaryProject();
    const init = outputCapture();
    expect(await runCli(["init", "--project", projectRoot], init.output)).toBe(0);

    const originalNoColor = process.env.NO_COLOR;
    try {
      process.env.NO_COLOR = "1";
      const statusNoColor = outputCapture();
      expect(await runCli(["status", "--project", projectRoot], statusNoColor.output)).toBe(0);
      const text = statusNoColor.stdout.join("");
      expect(text).not.toContain("\x1b[");
      expect(text).toContain("项目：");
    } finally {
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }
    }
  });
});
