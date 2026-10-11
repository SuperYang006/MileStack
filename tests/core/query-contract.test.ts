import { describe, expect, it } from "vitest";

import {
  getProjectStatusInputSchema,
  getTaskInputSchema,
  listTasksInputSchema,
  createTaskInputSchema,
  projectStatusSchema,
  taskDetailsSchema,
} from "../../src/core/query-contract.js";

describe("core query contract", () => {
  it("accepts the project status and task detail shapes", () => {
    const task = {
      id: "task-1",
      projectId: "project-1",
      title: "Implement the query contract",
      objective: "Make the status response reusable",
      acceptanceCriteria: ["MCP and HTTP can share the output"],
      status: "ready" as const,
      queuePosition: 1,
      dependencyIds: ["task-0"],
      currentStep: null,
      nextStep: "Implement the service",
      blocker: null,
      requiredAction: null,
      handoffNote: null,
      sourceTaskId: null,
      activeRunId: null,
      createdBy: "developer" as const,
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
      completedAt: null,
    };
    const event = {
      id: "event-1",
      projectId: "project-1",
      taskId: "task-1",
      runId: null,
      type: "created" as const,
      summary: "Task created",
      completedWork: null,
      currentStep: null,
      nextStep: null,
      blocker: null,
      requiredAction: null,
      handoffNote: null,
      actorLabel: null,
      createdAt: "2026-10-11T00:00:00.000Z",
    };
    const summary = {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      status: task.status,
      queuePosition: task.queuePosition,
      dependencyIds: task.dependencyIds,
      waitingFor: [],
      runnable: true,
      currentStep: task.currentStep,
      nextStep: task.nextStep,
      blocker: task.blocker,
      requiredAction: task.requiredAction,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
    };

    expect(
      projectStatusSchema.parse({
        project: { id: "project-1", name: "MileStack", goal: null },
        current: [],
        next: [summary],
        blocked: [],
        inbox: [],
        recentlyCompleted: [],
      }),
    ).toMatchObject({ next: [summary] });
    expect(taskDetailsSchema.parse({ task, events: [event] })).toEqual({
      task,
      events: [event],
    });
  });

  it("rejects incomplete query inputs and unknown fields", () => {
    expect(() => getProjectStatusInputSchema.parse({})).toThrow();
    expect(() =>
      getTaskInputSchema.parse({
        projectId: "project-1",
        taskId: "task-1",
        unexpected: true,
      }),
    ).toThrow();
  });

  it("accepts an optional actor label when creating a task", () => {
    expect(
      createTaskInputSchema.parse({
        projectId: "project-1",
        title: "Record model identity",
        createdBy: "agent",
        actorLabel: "gpt-5-codex",
      }),
    ).toMatchObject({ actorLabel: "gpt-5-codex" });
  });

  it("accepts explicit status views and applies the page size default", () => {
    expect(
      getProjectStatusInputSchema.parse({
        projectId: "project-1",
        view: "compact",
      }),
    ).toEqual({ projectId: "project-1", view: "compact" });
    expect(
      listTasksInputSchema.parse({
        projectId: "project-1",
        status: "ready",
      }),
    ).toMatchObject({ projectId: "project-1", status: "ready", limit: 20 });
  });
});
