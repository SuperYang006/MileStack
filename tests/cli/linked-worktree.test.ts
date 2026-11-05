import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/command.js";
import { openProjectContext } from "../../src/project/project-context.js";
import {
  createRepositoryWithLinkedWorktree,
  type RepositoryWithLinkedWorktree,
} from "../helpers/linked-worktree-repository.js";

const repositories: RepositoryWithLinkedWorktree[] = [];

function createRepository(): RepositoryWithLinkedWorktree {
  const repository = createRepositoryWithLinkedWorktree();
  repositories.push(repository);
  return repository;
}

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    repository.cleanup();
  }
});

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

function databasePath(root: string): string {
  return path.join(root, ".milestack", "milestack.db");
}

async function initializeMainWorktree(mainRoot: string, taskTitle: string): Promise<string> {
  const init = outputCapture();
  expect(await runCli(["init", "--project", mainRoot], init.output)).toBe(0);
  const context = await openProjectContext(mainRoot);
  try {
    context.service.createTask({
      projectId: context.project.id,
      title: taskTitle,
      createdBy: "developer",
      status: "ready",
    });
    return context.project.id;
  } finally {
    context.database.close();
  }
}

async function inDirectory<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const originalCwd = process.cwd();
  process.chdir(directory);
  try {
    return await action();
  } finally {
    process.chdir(originalCwd);
  }
}

describe("linked git worktree", () => {
  it("status --discover from a linked worktree shows the main worktree project", async () => {
    const { mainRoot, worktreeRoot } = createRepository();
    const projectId = await initializeMainWorktree(mainRoot, "Task in main worktree");

    const status = outputCapture();
    expect(
      await inDirectory(worktreeRoot, () => runCli(["status", "--discover"], status.output)),
    ).toBe(0);
    expect(status.stdout.join("")).toContain(projectId);
    expect(status.stdout.join("")).toContain("Task in main worktree");
    expect(existsSync(databasePath(worktreeRoot))).toBe(false);
  });

  it("status --project pointing at a linked worktree opens the main worktree project", async () => {
    const { mainRoot, worktreeRoot } = createRepository();
    const projectId = await initializeMainWorktree(mainRoot, "Task in main worktree");

    const status = outputCapture();
    expect(await runCli(["status", "--project", worktreeRoot], status.output)).toBe(0);
    expect(status.stdout.join("")).toContain(projectId);
    expect(existsSync(databasePath(worktreeRoot))).toBe(false);
  });

  it("init --client claude in a linked worktree links to the main project without a new database", async () => {
    const { mainRoot, worktreeRoot } = createRepository();
    const projectId = await initializeMainWorktree(mainRoot, "Task in main worktree");

    const init = outputCapture();
    expect(
      await runCli(["init", "--project", worktreeRoot, "--client", "claude"], init.output),
    ).toBe(0);

    expect(existsSync(databasePath(worktreeRoot))).toBe(false);
    expect(existsSync(path.join(worktreeRoot, ".milestack", "agent-instructions.md"))).toBe(true);

    const mcpConfig = JSON.parse(readFileSync(path.join(worktreeRoot, ".mcp.json"), "utf8")) as {
      mcpServers: { milestack: { args: string[] } };
    };
    expect(mcpConfig.mcpServers.milestack.args.slice(-3)).toEqual(["mcp", "--project", mainRoot]);

    expect(init.stdout.join("")).toContain(
      `Linked git worktree ${worktreeRoot} uses the MileStack project of its main worktree ${mainRoot}`,
    );
    expect(init.stdout.join("")).toContain("已关联到主工作树的 MileStack 项目");

    // The main project still holds the same single task and project.
    expect(existsSync(path.join(mainRoot, ".mcp.json"))).toBe(false);
    const context = await openProjectContext(mainRoot);
    try {
      expect(context.project.id).toBe(projectId);
      const status = context.service.getProjectStatus({ projectId, view: "full" });
      expect(status.next.map((task) => task.title)).toEqual(["Task in main worktree"]);
    } finally {
      context.database.close();
    }
  });

  it("init in a linked worktree fails without creating files when the main worktree is not initialized", async () => {
    const { mainRoot, worktreeRoot } = createRepository();

    const init = outputCapture();
    expect(
      await runCli(["init", "--project", worktreeRoot, "--client", "claude"], init.output),
    ).toBe(1);

    expect(init.stderr.join("")).toContain(mainRoot);
    expect(init.stderr.join("")).toContain("milestack init");
    for (const root of [mainRoot, worktreeRoot]) {
      expect(existsSync(path.join(root, ".milestack"))).toBe(false);
      expect(existsSync(path.join(root, ".mcp.json"))).toBe(false);
      expect(existsSync(path.join(root, ".gitignore"))).toBe(false);
    }
  });

  it("status and mcp in a linked worktree fail without files while the main worktree is uninitialized, then resolve once it is", async () => {
    const { mainRoot, worktreeRoot } = createRepository();

    const failures = [
      outputCapture(),
      outputCapture(),
      outputCapture(),
    ];
    expect(await runCli(["status", "--project", worktreeRoot], failures[0]!.output)).toBe(1);
    expect(await runCli(["mcp", "--project", worktreeRoot], failures[1]!.output)).toBe(1);
    expect(
      await inDirectory(worktreeRoot, () => runCli(["mcp", "--discover"], failures[2]!.output)),
    ).toBe(1);
    expect(failures[0]!.stderr.join("")).toContain(mainRoot);
    expect(failures[0]!.stderr.join("")).toContain("milestack init");
    for (const root of [mainRoot, worktreeRoot]) {
      expect(existsSync(path.join(root, ".milestack"))).toBe(false);
    }

    const projectId = await initializeMainWorktree(mainRoot, "Task in main worktree");
    const status = outputCapture();
    expect(await runCli(["status", "--project", worktreeRoot], status.output)).toBe(0);
    expect(status.stdout.join("")).toContain(projectId);
    expect(existsSync(path.join(worktreeRoot, ".milestack"))).toBe(false);
  });

  it("init in the main worktree of a git repository still creates its own database", async () => {
    const { mainRoot, worktreeRoot } = createRepository();

    const init = outputCapture();
    expect(await runCli(["init", "--project", mainRoot], init.output)).toBe(0);

    expect(existsSync(databasePath(mainRoot))).toBe(true);
    expect(existsSync(databasePath(worktreeRoot))).toBe(false);
    expect(init.stdout.join("")).toContain(`Initialized ${mainRoot}`);
  });
});
