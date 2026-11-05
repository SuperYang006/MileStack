import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/command.js";
import {
  initializeProject,
  openProjectContext,
} from "../../src/project/project-context.js";
import {
  acceptanceCriteriaCreationCheck,
  taskCreationReadinessPrompt,
} from "../../src/core/agent-instructions.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { taskStatuses } from "../../src/core/task-model.js";
import type {
  CompactProjectStatus,
  ProjectStatus,
  TaskPage,
  TaskSummary,
} from "../../src/core/query-contract.js";

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

const statusTaskGroups = [
  "current",
  "next",
  "blocked",
  "inReview",
  "inbox",
  "recentlyCompleted",
] as const;

function summariesWithoutDefinitions(tasks: TaskSummary[]) {
  return tasks.map(({ objective, acceptanceCriteria, ...summary }) => summary);
}

function expectStatusWithoutDefinitions(
  actual: ProjectStatus | CompactProjectStatus,
  expected: ProjectStatus | CompactProjectStatus,
) {
  expect(actual.project).toEqual(expected.project);
  expect(actual.latestUpdatedAt).toEqual(expected.latestUpdatedAt);
  expect(actual.counts).toEqual(expected.counts);
  for (const group of statusTaskGroups) {
    expect(actual[group]).toEqual(summariesWithoutDefinitions(expected[group]));
  }
  if ("view" in expected) {
    expect(actual).toMatchObject({ view: "compact", truncated: expected.truncated });
    if (!("view" in actual)) {
      throw new Error("Expected a compact project status from MCP.");
    }
    expect(actual.nextRunnable).toEqual(
      expected.nextRunnable
        ? summariesWithoutDefinitions([expected.nextRunnable])[0]
        : null,
    );
  } else {
    expect(actual).not.toHaveProperty("view");
  }
}

