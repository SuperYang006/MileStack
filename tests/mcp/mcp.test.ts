import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  initializeProject,
  openProjectContext,
} from "../../src/project/project-context.js";
import { createMcpServer } from "../../src/mcp/server.js";

const temporaryProjects: string[] = [];

function createTemporaryProject(): string {
  const projectRoot = path.join(os.tmpdir(), `milestack-mcp-${randomUUID()}`);
  mkdirSync(projectRoot, { recursive: true });
  temporaryProjects.push(projectRoot);
  return projectRoot;
}

function textContent(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) {
    throw new Error("MCP result did not contain content.");
  }
  const content = result.content[0];
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

describe("MCP task tools", () => {
  it("lists tools and completes the query and inbox recording workflow", async () => {
    const projectRoot = createTemporaryProject();
    const initialized = await initializeProject(projectRoot);
    initialized.database.close();
    const context = await openProjectContext(projectRoot);
    const server = createMcpServer(context);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const instructions = client.getInstructions();
    expect(instructions).toContain("没有已知 taskId 时，调用 get_project_status");
    expect(instructions).toContain("已经提供 taskId 时，直接调用 get_task");
    expect(instructions).toContain("读取任务详情后调用 start_task");

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "get_project_status",
      "list_tasks",
      "get_task",
      "create_task",
      "create_tasks",
      "start_task",
      "update_task",
      "finish_task",
    ]);

    const initialStatus = await client.callTool({
      name: "get_project_status",
      arguments: {},
    });
    expect(JSON.parse(textContent(initialStatus))).toMatchObject({
      view: "compact",
      project: { name: path.basename(projectRoot) },
      current: [],
      next: [],
      inbox: [],
    });

    const created = await client.callTool({
      name: "create_task",
      arguments: {
        title: "Record discovered work",
        objective: "Keep the new work in inbox until reviewed",
        acceptanceCriteria: ["It appears in the inbox"],
        actorLabel: "gpt-5-codex",
      },
    });
    const createdTask = JSON.parse(textContent(created));
    expect(createdTask.task.status).toBe("inbox");
    expect(createdTask.task.dependencyIds).toEqual([]);
    expect(createdTask.events[0]).toMatchObject({
      type: "created",
      actorLabel: "gpt-5-codex",
    });

    const batch = await client.callTool({
      name: "create_tasks",
      arguments: {
        tasks: [
          { title: "First discovered item" },
          {
            title: "Second discovered item",
            dependencyIds: [createdTask.task.id],
            actorLabel: "batch-model",
          },
        ],
      },
    });
    const batchTasks = JSON.parse(textContent(batch));
    expect(batchTasks).toHaveLength(2);
    expect(batchTasks[0].events[0].actorLabel).toBe("agent");
    expect(batchTasks[1].events[0].actorLabel).toBe("batch-model");

    const details = await client.callTool({
      name: "get_task",
      arguments: { taskId: createdTask.task.id },
    });
    expect(JSON.parse(textContent(details))).toMatchObject({
      task: { id: createdTask.task.id, title: "Record discovered work" },
      events: [{ type: "created" }],
    });

    const invalid = await client.callTool({
      name: "get_task",
      arguments: { taskId: "missing-task" },
    });
    expect(invalid.isError).toBe(true);
    expect(textContent(invalid)).toContain("TASK_NOT_FOUND");

    await client.close();
    await server.close();
    context.database.close();
  });

  it("completes the start, update, and finish MCP workflow", async () => {
    const projectRoot = createTemporaryProject();
    const initialized = await initializeProject(projectRoot);
    initialized.database.close();
    const context = await openProjectContext(projectRoot);
    const ready = context.service.createTask({
      projectId: context.project.id,
      title: "Run lifecycle",
      createdBy: "developer",
      status: "ready",
    });
    const server = createMcpServer(context);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const compactStatus = await client.callTool({
      name: "get_project_status",
      arguments: {},
    });
    expect(JSON.parse(textContent(compactStatus))).toMatchObject({
      view: "compact",
      counts: { ready: 1 },
    });

    const fullStatus = await client.callTool({
      name: "get_project_status",
      arguments: { view: "full" },
    });
    expect(JSON.parse(textContent(fullStatus))).not.toHaveProperty("view");

    const firstPage = await client.callTool({
      name: "list_tasks",
      arguments: { status: "ready", limit: 1 },
    });
    const firstPageValue = JSON.parse(textContent(firstPage));
    expect(firstPageValue.tasks).toHaveLength(1);
    expect(firstPageValue.tasks[0].id).toBe(ready.task.id);
    expect(firstPageValue.hasMore).toBe(false);

    const details = await client.callTool({
      name: "get_task",
      arguments: { taskId: ready.task.id },
    });
    expect(JSON.parse(textContent(details))).toMatchObject({
      task: { id: ready.task.id, status: "ready" },
    });

    const started = await client.callTool({
      name: "start_task",
      arguments: { taskId: ready.task.id, actorLabel: "gpt-5-codex" },
    });
    const startedValue = JSON.parse(textContent(started));
    expect(startedValue.runId).toBeTruthy();
    expect(startedValue.task.events.at(-1)).toMatchObject({
      type: "started",
      actorLabel: "gpt-5-codex",
    });

    const updated = await client.callTool({
      name: "update_task",
      arguments: {
        taskId: ready.task.id,
        runId: startedValue.runId,
        summary: "Made progress",
        currentStep: "Working",
        nextStep: "Finish",
      },
    });
    const updatedValue = JSON.parse(textContent(updated));
    expect(updatedValue.task.currentStep).toBe("Working");
    expect(updatedValue.events.at(-1).actorLabel).toBe("gpt-5-codex");

    const finished = await client.callTool({
      name: "finish_task",
      arguments: {
        taskId: ready.task.id,
        runId: startedValue.runId,
        summary: "Done",
      },
    });
    const finishedValue = JSON.parse(textContent(finished));
    expect(finishedValue.task.status).toBe("in_review");
    expect(finishedValue.task.completedAt).toBeNull();
    expect(finishedValue.events.at(-1).type).toBe("submitted_for_review");
    expect(finishedValue.events.at(-1).actorLabel).toBe("gpt-5-codex");

    await client.close();
    await server.close();
    context.database.close();
  });
});
