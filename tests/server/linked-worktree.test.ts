import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createHttpServer } from "../../src/server/server.js";
import { initializeProject, openProjectContext } from "../../src/project/project-context.js";
import {
  createRepositoryWithLinkedWorktree,
  type RepositoryWithLinkedWorktree,
} from "../helpers/linked-worktree-repository.js";

const repositories: RepositoryWithLinkedWorktree[] = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    repository.cleanup();
  }
});

function createRepository(): RepositoryWithLinkedWorktree {
  const repository = createRepositoryWithLinkedWorktree();
  repositories.push(repository);
  return repository;
}

function createStaticDirectory(root: string): string {
  const staticDir = path.join(root, "static-ui");
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(path.join(staticDir, "index.html"), "<h1>MileStack test UI</h1>\n");
  return staticDir;
}

describe("HTTP server in a linked git worktree", () => {
  it("serves the main worktree project without creating a worktree database", async () => {
    const { mainRoot, worktreeRoot } = createRepository();
    const main = await initializeProject(mainRoot);
    main.database.close();
    const mainContext = await openProjectContext(mainRoot);
    mainContext.service.createTask({
      projectId: mainContext.project.id,
      title: "Task in main worktree",
      createdBy: "developer",
      status: "ready",
    });
    mainContext.database.close();

    const server = await createHttpServer({
      projectRoot: worktreeRoot,
      staticDir: createStaticDirectory(mainRoot),
    });
    try {
      const project = await server.app.inject({ method: "GET", url: "/api/project" });
      expect(JSON.parse(project.payload).id).toBe(main.project.id);
      const status = await server.app.inject({ method: "GET", url: "/api/status" });
      expect(status.payload).toContain("Task in main worktree");
    } finally {
      server.context.database.close();
      await server.app.close();
    }
    expect(existsSync(path.join(worktreeRoot, ".milestack"))).toBe(false);
  });

  it("refuses to start in a linked worktree whose main worktree is uninitialized", async () => {
    const { mainRoot, worktreeRoot } = createRepository();

    await expect(
      createHttpServer({
        projectRoot: worktreeRoot,
        staticDir: createStaticDirectory(worktreeRoot),
      }),
    ).rejects.toThrow(mainRoot);
    expect(existsSync(path.join(worktreeRoot, ".milestack"))).toBe(false);
    expect(existsSync(path.join(mainRoot, ".milestack"))).toBe(false);
  });
});