function expectTaskPageWithoutDefinitions(actual: TaskPage, expected: TaskPage) {
  expect(actual.status).toBe(expected.status);
  expect(actual.tasks).toEqual(summariesWithoutDefinitions(expected.tasks));
  expect(actual.nextCursor).toBe(expected.nextCursor);
  expect(actual.hasMore).toBe(expected.hasMore);
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
    expect(instructions).toContain("Review entry:");
    expect(instructions).toContain("confirm phase=review");
    expect(instructions).toContain("call start_review and save the returned reviewRunId");
    expect(instructions).toContain("Review the exact commit recorded in the latest submission");
    expect(instructions).toContain("verify every acceptance criterion independently");
    expect(instructions).toContain(
      "record a closure for every finding from a changes-requested previous round",
    );
    expect(instructions).toContain(
      "Conclude with approve_review, request_changes, or complete_review using the reviewRunId, then stop.",
    );
    expect(instructions).toContain("Implementation stop:");
    expect(instructions).toContain("Review dimensions:");
    expect(instructions).toContain(
      "Do not accept the submitter's criteriaResults as review evidence",
    );
    expect(instructions).toContain(
      "Inspect the reviewed diff for changes outside the task objective and acceptance criteria",
    );
    expect(instructions).toContain("check the work against the repository root AGENTS.md");
    expect(instructions).toContain("severity does not permit a pass");
    expect(instructions).toContain(
      "If .milestack/agent-instructions.md is missing in the current checkout",
    );
    expect(instructions).toContain("call get_agent_instructions");
    expect(instructions).toContain("Task creation:");
    expect(instructions).toContain(
      "Before creating a task, confirm you can state what the developer will observe when it is done, what is explicitly out of scope, and how to verify it.",
    );
    expect(instructions).toContain("ask the developer instead of filling them in");
    expect(instructions).toContain("Ask a small batch of targeted questions at once");
    expect(instructions).toContain("give each a recommended default answer");
    expect(instructions).toContain(
      "do not re-ask what is already clear or can be discovered from code or documentation",
    );
    expect(instructions).toContain(
      "record the unconfirmed point as an explicitly labeled assumption in the objective or acceptance criteria",
    );
    expect(instructions).toContain("Inbox edits:");
    expect(instructions).toContain("edit_inbox_task");
    expect(instructions).toContain("pass the returned updatedAt as expectedUpdatedAt");
    expect(instructions).toContain("cannot change risk level or risk confirmation");
    expect(instructions).toContain("Use update_task for run-scoped progress");
    expect(instructions).not.toMatch(/[\u3400-\u9fff]/u);

    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name);
    expect(toolNames).toEqual([
      "get_project_status",
      "list_tasks",
      "get_task",
      "create_task",
      "create_tasks",
      "edit_inbox_task",
      "start_task",
      "update_task",
      "submit_for_review",
      "start_review",
      "approve_review",
      "request_changes",
      "complete_review",
      "check_task_integration",
      "get_agent_instructions",
    ]);
    expect(toolNames).toContain("submit_for_review");
    expect(toolNames).not.toContain("finish_task");
    const projectStatusTool = listed.tools.find((tool) => tool.name === "get_project_status");
    const listTasksTool = listed.tools.find((tool) => tool.name === "list_tasks");
    expect(projectStatusTool?.description).toContain("without each task's objective or acceptance criteria");
    expect(projectStatusTool?.description).toContain("call get_task for the full definition");
    expect(listTasksTool?.description).toContain("without its objective or acceptance criteria");
    expect(listTasksTool?.description).toContain("call get_task for the full definition");
    const createTaskTool = listed.tools.find((tool) => tool.name === "create_task");
    const createTasksTool = listed.tools.find((tool) => tool.name === "create_tasks");
    expect(createTaskTool?.description).toContain(acceptanceCriteriaCreationCheck);
    expect(createTasksTool?.description).toContain(acceptanceCriteriaCreationCheck);
    expect(createTaskTool?.description).toContain(taskCreationReadinessPrompt);
    expect(createTasksTool?.description).toContain(taskCreationReadinessPrompt);
    expect(createTaskTool?.description).toContain("observable outcome");
    expect(createTasksTool?.description).toContain("ask the developer");
    expect(createTaskTool?.description).not.toContain("Before submitting");
    expect(createTasksTool?.description).not.toContain("Before submitting");
    expect(createTaskTool?.description).not.toContain("createPhoneBindingPage");
    expect(createTasksTool?.description).not.toContain("createPhoneBindingPage");
    const createTaskProperties = (
      createTaskTool?.inputSchema as {
        properties?: Record<string, { description?: string }>;
      }
    ).properties;
    expect(createTaskProperties?.objective?.description).toContain("Verifiable outcome");
    expect(createTaskProperties?.acceptanceCriteria?.description).toContain(
      "One independently verifiable result per criterion",
    );
    expect(createTaskProperties?.acceptanceCriteria?.description).toContain(
      "scenario, expected result, and verification",
    );
    expect(createTaskProperties?.dependencyIds?.description).toContain("Same-project task ids");
    expect(createTaskProperties?.riskLevel?.description).toContain("Risk level");
    expect(createTaskProperties?.sourceTaskId?.description).toContain("follow-up work");
    expect(createTaskTool?.inputSchema.required ?? []).not.toContain("objective");
    expect(createTaskProperties?.acceptanceCriteria).toMatchObject({ default: [] });
    expect(createTaskProperties?.objective).not.toHaveProperty("default");
    const createTasksItems = (
      createTasksTool?.inputSchema as {
        properties?: {
          tasks?: {
            items?: { properties?: Record<string, { description?: string }> };
          };
        };
      }
    ).properties?.tasks?.items?.properties;
    expect(createTasksItems?.objective?.description).toContain("Verifiable outcome");
    expect(createTasksItems?.acceptanceCriteria?.description).toContain(
      "scenario, expected result, and verification",
    );
    expect(createTasksItems?.dependencyIds?.description).toContain("Same-project task ids");
    expect(createTasksItems?.riskLevel?.description).toContain("Risk level");
    expect(createTasksItems?.sourceTaskId?.description).toContain("follow-up work");
    const editInboxTaskTool = listed.tools.find((tool) => tool.name === "edit_inbox_task");
    expect(editInboxTaskTool?.description).toContain("inbox task");
    expect(editInboxTaskTool?.description).toContain("get_task");
    expect(editInboxTaskTool?.description).toContain("updatedAt");
    expect(editInboxTaskTool?.description).toContain("risk");
    expect(editInboxTaskTool?.description).toContain("update_task");
    expect(editInboxTaskTool?.inputSchema).toMatchObject({
      required: expect.arrayContaining(["taskId", "title", "expectedUpdatedAt"]),
    });
    expect(editInboxTaskTool?.inputSchema.properties).toMatchObject({
      expectedUpdatedAt: { description: expect.stringContaining("get_task") },
    });
    expect(editInboxTaskTool?.inputSchema.properties).not.toHaveProperty("riskLevel");
    expect(editInboxTaskTool?.inputSchema.properties).not.toHaveProperty("riskConfirmed");
    expect(editInboxTaskTool?.inputSchema.properties).not.toHaveProperty("editedBy");
    const updateTaskTool = listed.tools.find((tool) => tool.name === "update_task");
    expect(updateTaskTool?.description).toContain("run-scoped progress");
    expect(updateTaskTool?.description).toContain("edit_inbox_task");
    const startReviewTool = listed.tools.find((tool) => tool.name === "start_review");
    expect(startReviewTool?.description).toContain("confirm phase=review");
    expect(startReviewTool?.description).toContain(
      "Do not accept the submitter's criteriaResults as evidence",
    );
    expect(startReviewTool?.description).toContain("repository root AGENTS.md");
    expect(startReviewTool?.description).toContain("severity does not permit a pass");
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

  it("returns MCP list summaries without task definitions and keeps full definitions in get_task", async () => {
    const projectRoot = createTemporaryProject();
    const initialized = await initializeProject(projectRoot);
    initialized.database.close();
    const context = await openProjectContext(projectRoot);

    const objectiveFor = (title: string) => `Objective for ${title}. ${"detail ".repeat(150)}`;
    const criteriaFor = (title: string) =>
      Array.from(
        { length: 6 },
        (_, index) =>
          `Criterion ${index + 1} for ${title}: ${"verification step ".repeat(8)}`,
      );
    const createTask = (title: string, status: "inbox" | "ready") =>
      context.service.createTask({
        projectId: context.project.id,
        title,
        objective: objectiveFor(title),
        acceptanceCriteria: criteriaFor(title),
        status,
        createdBy: status === "inbox" ? "agent" : "developer",
      });

    const inboxTasks = ["Inbox one", "Inbox two", "Inbox three", "Inbox four"];
    for (const title of inboxTasks) {
      createTask(title, "inbox");
    }
    for (const title of ["Ready one", "Ready two", "Ready three"]) {
      createTask(title, "ready");
    }
    const running = createTask("Running task", "ready");
    context.service.startTask({
      projectId: context.project.id,
      taskId: running.task.id,
    });
    const review = createTask("Review task", "ready");
    const reviewRun = context.service.startTask({
      projectId: context.project.id,
      taskId: review.task.id,
    });
    context.service.submitForReview({
      projectId: context.project.id,
      taskId: review.task.id,
      runId: reviewRun.runId,
      commitSha: "1".repeat(40),
      summary: "Submitted for summary testing.",
      criteriaResults: (review.task.acceptanceCriteria ?? []).map((criterion) => ({
        criterionId: criterion.id,
        status: "met" as const,
        evidence: [{ command: "pnpm test", result: "passed" }],
      })),
    });
    const blocked = createTask("Blocked task", "ready");
    const completed = createTask("Completed task", "ready");
    const completionTime = new Date().toISOString();
    context.repository.transaction((transaction) => {
      transaction.updateTask(blocked.task.id, {
        status: "blocked",
        blocker: "Waiting for external input",
        updatedAt: completionTime,
      });
      transaction.updateTask(completed.task.id, {
        status: "completed",
        completedAt: completionTime,
        updatedAt: completionTime,
      });
    });

    const server = createMcpServer(context);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "summary-test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const legacyFull = context.service.getProjectStatus({
      projectId: context.project.id,
      view: "full",
    });
    const fullText = textContent(
      await client.callTool({
        name: "get_project_status",
        arguments: { view: "full" },
      }),
    );
    const mcpFull = JSON.parse(fullText) as ProjectStatus;
    expectStatusWithoutDefinitions(mcpFull, legacyFull);
    expect(mcpFull.current).toHaveLength(1);
    expect(mcpFull.next).toHaveLength(3);
    expect(mcpFull.blocked).toHaveLength(1);
    expect(mcpFull.inReview).toHaveLength(1);
    expect(mcpFull.inbox).toHaveLength(4);
    expect(mcpFull.recentlyCompleted).toHaveLength(1);

    const legacyCompact = context.service.getProjectStatus({
      projectId: context.project.id,
      view: "compact",
    });
    const compactText = textContent(
      await client.callTool({
        name: "get_project_status",
        arguments: { view: "compact" },
      }),
    );
    const mcpCompact = JSON.parse(compactText) as CompactProjectStatus;
    expectStatusWithoutDefinitions(mcpCompact, legacyCompact);
    expect(mcpCompact.inbox).toHaveLength(3);
    expect(mcpCompact.truncated.inbox).toBe(true);
    expect(mcpCompact.nextRunnable).not.toBeNull();

    const listTexts = new Map<string, string>();
    for (const status of taskStatuses) {
      const legacyPage = context.service.listTasks({
        projectId: context.project.id,
        status,
        limit: 100,
      });
      const result = await client.callTool({
        name: "list_tasks",
        arguments: { status, limit: 100 },
      });
      const text = textContent(result);
      listTexts.set(status, text);
      expectTaskPageWithoutDefinitions(JSON.parse(text) as TaskPage, legacyPage);
    }

    const legacyFirstInboxPage = context.service.listTasks({
      projectId: context.project.id,
      status: "inbox",
      limit: 2,
    });
    expect(legacyFirstInboxPage.hasMore).toBe(true);
    const firstInboxCursor = legacyFirstInboxPage.nextCursor;
    if (!firstInboxCursor) {
      throw new Error("Expected an inbox continuation cursor.");
    }
    const firstInboxResult = await client.callTool({
      name: "list_tasks",
      arguments: { status: "inbox", limit: 2 },
    });
    const firstInboxPage = JSON.parse(textContent(firstInboxResult)) as TaskPage;
    expectTaskPageWithoutDefinitions(firstInboxPage, legacyFirstInboxPage);

    const legacySecondInboxPage = context.service.listTasks({
      projectId: context.project.id,
      status: "inbox",
      limit: 2,
      cursor: firstInboxCursor,
    });
    const secondInboxResult = await client.callTool({
      name: "list_tasks",
      arguments: {
        status: "inbox",
        limit: 2,
        cursor: firstInboxCursor,
      },
    });
    expectTaskPageWithoutDefinitions(
      JSON.parse(textContent(secondInboxResult)) as TaskPage,
      legacySecondInboxPage,
    );

    const listedTask = firstInboxPage.tasks[0];
    if (!listedTask) {
      throw new Error("Expected an inbox list result.");
    }
    expect(listedTask).not.toHaveProperty("objective");
    expect(listedTask).not.toHaveProperty("acceptanceCriteria");

    const legacyDetails = context.service.getTask({
      projectId: context.project.id,
      taskId: listedTask.id,
    });
    const mcpDetails = JSON.parse(
      textContent(
        await client.callTool({
          name: "get_task",
          arguments: { taskId: listedTask.id },
        }),
      ),
    ) as { task: { objective: string | null; acceptanceCriteria: Array<{ id: string; text: string }> | null } };
    expect(mcpDetails.task.objective).toBe(legacyDetails.task.objective);
    expect(mcpDetails.task.objective).toContain(`Objective for ${listedTask.title}.`);
    expect(mcpDetails.task.acceptanceCriteria).toEqual(
      legacyDetails.task.acceptanceCriteria,
    );
    expect(mcpDetails.task.acceptanceCriteria).toHaveLength(6);
    for (const criterion of mcpDetails.task.acceptanceCriteria ?? []) {
      expect(criterion.id).toBeTruthy();
      expect(criterion.text).toContain("verification step");
    }

    const legacyFullCharacters = JSON.stringify(legacyFull, null, 2).length;
    const mcpFullCharacters = fullText.length;
    const inboxListText = listTexts.get("inbox");
    if (!inboxListText) {
      throw new Error("Expected an inbox list response.");
    }
    const legacyInboxCharacters = JSON.stringify(
      context.service.listTasks({
        projectId: context.project.id,
        status: "inbox",
        limit: 100,
      }),
      null,
      2,
    ).length;
    const mcpInboxCharacters = inboxListText.length;
    console.log(
      `get_project_status(full) characters: ${legacyFullCharacters} -> ${mcpFullCharacters}`,
    );
    console.log(
      `list_tasks(status=inbox) characters: ${legacyInboxCharacters} -> ${mcpInboxCharacters}`,
    );
    expect(mcpFullCharacters).toBeLessThan(legacyFullCharacters * 0.5);
    expect(mcpInboxCharacters).toBeLessThan(legacyInboxCharacters * 0.5);

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

  it("edits an inbox definition with optimistic concurrency and agent attribution", async () => {
    const projectRoot = createTemporaryProject();
    const initialized = await initializeProject(projectRoot);
    initialized.database.close();
    const context = await openProjectContext(projectRoot);
    const dependency = context.service.createTask({
      projectId: context.project.id,
      title: "Dependency",
      createdBy: "developer",
      status: "ready",
    });
    const draft = context.service.createTask({
      projectId: context.project.id,
      title: "Agent draft",
      objective: "Old objective",
      acceptanceCriteria: ["Keep this criterion", "Replace this criterion"],
      riskLevel: "high",
      createdBy: "agent",
      status: "inbox",
    });
    const developerDraft = context.service.createTask({
      projectId: context.project.id,
      title: "Developer draft",
      createdBy: "developer",
      status: "inbox",
    });
    const server = createMcpServer(context);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "edit-test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const before = JSON.parse(
      textContent(
        await client.callTool({
          name: "get_task",
          arguments: { taskId: draft.task.id, view: "full" },
        }),
      ),
    );
    const keptCriterionId = before.task.acceptanceCriteria[0].id;

    const editedResult = await client.callTool({
      name: "edit_inbox_task",
      arguments: {
        taskId: draft.task.id,
        title: "Refined agent draft",
        objective: "Refined objective",
        acceptanceCriteria: [
          { id: keptCriterionId, text: "Keep this criterion" },
          "New criterion",
        ],
        dependencyIds: [dependency.task.id],
        expectedUpdatedAt: before.task.updatedAt,
        actorLabel: "edit-model",
      },
    });
    expect(editedResult.isError).toBeFalsy();
    const edited = JSON.parse(textContent(editedResult));
    expect(edited.task).toMatchObject({
      id: draft.task.id,
      title: "Refined agent draft",
      objective: "Refined objective",
      status: "inbox",
      queuePosition: null,
      riskLevel: before.task.riskLevel,
      riskConfirmed: before.task.riskConfirmed,
    });
    expect(edited.task.acceptanceCriteria.map((criterion: { text: string }) => criterion.text)).toEqual([
      "Keep this criterion",
      "New criterion",
    ]);
    expect(edited.task.acceptanceCriteria[0].id).toBe(keptCriterionId);
    expect(edited.task.dependencyIds).toEqual([dependency.task.id]);

    const afterEdit = JSON.parse(
      textContent(
        await client.callTool({
          name: "get_task",
          arguments: { taskId: draft.task.id, view: "full" },
        }),
      ),
    );
    expect(afterEdit.task.acceptanceCriteria[0].id).toBe(keptCriterionId);
    expect(afterEdit.events).toHaveLength(before.events.length + 1);
    expect(afterEdit.events.at(-1)).toMatchObject({
      type: "progress",
      summary: "Inbox task definition updated by agent.",
      actorLabel: "edit-model",
      runId: null,
    });

    const secondEdit = await client.callTool({
      name: "edit_inbox_task",
      arguments: {
        taskId: draft.task.id,
        title: "Refined agent draft again",
        objective: "Refined objective again",
        acceptanceCriteria: ["Keep this criterion", "New criterion"],
        dependencyIds: [dependency.task.id],
        expectedUpdatedAt: afterEdit.task.updatedAt,
      },
    });
    const secondEditValue = JSON.parse(textContent(secondEdit));
    expect(secondEditValue.events.at(-1)).toMatchObject({
      summary: "Inbox task definition updated by agent.",
      actorLabel: "agent",
    });

    const developerBefore = JSON.parse(
      textContent(
        await client.callTool({
          name: "get_task",
          arguments: { taskId: developerDraft.task.id, view: "full" },
        }),
      ),
    );
    context.service.editInboxTask({
      projectId: context.project.id,
      taskId: developerDraft.task.id,
      title: "Developer edited draft",
      actorLabel: "developer",
    });
    const developerAfter = JSON.parse(
      textContent(
        await client.callTool({
          name: "get_task",
          arguments: { taskId: developerDraft.task.id, view: "full" },
        }),
      ),
    );
    expect(developerAfter.events).toHaveLength(developerBefore.events.length + 1);
    expect(developerAfter.events.at(-1)).toMatchObject({
      summary: "Inbox task definition updated by developer.",
      actorLabel: "developer",
    });

    await client.close();
    await server.close();
    context.database.close();
  });

  it("rejects inbox edits for every non-inbox status without changing the task", async () => {
    const projectRoot = createTemporaryProject();
    const initialized = await initializeProject(projectRoot);
    initialized.database.close();
    const context = await openProjectContext(projectRoot);
    const ready = context.service.createTask({
      projectId: context.project.id,
      title: "Ready task",
      createdBy: "developer",
      status: "ready",
    });
    const running = context.service.createTask({
      projectId: context.project.id,
      title: "Running task",
      createdBy: "developer",
      status: "ready",
    });
    context.service.startTask({
      projectId: context.project.id,
      taskId: running.task.id,
    });
    const inReview = context.service.createTask({
      projectId: context.project.id,
      title: "Review task",
      createdBy: "developer",
      status: "ready",
    });
    const reviewRun = context.service.startTask({
      projectId: context.project.id,
      taskId: inReview.task.id,
    });
    context.service.submitForReview({
      projectId: context.project.id,
      taskId: inReview.task.id,
      runId: reviewRun.runId,
      commitSha: "2222222222222222222222222222222222222222",
      summary: "Submitted",
    });
    const completed = context.service.createTask({
      projectId: context.project.id,
      title: "Completed task",
      createdBy: "agent",
      status: "inbox",
    });
    context.repository.transaction((transaction) => {
      transaction.updateTask(completed.task.id, {
        status: "completed",
        completedAt: "2026-10-27T16:40:00.000Z",
        updatedAt: "2026-10-27T16:40:00.000Z",
      });
    });

    const server = createMcpServer(context);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "edit-status-test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    for (const taskId of [ready.task.id, running.task.id, inReview.task.id, completed.task.id]) {
      const before = JSON.parse(
        textContent(
          await client.callTool({
            name: "get_task",
            arguments: { taskId, view: "full" },
          }),
        ),
      );
      const rejected = await client.callTool({
        name: "edit_inbox_task",
        arguments: {
          taskId,
          title: "Should not be applied",
          expectedUpdatedAt: before.task.updatedAt,
        },
      });
      expect(rejected.isError).toBe(true);
      expect(textContent(rejected)).toContain("INVALID_TASK_STATE");

      const after = JSON.parse(
        textContent(
          await client.callTool({
            name: "get_task",
            arguments: { taskId, view: "full" },
          }),
        ),
      );
      expect(after.task).toEqual(before.task);
      expect(after.events).toEqual(before.events);
    }

    await client.close();
    await server.close();
    context.database.close();
  });

  it("rejects a stale inbox edit after a developer change", async () => {
    const projectRoot = createTemporaryProject();
    const initialized = await initializeProject(projectRoot);
    initialized.database.close();
    const context = await openProjectContext(projectRoot);
    const draft = context.service.createTask({
      projectId: context.project.id,
      title: "Draft before conflict",
      acceptanceCriteria: ["Original criterion"],
      createdBy: "agent",
      status: "inbox",
    });
    const server = createMcpServer(context);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "edit-conflict-test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const before = JSON.parse(
      textContent(
        await client.callTool({
          name: "get_task",
          arguments: { taskId: draft.task.id, view: "full" },
        }),
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    context.service.editInboxTask({
      projectId: context.project.id,
      taskId: draft.task.id,
      title: "Developer changed the draft",
      actorLabel: "developer",
    });

    const rejected = await client.callTool({
      name: "edit_inbox_task",
      arguments: {
        taskId: draft.task.id,
        title: "Agent overwrite",
        acceptanceCriteria: ["Agent overwrite criterion"],
        expectedUpdatedAt: before.task.updatedAt,
      },
    });
    expect(rejected.isError).toBe(true);
    expect(textContent(rejected)).toContain("TASK_EDIT_CONFLICT");
    expect(textContent(rejected)).toContain("get_task");

    const after = JSON.parse(
      textContent(
        await client.callTool({
          name: "get_task",
          arguments: { taskId: draft.task.id, view: "full" },
        }),
      ),
    );
    expect(after.task.title).toBe("Developer changed the draft");
    expect(after.task.acceptanceCriteria).toEqual([]);
    expect(after.events.at(-1)).toMatchObject({
      summary: "Inbox task definition updated by developer.",
      actorLabel: "developer",
    });

    await client.close();
    await server.close();
    context.database.close();
  });
});

describe("MCP get_agent_instructions", () => {
  it("returns exactly the file milestack init generates and writes nothing", async () => {
    const projectRoot = createTemporaryProject();
    expect(
      await runCli(["init", "--project", projectRoot], {
        writeStdout: () => undefined,
        writeStderr: () => undefined,
      }),
    ).toBe(0);
    const instructionsPath = path.join(projectRoot, ".milestack", "agent-instructions.md");
    const generated = readFileSync(instructionsPath, "utf8");
    const rootEntriesBefore = readdirSync(projectRoot).sort();

    const context = await openProjectContext(projectRoot);
    const server = createMcpServer(context);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "get_agent_instructions", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(textContent(result)).toBe(generated);

    expect(readFileSync(instructionsPath, "utf8")).toBe(generated);
    expect(readdirSync(projectRoot).sort()).toEqual(rootEntriesBefore);

    await client.close();
    await server.close();
    context.database.close();
  });
});
