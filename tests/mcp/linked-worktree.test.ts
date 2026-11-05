import { existsSync } from "node:fs";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

import { initializeProject } from "../../src/project/project-context.js";
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

function textContent(result: unknown): string {
  const content =
    result && typeof result === "object" && "content" in result && Array.isArray(result.content)
      ? result.content[0]
      : undefined;
  if (!content || content.type !== "text" || typeof content.text !== "string") {
    throw new Error("MCP result did not contain text content.");
  }
  return content.text;
}

async function projectIdSeenBy(cliArguments: string[], cwd: string): Promise<string> {
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

  const client = new Client({ name: "linked-worktree", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", tsxLoader, path.join(repositoryRoot, "src/cli/index.ts"), ...cliArguments],
      cwd,
      stderr: "pipe",
    }),
  );
  try {
    const status = JSON.parse(
      textContent(await client.callTool({ name: "get_project_status", arguments: {} })),
    ) as { project: { id: string } };
    return status.project.id;
  } finally {
    await client.close();
  }
}

describe("MCP server in a linked git worktree", () => {
  it(
    "connects to the main worktree project with --discover and with --project",
    async () => {
      const repository = createRepositoryWithLinkedWorktree();
      repositories.push(repository);
      const main = await initializeProject(repository.mainRoot);
      main.database.close();

      const discovered = await projectIdSeenBy(["mcp", "--discover"], repository.worktreeRoot);
      const explicit = await projectIdSeenBy(
        ["mcp", "--project", repository.worktreeRoot],
        repository.worktreeRoot,
      );

      expect(discovered).toBe(main.project.id);
      expect(explicit).toBe(main.project.id);
      expect(existsSync(path.join(repository.worktreeRoot, ".milestack"))).toBe(false);
    },
    30_000,
  );
});
