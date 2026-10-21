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
import { acceptanceCriteriaPreSubmissionCheck } from "../../src/core/agent-instructions.js";
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
    expect(instructions).toContain("When no taskId is known, call get_project_status");
    expect(instructions).toContain("provides a taskId, call get_task directly");
    expect(instructions).toContain(
      "After reading the task details and confirming that its status is ready, call start_task",
    );
    expect(instructions).toContain("Do not expect get_task to expose runnable");
    expect(instructions).not.toMatch(/[\u3400-\u9fff]/u);

    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name);
    expect(toolNames).toEqual([
      "get_project_status",
      "list_tasks",
      "get_task",
      "create_task",
      "create_tasks",
      "start_task",
      "update_task",
      "submit_for_review",
      "start_review",
      "approve_review",
      "request_changes",
      "complete_review",
      "check_task_integration",
    ]);
    expect(toolNames).toContain("submit_for_review");
    expect(toolNames).not.toContain("finish_task");
    const createTaskTool = listed.tools.find((tool) => tool.name === "create_task");
    const createTasksTool = listed.tools.find((tool) => tool.name === "create_tasks");
    expect(createTaskTool?.description).toContain(acceptanceCriteriaPreSubmissionCheck);
    expect(createTasksTool?.description).toContain(acceptanceCriteriaPreSubmissionCheck);
    expect(createTaskTool?.description).not.toContain("createPhoneBindingPage");
    expect(createTasksTool?.description).not.toContain("createPhoneBindingPage");
    const approveReviewTool = listed.tools.find((tool) => tool.name === "approve_review");
    const requestChangesTool = listed.tools.find((tool) => tool.name === "request_changes");
    const getTaskTool = listed.tools.find((tool) => tool.name === "get_task");
    expect(approveReviewTool?.inputSchema).toMatchObject({
      required: expect.arrayContaining(["taskId", "reviewRunId", "summary"]),
    });
    expect(requestChangesTool?.inputSchema).toMatchObject({
      required: expect.arrayContaining(["taskId", "reviewRunId", "summary", "findings"]),
    });
    expect(approveReviewTool?.inputSchema.properties).not.toHaveProperty("decision");
    expect(requestChangesTool?.inputSchema.properties).not.toHaveProperty("decision");
    expect(requestChangesTool?.inputSchema.properties).not.toHaveProperty(
      "verificationEvidence",
    );
    expect(getTaskTool?.inputSchema.properties?.view).toMatchObject({
      enum: ["working", "full"],
      default: "working",
    });

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
    const workingDetails = JSON.parse(textContent(details));
    expect(workingDetails).toMatchObject({
      task: { id: createdTask.task.id, title: "Record discovered work" },
      phase: "implementation",
      dependencies: [],
      currentRunEvents: [],
      latestSubmission: null,
      previousFindings: [],
      openFindings: [],
    });
    expect(workingDetails).not.toHaveProperty("events");
    expect(workingDetails).not.toHaveProperty("reviews");
    const fullDetails = await client.callTool({
      name: "get_task",
      arguments: { taskId: createdTask.task.id, view: "full" },
    });
    expect(JSON.parse(textContent(fullDetails))).toMatchObject({
      events: [{ type: "created" }],
      reviews: [],
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

  it("completes the start, update, and submit-for-review MCP workflow", async () => {
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

    const submitted = await client.callTool({
      name: "submit_for_review",
      arguments: {
        taskId: ready.task.id,
        runId: startedValue.runId,
        commitSha: "7777777777777777777777777777777777777777",
        summary: "Done",
      },
    });
    const submittedValue = JSON.parse(textContent(submitted));
    expect(submittedValue.task.status).toBe("in_review");
    expect(submittedValue.task.completedAt).toBeNull();
    expect(submittedValue.task.activeRunId).toBeNull();
    expect(submittedValue.events.at(-1).type).toBe("submitted_for_review");
    expect(submittedValue.events.at(-1).actorLabel).toBe("gpt-5-codex");

    const submittedDetails = await client.callTool({
      name: "get_task",
      arguments: { taskId: ready.task.id },
    });
    const submittedWorkingDetails = JSON.parse(textContent(submittedDetails));
    expect(submittedWorkingDetails).toMatchObject({
      task: {
        id: ready.task.id,
        riskLevel: "medium",
        status: "in_review",
      },
      phase: "review",
      latestSubmission: {
        summary: "Done",
        criteriaResults: [],
        review: {
          reviewRound: 1,
          commitSha: "7777777777777777777777777777777777777777",
          status: "pending",
        },
      },
      currentRunEvents: [],
    });
    expect(submittedWorkingDetails).not.toHaveProperty("events");
    expect(submittedWorkingDetails).not.toHaveProperty("reviews");
    const fullSubmittedDetails = await client.callTool({
      name: "get_task",
      arguments: { taskId: ready.task.id, view: "full" },
    });
    expect(JSON.parse(textContent(fullSubmittedDetails)).reviews).toHaveLength(1);
    expect(JSON.parse(textContent(fullSubmittedDetails)).events.at(-1).type).toBe(
      "submitted_for_review",
    );

    const reviewStarted = await client.callTool({
      name: "start_review",
      arguments: { taskId: ready.task.id },
    });
    const reviewStartedValue = JSON.parse(textContent(reviewStarted));
    expect(reviewStartedValue.reviewRunId).toBeTruthy();
    expect(reviewStartedValue.task.reviews.at(-1)).toMatchObject({
      status: "in_progress",
      reviewerActorLabel: "agent",
    });

    const reviewCompleted = await client.callTool({
      name: "approve_review",
      arguments: {
        taskId: ready.task.id,
        reviewRunId: reviewStartedValue.reviewRunId,
        summary: "Verified the implementation.",
        findings: [
          {
            issue: "No blocking issues found.",
            suggestion: "Keep the focused regression coverage.",
            severity: "low",
            trigger: "The lifecycle workflow is exercised end to end.",
            impact: "Dropping the regression coverage would let the lifecycle break silently.",
            evidence: "pnpm test tests/mcp/mcp.test.ts: lifecycle workflow passes.",
          },
        ],
        verificationEvidence: [{ command: "pnpm test", result: "passed" }],
      },
    });
    const reviewCompletedValue = JSON.parse(textContent(reviewCompleted));
    expect(reviewCompletedValue.task.status).toBe("in_review");
    expect(reviewCompletedValue.reviews.at(-1)).toMatchObject({
      status: "passed",
      reviewerActorLabel: "agent",
      verificationEvidence: [{ command: "pnpm test", result: "passed" }],
    });

    await client.close();
    await server.close();
    context.database.close();
  });
});
