import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, expect, it } from "vitest";

import {
  initializeProject,
  openProjectContext,
} from "../../src/project/project-context.js";

const temporaryProjects: string[] = [];

function textContent(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result)) {
    throw new Error("MCP result did not contain content.");
  }
  const content = Array.isArray(result.content) ? result.content[0] : undefined;
  if (
    !content ||
    typeof content !== "object" ||
    !("type" in content) ||
    content.type !== "text" ||
    !("text" in content) ||
    typeof content.text !== "string"
  ) {
    throw new Error("MCP result did not contain text content.");
  }
  return content.text;
}

afterEach(() => {
  for (const projectRoot of temporaryProjects.splice(0)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

it(
  "completes a real stdio review workflow",
  async () => {
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

    const projectRoot = path.join(os.tmpdir(), `milestack-review-stdio-${randomUUID()}`);
    mkdirSync(projectRoot, { recursive: true });
    temporaryProjects.push(projectRoot);
    const initialized = await initializeProject(projectRoot);
    initialized.database.close();
    const context = await openProjectContext(projectRoot);
    const ready = context.service.createTask({
      projectId: context.project.id,
      title: "Stdio review smoke test",
      createdBy: "developer",
      status: "ready",
    });
    context.database.close();

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        "--import",
        tsxLoader,
        "src/cli/index.ts",
        "mcp",
        "--project",
        projectRoot,
      ],
      cwd: repositoryRoot,
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-review-smoke", version: "1.0.0" });
    await client.connect(transport);

    try {
      const execution = JSON.parse(
        textContent(
          await client.callTool({
            name: "start_task",
            arguments: { taskId: ready.task.id, actorLabel: "stdio-implementation" },
          }),
        ),
      );
      await client.callTool({
        name: "submit_for_review",
        arguments: {
          taskId: ready.task.id,
          runId: execution.runId,
          commitSha: "4444444444444444444444444444444444444444",
          summary: "Exercise the review protocol over stdio.",
        },
      });
      const review = JSON.parse(
        textContent(
          await client.callTool({
            name: "start_review",
            arguments: { taskId: ready.task.id, actorLabel: "stdio-reviewer" },
          }),
        ),
      );
      const approved = JSON.parse(
        textContent(
          await client.callTool({
            name: "approve_review",
            arguments: {
              taskId: ready.task.id,
              reviewRunId: review.reviewRunId,
              summary: "The stdio workflow succeeded.",
              verificationEvidence: [{ command: "stdio smoke", result: "passed" }],
            },
          }),
        ),
      );

      expect(approved.task).toMatchObject({
        id: ready.task.id,
        status: "in_review",
        riskLevel: "medium",
        activeReviewRunId: null,
      });
      expect(approved.reviews.at(-1)).toMatchObject({
        commitSha: "4444444444444444444444444444444444444444",
        status: "passed",
        reviewerActorLabel: "stdio-reviewer",
      });
    } finally {
      await client.close();
    }
  },
  15_000,
);
