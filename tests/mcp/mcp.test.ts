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

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "get_project_status",
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
      },
    });
    const createdTask = JSON.parse(textContent(created));
    expect(createdTask.task.status).toBe("inbox");
    expect(createdTask.task.dependencyIds).toEqual([]);

    const batch = await client.callTool({
      name: "create_tasks",
      arguments: {
        tasks: [
          { title: "First discovered item" },
          { title: "Second discovered item", dependencyIds: [createdTask.task.id] },
        ],
      },
    });
    expect(JSON.parse(textContent(batch))).toHaveLength(2);

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

    const started = await client.callTool({
      name: "start_task",
      arguments: { taskId: ready.task.id },
    });
    const startedValue = JSON.parse(textContent(started));
    expect(startedValue.runId).toBeTruthy();

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
    expect(JSON.parse(textContent(updated)).task.currentStep).toBe("Working");

    const finished = await client.callTool({
      name: "finish_task",
      arguments: {
        taskId: ready.task.id,
        runId: startedValue.runId,
        summary: "Done",
      },
    });
    expect(JSON.parse(textContent(finished)).task.status).toBe("completed");

    await client.close();
    await server.close();
    context.database.close();
  });
});
