import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  InvalidTaskStateError,
  InvalidTaskDependencyError,
  TaskDependenciesIncompleteError,
  ProjectNotFoundError,
  TaskRunOwnershipError,
  TaskDependenciesNotEditableError,
  TaskHasDependentsError,
  TaskNotFoundError,
  TaskRiskNotConfirmedError,
  ReviewRunOwnershipError,
} from "../../src/core/errors.js";
import { TaskService } from "../../src/core/task-service.js";
import { createSqliteRepository } from "../../src/db/sqlite-repository.js";
import { ensureDatabase } from "../../src/db/ensure-database.js";
import { projects, tasks } from "../../src/db/schema.js";

const temporaryProjects: string[] = [];

function createTemporaryProject(): string {
  const projectRoot = path.join(os.tmpdir(), `milestack-core-${randomUUID()}`);
  mkdirSync(projectRoot, { recursive: true });
  temporaryProjects.push(projectRoot);
  return projectRoot;
}

async function createService(
  projectRoot: string,
  options: ConstructorParameters<typeof TaskService>[1] = {},
) {
  const database = await ensureDatabase(projectRoot);
  database.db
    .insert(projects)
    .values({
      id: "project-1",
      name: "MileStack",
      rootPath: projectRoot,
      goal: "Build a reliable project context database",
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
    })
    .run();

  return {
    database,
    service: new TaskService(createSqliteRepository(database), {
      now: () => new Date("2026-10-11T12:00:00.000Z"),
      generateId: (() => {
        let counter = 0;
        return () => `generated-${++counter}`;
      })(),
      ...options,
    }),
  };
}

function taskRecord(overrides: Partial<typeof tasks.$inferInsert>) {
  return {
    id: "task-default",
    projectId: "project-1",
    title: "Task",
    objective: null,
    acceptanceCriteria: [],
    status: "inbox" as const,
    queuePosition: null,
    currentStep: null,
    nextStep: null,
    blocker: null,
    requiredAction: null,
    handoffNote: null,
    sourceTaskId: null,
    activeRunId: null,
    createdBy: "developer" as const,
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  for (const projectRoot of temporaryProjects.splice(0)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

describe("TaskService", () => {
  it("creates developer and agent tasks with created events", async () => {
    const { database, service } = await createService(createTemporaryProject());

    const developerTask = service.createTask({
      projectId: "project-1",
      title: "Implement queries",
      objective: "Expose project facts",
      acceptanceCriteria: ["Status query works"],
      queuePosition: 1,
      riskLevel: "low",
      createdBy: "developer",
    });
    const agentTask = service.createTask({
      projectId: "project-1",
      title: "Record follow-up",
      createdBy: "agent",
      actorLabel: "gpt-5-codex",
    });
    const fallbackAgentTask = service.createTask({
      projectId: "project-1",
      title: "Record fallback follow-up",
      createdBy: "agent",
    });

    expect(developerTask.task.status).toBe("ready");
    expect(developerTask.task.riskLevel).toBe("low");
    expect(developerTask.task.queuePosition).toBe(1);
    expect(developerTask.events).toHaveLength(1);
    expect(developerTask.events[0]?.type).toBe("created");
    expect(agentTask.task.status).toBe("inbox");
    expect(agentTask.task.queuePosition).toBeNull();
    expect(agentTask.events[0]?.summary).toBe("Task created: Record follow-up");
    expect(developerTask.events[0]?.actorLabel).toBe("developer");
    expect(agentTask.events[0]?.actorLabel).toBe("gpt-5-codex");
    expect(fallbackAgentTask.events[0]?.actorLabel).toBe("agent");
    database.close();
  });

  it("creates a batch atomically and rejects invalid input before writing", async () => {
    const projectRoot = createTemporaryProject();
    const { database, service } = await createService(projectRoot);

    expect(() =>
      service.createTasks({
        projectId: "project-1",
        tasks: [
          { title: "Valid", createdBy: "agent" },
          { title: "", createdBy: "agent" },
        ],
      }),
    ).toThrow();
    expect(database.db.select().from(tasks).all()).toHaveLength(0);
    database.close();

    const secondDatabase = await ensureDatabase(projectRoot);
    const secondService = new TaskService(createSqliteRepository(secondDatabase), {
      now: () => new Date("2026-10-11T12:00:00.000Z"),
      generateId: (() => {
        const ids = ["task-a", "task-b", "event-a", "event-a"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
    });

    expect(() =>
      secondService.createTasks({
        projectId: "project-1",
        tasks: [
          { title: "First", createdBy: "agent" },
          { title: "Second", createdBy: "agent" },
        ],
      }),
    ).toThrow();
    expect(secondDatabase.db.select().from(tasks).all()).toHaveLength(0);
    secondDatabase.close();
  });

  it("returns task details and groups project status with stable queue and recency rules", async () => {
    const projectRoot = createTemporaryProject();
    const { database, service } = await createService(projectRoot, {
      recentlyCompletedLimit: 2,
    });

    database.db
      .insert(tasks)
      .values([
        taskRecord({
          id: "running-task",
          title: "Current",
          status: "running",
          updatedAt: "2026-10-11T01:00:00.000Z",
        }),
        taskRecord({
          id: "ready-late",
          title: "Later",
          status: "ready",
          queuePosition: 20,
        }),
        taskRecord({
          id: "ready-first",
          title: "First",
          status: "ready",
          queuePosition: 10,
        }),
        taskRecord({
          id: "inbox-task",
          title: "Inbox",
          status: "inbox",
        }),
        taskRecord({
          id: "blocked-task",
          title: "Blocked",
          status: "blocked",
          blocker: "Waiting for input",
        }),
        taskRecord({
          id: "completed-old",
          title: "Old completion",
          status: "completed",
          completedAt: "2026-10-01T00:00:00.000Z",
        }),
        taskRecord({
          id: "completed-new",
          title: "New completion",
          status: "completed",
          completedAt: "2026-10-11T02:00:00.000Z",
        }),
        taskRecord({
          id: "completed-middle",
          title: "Middle completion",
          status: "completed",
          completedAt: "2026-10-05T00:00:00.000Z",
        }),
      ])
      .run();

    const status = service.getProjectStatus({ projectId: "project-1" });
    expect(status.project.name).toBe("MileStack");
    expect(status.counts).toEqual({
      inbox: 1,
      ready: 2,
      running: 1,
      blocked: 1,
      inReview: 0,
      completed: 3,
      total: 8,
    });
    expect(status.current.map((task) => task.id)).toEqual(["running-task"]);
    expect(status.next.map((task) => task.id)).toEqual([
      "ready-first",
      "ready-late",
    ]);
    expect(status.blocked.map((task) => task.id)).toEqual(["blocked-task"]);
    expect(status.inbox.map((task) => task.id)).toEqual(["inbox-task"]);
    expect(status.recentlyCompleted.map((task) => task.id)).toEqual([
      "completed-new",
      "completed-middle",
    ]);

    const task = service.getTask({
      projectId: "project-1",
      taskId: "ready-first",
    });
    expect(task.task.title).toBe("First");
    expect(task.events).toEqual([]);
    expect(() =>
      service.getTask({ projectId: "missing-project", taskId: "ready-first" }),
    ).toThrow(ProjectNotFoundError);
    expect(() =>
      service.getTask({ projectId: "project-1", taskId: "missing-task" }),
    ).toThrow(TaskNotFoundError);
    database.close();
  });

  it("skips project status assembly when the latest task timestamp is unchanged", async () => {
    const projectRoot = createTemporaryProject();
    const { database, service } = await createService(projectRoot);
    service.createTask({
      projectId: "project-1",
      title: "Track status changes",
      status: "ready",
      createdBy: "developer",
    });

    const initial = service.getProjectStatus({ projectId: "project-1" });
    expect(initial.latestUpdatedAt).toBe("2026-10-11T12:00:00.000Z");
    expect(
      service.getProjectStatusIfChanged({
        projectId: "project-1",
        since: initial.latestUpdatedAt ?? undefined,
      }),
    ).toBeNull();

    database.db
      .update(tasks)
      .set({
        title: "Status changed",
        updatedAt: "2026-10-11T13:00:00.000Z",
      })
      .where(eq(tasks.id, "generated-1"))
      .run();

    const changed = service.getProjectStatusIfChanged({
      projectId: "project-1",
      since: initial.latestUpdatedAt ?? undefined,
    });
    expect(changed).toMatchObject({
      latestUpdatedAt: "2026-10-11T13:00:00.000Z",
      next: [expect.objectContaining({ title: "Status changed" })],
    });
    database.close();
  });

  it("returns a bounded compact status and stable status cursors", async () => {
    const projectRoot = createTemporaryProject();
    const { database, service } = await createService(projectRoot);
    database.db
      .insert(tasks)
      .values([
        ...Array.from({ length: 7 }, (_, index) =>
          taskRecord({
            id: `ready-${index + 1}`,
            title: `Ready ${index + 1}`,
            status: "ready",
            queuePosition: index + 1,
            createdAt: `2026-10-11T00:0${index}:00.000Z`,
          }),
        ),
        ...Array.from({ length: 4 }, (_, index) =>
          taskRecord({
            id: `blocked-${index + 1}`,
            title: `Blocked ${index + 1}`,
            status: "blocked",
            blocker: "Needs review",
            createdAt: `2026-10-11T01:0${index}:00.000Z`,
          }),
        ),
        ...Array.from({ length: 4 }, (_, index) =>
          taskRecord({
            id: `completed-${index + 1}`,
            title: `Completed ${index + 1}`,
            status: "completed",
            completedAt: `2026-10-11T02:0${index}:00.000Z`,
            updatedAt: `2026-10-11T02:0${index}:00.000Z`,
          }),
        ),
      ])
      .run();

    const compact = service.getProjectStatus({
      projectId: "project-1",
      view: "compact",
    });
    expect(compact.counts).toMatchObject({
      ready: 7,
      blocked: 4,
      completed: 4,
      total: 15,
    });
    expect(compact.next.map((task) => task.id)).toEqual([
      "ready-1",
      "ready-2",
      "ready-3",
      "ready-4",
      "ready-5",
    ]);
    expect(compact.nextRunnable?.id).toBe("ready-1");
    expect(compact.truncated).toMatchObject({
      next: true,
      blocked: true,
      recentlyCompleted: true,
    });

    const firstPage = service.listTasks({
      projectId: "project-1",
      status: "ready",
      limit: 2,
    });
    expect(firstPage.tasks.map((task) => task.id)).toEqual(["ready-1", "ready-2"]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = service.listTasks({
      projectId: "project-1",
      status: "ready",
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.tasks.map((task) => task.id)).toEqual(["ready-3", "ready-4"]);

    const repeatedSecondPage = service.listTasks({
      projectId: "project-1",
      status: "ready",
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(repeatedSecondPage.tasks.map((task) => task.id)).toEqual(
      secondPage.tasks.map((task) => task.id),
    );

    const completedPage = service.listTasks({
      projectId: "project-1",
      status: "completed",
      limit: 2,
    });
    expect(completedPage.tasks.map((task) => task.id)).toEqual([
      "completed-4",
      "completed-3",
    ]);
    const completedNextPage = service.listTasks({
      projectId: "project-1",
      status: "completed",
      limit: 2,
      cursor: completedPage.nextCursor ?? undefined,
    });
    expect(completedNextPage.tasks.map((task) => task.id)).toEqual([
      "completed-2",
      "completed-1",
    ]);
    database.close();
  });

  it("stores dependencies and computes waitingFor and runnable dynamically", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const prerequisite = service.createTask({
      projectId: "project-1",
      title: "Prepare prerequisite",
      queuePosition: 1,
      createdBy: "developer",
    });
    const dependent = service.createTask({
      projectId: "project-1",
      title: "Use prerequisite",
      dependencyIds: [prerequisite.task.id],
      queuePosition: 2,
      createdBy: "developer",
    });

    expect(dependent.task.dependencyIds).toEqual([prerequisite.task.id]);
    let status = service.getProjectStatus({ projectId: "project-1" });
    expect(status.next.map((task) => task.id)).toEqual([
      prerequisite.task.id,
      dependent.task.id,
    ]);
    expect(status.next[1]).toMatchObject({
      dependencyIds: [prerequisite.task.id],
      waitingFor: [
        {
          id: prerequisite.task.id,
          title: "Prepare prerequisite",
          status: "ready",
        },
      ],
      runnable: false,
    });

    database.db
      .update(tasks)
      .set({
        status: "completed",
        completedAt: "2026-10-11T13:00:00.000Z",
        updatedAt: "2026-10-11T13:00:00.000Z",
      })
      .where(eq(tasks.id, prerequisite.task.id))
      .run();

    status = service.getProjectStatus({ projectId: "project-1" });
    expect(status.next[0]).toMatchObject({
      id: dependent.task.id,
      waitingFor: [],
      runnable: true,
    });
    database.close();
  });

  it("rejects invalid dependency changes and records valid changes as progress", async () => {
    const projectRoot = createTemporaryProject();
    const { database, service } = await createService(projectRoot);
    database.db
      .insert(projects)
      .values({
        id: "project-2",
        name: "Other project",
        rootPath: `${projectRoot}-other`,
        goal: null,
        createdAt: "2026-10-11T00:00:00.000Z",
        updatedAt: "2026-10-11T00:00:00.000Z",
      })
      .run();
    database.db
      .insert(tasks)
      .values(taskRecord({ id: "foreign-task", projectId: "project-2" }))
      .run();

    const first = service.createTask({
      projectId: "project-1",
      title: "First",
      createdBy: "developer",
    });
    const second = service.createTask({
      projectId: "project-1",
      title: "Second",
      createdBy: "developer",
    });

    expect(() =>
      service.setTaskDependencies({
        projectId: "project-1",
        taskId: first.task.id,
        dependencyIds: [first.task.id],
      }),
    ).toThrow(InvalidTaskDependencyError);
    expect(() =>
      service.setTaskDependencies({
        projectId: "project-1",
        taskId: first.task.id,
        dependencyIds: ["missing-task"],
      }),
    ).toThrow(InvalidTaskDependencyError);
    expect(() =>
      service.setTaskDependencies({
        projectId: "project-1",
        taskId: first.task.id,
        dependencyIds: ["foreign-task"],
      }),
    ).toThrow(InvalidTaskDependencyError);

    const updated = service.setTaskDependencies({
      projectId: "project-1",
      taskId: second.task.id,
      dependencyIds: [first.task.id],
      summary: "Second now waits for first.",
    });
    expect(updated.task.dependencyIds).toEqual([first.task.id]);
    expect(updated.events.at(-1)).toMatchObject({
      type: "progress",
      summary: "Second now waits for first.",
    });

    expect(() =>
      service.setTaskDependencies({
        projectId: "project-1",
        taskId: first.task.id,
        dependencyIds: [second.task.id],
      }),
    ).toThrow(InvalidTaskDependencyError);
    expect(service.getTask({ projectId: "project-1", taskId: first.task.id }).task.dependencyIds).toEqual([]);

    database.db
      .update(tasks)
      .set({ status: "completed", completedAt: "2026-10-11T13:00:00.000Z" })
      .where(eq(tasks.id, second.task.id))
      .run();
    expect(() =>
      service.setTaskDependencies({
        projectId: "project-1",
        taskId: second.task.id,
        dependencyIds: [],
      }),
    ).toThrow(TaskDependenciesNotEditableError);
    database.close();
  });

  it("rolls back a batch when a dependency is invalid", async () => {
    const { database, service } = await createService(createTemporaryProject());

    expect(() =>
      service.createTasks({
        projectId: "project-1",
        tasks: [
          { title: "Valid first", createdBy: "developer" },
          {
            title: "Invalid second",
            dependencyIds: ["missing-task"],
            createdBy: "developer",
          },
        ],
      }),
    ).toThrow(InvalidTaskDependencyError);
    expect(database.db.select().from(tasks).all()).toHaveLength(0);
    database.close();
  });

  it("runs an atomic execution lifecycle and invalidates the old runId", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const prerequisite = service.createTask({
      projectId: "project-1",
      title: "Prerequisite",
      createdBy: "developer",
      status: "ready",
    });
    const task = service.createTask({
      projectId: "project-1",
      title: "Implementation",
      createdBy: "developer",
      status: "ready",
      dependencyIds: [prerequisite.task.id],
    });

    expect(() => service.startTask({ projectId: "project-1", taskId: task.task.id }))
      .toThrow(TaskDependenciesIncompleteError);

    database.db
      .update(tasks)
      .set({ status: "completed", completedAt: "2026-10-11T11:00:00.000Z" })
      .where(eq(tasks.id, prerequisite.task.id))
      .run();

    const started = service.startTask({
      projectId: "project-1",
      taskId: task.task.id,
      actorLabel: "gpt-5-codex",
    });
    expect(started.runId).toBeTruthy();
    expect(started.task.task.status).toBe("running");
    expect(started.task.events.at(-1)).toMatchObject({
      type: "started",
      actorLabel: "gpt-5-codex",
    });

    const updated = service.updateTask({
      projectId: "project-1",
      taskId: task.task.id,
      runId: started.runId,
      summary: "Reached the implementation stage.",
      currentStep: "Implementing service",
      nextStep: "Run tests",
      completedWork: ["Designed the state transition"],
    });
    expect(updated.task.currentStep).toBe("Implementing service");
    expect(updated.events.at(-1)).toMatchObject({
      type: "progress",
      runId: started.runId,
      actorLabel: "gpt-5-codex",
    });

    const finished = service.submitForReview({
      projectId: "project-1",
      taskId: task.task.id,
      runId: started.runId,
      commitSha: "1111111111111111111111111111111111111111",
      summary: "Implementation complete.",
      completedWork: ["Implemented and tested the lifecycle"],
    });
    expect(finished.task.status).toBe("in_review");
    expect(finished.task.activeRunId).toBeNull();
    expect(finished.events.at(-1)).toMatchObject({
      type: "submitted_for_review",
      actorLabel: "gpt-5-codex",
    });
    const reviewRun = service.startReview({
      projectId: "project-1",
      taskId: task.task.id,
      actorLabel: "review-agent",
    });
    const reviewed = service.completeReview({
      projectId: "project-1",
      taskId: task.task.id,
      reviewRunId: reviewRun.reviewRunId,
      decision: "passed",
      summary: "Review passed.",
      verificationEvidence: [{ command: "pnpm test", result: "passed" }],
    });
    expect(reviewed.task.status).toBe("in_review");
    const approved = service.approveTask({
      projectId: "project-1",
      taskId: task.task.id,
      actorLabel: "developer",
    });
    expect(approved.task.status).toBe("completed");
    expect(approved.task.completedAt).toBeTruthy();
    expect(approved.events.at(-1)).toMatchObject({
      type: "approved",
      actorLabel: "developer",
    });
    expect(() =>
      service.updateTask({
        projectId: "project-1",
        taskId: task.task.id,
        runId: started.runId,
        summary: "Late update",
      }),
    ).toThrow(TaskRunOwnershipError);
    database.close();
  });

  it("allows only one repository connection to claim a ready task", async () => {
    const projectRoot = createTemporaryProject();
    const first = await createService(projectRoot);
    const task = first.service.createTask({
      projectId: "project-1",
      title: "Concurrent task",
      createdBy: "developer",
      status: "ready",
    });
    const secondDatabase = await ensureDatabase(projectRoot);
    const secondService = new TaskService(createSqliteRepository(secondDatabase), {
      now: () => new Date("2026-10-11T12:00:00.000Z"),
      generateId: (() => {
        let counter = 0;
        return () => `second-generated-${++counter}`;
      })(),
    });

    const results = await Promise.allSettled([
      Promise.resolve().then(() => first.service.startTask({ projectId: "project-1", taskId: task.task.id })),
      Promise.resolve().then(() => secondService.startTask({ projectId: "project-1", taskId: task.task.id })),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    secondDatabase.close();
    first.database.close();
  });

  it("edits an inbox task snapshot, replaces dependencies, and appends an audit event in one transaction", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const dep = service.createTask({
      projectId: "project-1",
      title: "Dependency Task",
      createdBy: "developer",
      status: "ready",
    });
    const inbox = service.createTask({
      projectId: "project-1",
      title: "Draft by Agent",
      objective: "Old draft objective",
      acceptanceCriteria: ["Old AC 1"],
      createdBy: "agent",
      status: "inbox",
    });

    const edited = service.editInboxTask({
      projectId: "project-1",
      taskId: inbox.task.id,
      title: "Refined Task Title",
      objective: "Refined objective by developer",
      acceptanceCriteria: ["Refined AC 1", "Refined AC 2"],
      dependencyIds: [dep.task.id],
      actorLabel: "developer",
    });

    expect(edited.task.title).toBe("Refined Task Title");
    expect(edited.task.objective).toBe("Refined objective by developer");
    expect(edited.task.acceptanceCriteria).toEqual(["Refined AC 1", "Refined AC 2"]);
    expect(edited.task.dependencyIds).toEqual([dep.task.id]);
    expect(edited.task.status).toBe("inbox");
    expect(edited.task.createdBy).toBe("agent"); // preserved
    expect(edited.events.at(-1)).toMatchObject({
      type: "progress",
      summary: "Inbox task definition updated by developer.",
      actorLabel: "developer",
    });

    // Rejects editing non-inbox task
    expect(() =>
      service.editInboxTask({
        projectId: "project-1",
        taskId: dep.task.id,
        title: "Try to edit ready task",
      }),
    ).toThrow(InvalidTaskStateError);

    // Rejects self-dependency
    expect(() =>
      service.editInboxTask({
        projectId: "project-1",
        taskId: inbox.task.id,
        title: "Self dependency attempt",
        dependencyIds: [inbox.task.id],
      }),
    ).toThrow(InvalidTaskDependencyError);

    // Rejects non-existent task
    expect(() =>
      service.editInboxTask({
        projectId: "project-1",
        taskId: "non-existent-id",
        title: "Non-existent",
      }),
    ).toThrow(TaskNotFoundError);

    database.close();
  });

  it("returns ready tasks to inbox and compresses the remaining queue atomically", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const dependency = service.createTask({
      projectId: "project-1",
      title: "Dependency",
      createdBy: "developer",
      status: "ready",
      queuePosition: 1,
    });
    const first = service.createTask({
      projectId: "project-1",
      title: "First",
      createdBy: "developer",
      status: "ready",
      queuePosition: 2,
    });
    const returned = service.createTask({
      projectId: "project-1",
      title: "Return me",
      objective: "Keep this objective",
      acceptanceCriteria: ["Keep this criterion"],
      dependencyIds: [dependency.task.id],
      createdBy: "agent",
      status: "ready",
      queuePosition: 3,
    });
    const last = service.createTask({
      projectId: "project-1",
      title: "Last",
      createdBy: "developer",
      status: "ready",
      queuePosition: 4,
    });

    const result = service.returnTaskToInbox({
      projectId: "project-1",
      taskId: returned.task.id,
      actorLabel: "developer",
    });

    expect(result.task).toMatchObject({
      id: returned.task.id,
      status: "inbox",
      queuePosition: null,
      title: "Return me",
      objective: "Keep this objective",
      acceptanceCriteria: ["Keep this criterion"],
      dependencyIds: [dependency.task.id],
    });
    expect(result.events.at(-1)).toMatchObject({
      type: "progress",
      summary: "Ready task returned to inbox by developer.",
      actorLabel: "developer",
    });
    expect(service.getProjectStatus({ projectId: "project-1" }).next).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: dependency.task.id, queuePosition: 1 }),
        expect.objectContaining({ id: first.task.id, queuePosition: 2 }),
        expect.objectContaining({ id: last.task.id, queuePosition: 3 }),
      ]),
    );
    expect(database.db.select().from(tasks).all().find((task) => task.id === returned.task.id))
      .toMatchObject({ status: "inbox", queuePosition: null });
    database.close();
  });

  it("safely deletes inbox and ready tasks while rejecting dependents and other states", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const prerequisite = service.createTask({
      projectId: "project-1",
      title: "Prerequisite",
      createdBy: "developer",
      status: "ready",
      queuePosition: 1,
    });
    const readyToDelete = service.createTask({
      projectId: "project-1",
      title: "Delete ready",
      createdBy: "developer",
      status: "ready",
      queuePosition: 2,
    });
    const dependent = service.createTask({
      projectId: "project-1",
      title: "Dependent",
      createdBy: "developer",
      dependencyIds: [readyToDelete.task.id],
      status: "inbox",
    });

    expect(() =>
      service.deleteTask({ projectId: "project-1", taskId: readyToDelete.task.id }),
    ).toThrow(TaskHasDependentsError);
    expect(() =>
      service.deleteTask({ projectId: "project-1", taskId: readyToDelete.task.id }),
    ).toThrowError(expect.objectContaining({
      dependentTaskIds: [dependent.task.id],
    }));

    service.deleteTask({ projectId: "project-1", taskId: dependent.task.id });
    service.deleteTask({ projectId: "project-1", taskId: readyToDelete.task.id });
    expect(service.getTask({ projectId: "project-1", taskId: prerequisite.task.id }).task.queuePosition)
      .toBe(1);

    const inbox = service.createTask({
      projectId: "project-1",
      title: "Delete inbox",
      createdBy: "developer",
    });
    service.deleteTask({ projectId: "project-1", taskId: inbox.task.id });
    expect(() => service.getTask({ projectId: "project-1", taskId: inbox.task.id })).toThrow(
      TaskNotFoundError,
    );

    const running = service.createTask({
      projectId: "project-1",
      title: "Running",
      createdBy: "developer",
      status: "ready",
      queuePosition: 2,
    });
    service.startTask({ projectId: "project-1", taskId: running.task.id });
    expect(() => service.deleteTask({ projectId: "project-1", taskId: running.task.id })).toThrow(
      InvalidTaskStateError,
    );

    database.db
      .update(tasks)
      .set({ status: "blocked" })
      .where(eq(tasks.id, prerequisite.task.id))
      .run();
    expect(() => service.deleteTask({ projectId: "project-1", taskId: prerequisite.task.id })).toThrow(
      InvalidTaskStateError,
    );
    database.db
      .update(tasks)
      .set({ status: "completed", completedAt: "2026-10-11T13:00:00.000Z" })
      .where(eq(tasks.id, prerequisite.task.id))
      .run();
    expect(() => service.deleteTask({ projectId: "project-1", taskId: prerequisite.task.id })).toThrow(
      InvalidTaskStateError,
    );
    database.close();
  });

  it("separates agent submission from developer approval and supports review rework", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const task = service.createTask({
      projectId: "project-1",
      title: "Review lifecycle",
      createdBy: "developer",
      status: "ready",
    });
    const dependent = service.createTask({
      projectId: "project-1",
      title: "Dependent task",
      createdBy: "developer",
      status: "ready",
      dependencyIds: [task.task.id],
      queuePosition: 2,
    });

    const firstRun = service.startTask({
      projectId: "project-1",
      taskId: task.task.id,
      actorLabel: "gpt-5-codex",
    });
    const submitted = service.submitForReview({
      projectId: "project-1",
      taskId: task.task.id,
      runId: firstRun.runId,
      commitSha: "2222222222222222222222222222222222222222",
      summary: "Implementation is ready for review.",
      completedWork: ["Implemented the feature"],
    });
    expect(submitted.task.status).toBe("in_review");
    expect(submitted.task.completedAt).toBeNull();
    expect(submitted.events.at(-1)).toMatchObject({ type: "submitted_for_review" });
    expect(service.getProjectStatus({ projectId: "project-1" })).toMatchObject({
      inReview: [expect.objectContaining({ id: task.task.id })],
      recentlyCompleted: [],
    });
    expect(() => service.startTask({ projectId: "project-1", taskId: dependent.task.id })).toThrow(
      TaskDependenciesIncompleteError,
    );

    const returnedForChanges = service.requestTaskChanges({
      projectId: "project-1",
      taskId: task.task.id,
      feedback: "请补充边界条件测试。",
      actorLabel: "developer",
    });
    expect(returnedForChanges.task).toMatchObject({
      status: "ready",
      queuePosition: 1,
      activeRunId: null,
      completedAt: null,
      handoffNote: "请补充边界条件测试。",
    });
    expect(returnedForChanges.events.at(-1)).toMatchObject({
      type: "changes_requested",
      summary: "请补充边界条件测试。",
    });

    const secondRun = service.startTask({
      projectId: "project-1",
      taskId: task.task.id,
      actorLabel: "gpt-5-codex",
    });
    expect(secondRun.runId).not.toBe(firstRun.runId);
    service.submitForReview({
      projectId: "project-1",
      taskId: task.task.id,
      runId: secondRun.runId,
      commitSha: "3333333333333333333333333333333333333333",
      summary: "Updated implementation is ready.",
    });
    const secondReviewRun = service.startReview({
      projectId: "project-1",
      taskId: task.task.id,
    });
    service.completeReview({
      projectId: "project-1",
      taskId: task.task.id,
      reviewRunId: secondReviewRun.reviewRunId,
      decision: "passed",
      summary: "Updated review passed.",
      verificationEvidence: [{ command: "pnpm test", result: "passed" }],
    });
    const approved = service.approveTask({
      projectId: "project-1",
      taskId: task.task.id,
      actorLabel: "reviewer",
    });
    expect(approved.task.status).toBe("completed");
    expect(approved.events.at(-1)).toMatchObject({
      type: "approved",
      actorLabel: "reviewer",
    });

    const dependentRun = service.startTask({
      projectId: "project-1",
      taskId: dependent.task.id,
    });
    expect(dependentRun.task.task.status).toBe("running");
    service.releaseTask({
      projectId: "project-1",
      taskId: dependent.task.id,
      runId: dependentRun.runId,
    });
    const dependentSecondRun = service.startTask({
      projectId: "project-1",
      taskId: dependent.task.id,
    });
    const dependentSubmitted = service.submitForReview({
      projectId: "project-1",
      taskId: dependent.task.id,
      runId: dependentSecondRun.runId,
      commitSha: "4444444444444444444444444444444444444444",
      summary: "Dependent implementation ready.",
    });
    const dependentReviewRun = service.startReview({
      projectId: "project-1",
      taskId: dependent.task.id,
    });
    service.completeReview({
      projectId: "project-1",
      taskId: dependent.task.id,
      reviewRunId: dependentReviewRun.reviewRunId,
      decision: "passed",
      summary: "Dependent review passed.",
      verificationEvidence: [{ command: "pnpm test", result: "passed" }],
    });
    service.approveTask({ projectId: "project-1", taskId: dependent.task.id });
    expect(dependentSubmitted.task.status).toBe("in_review");

    const reopened = service.reopenTask({
      projectId: "project-1",
      taskId: task.task.id,
      reason: "需要补充性能说明。",
      actorLabel: "developer",
    });
    expect(reopened.task).toMatchObject({
      status: "ready",
      queuePosition: 1,
      completedAt: null,
      activeRunId: null,
      handoffNote: "需要补充性能说明。",
    });
    expect(reopened.events.at(-1)).toMatchObject({
      type: "reopened",
      summary: "需要补充性能说明。",
    });
    expect(service.getProjectStatus({ projectId: "project-1" }).recentlyCompleted.map((item) => item.id))
      .not.toContain(task.task.id);
    database.close();
  });

  it("requires developer risk confirmation and serializes independent review claims", async () => {
    const projectRoot = createTemporaryProject();
    const { database, service } = await createService(projectRoot);
    const discovered = service.createTask({
      projectId: "project-1",
      title: "Low-risk review",
      createdBy: "agent",
    });
    const confirmed = service.confirmTask({
      projectId: "project-1",
      taskId: discovered.task.id,
      riskLevel: "low",
      actorLabel: "developer",
    });
    expect(confirmed.task).toMatchObject({
      riskLevel: "low",
      riskConfirmed: true,
    });

    const unconfirmed = service.createTask({
      projectId: "project-1",
      title: "Unconfirmed risk",
      createdBy: "agent",
      status: "ready",
      queuePosition: 2,
    });
    expect(
      service
        .getProjectStatus({ projectId: "project-1" })
        .next.find((task) => task.id === unconfirmed.task.id),
    ).toMatchObject({ runnable: false, riskConfirmed: false });
    expect(() =>
      service.startTask({ projectId: "project-1", taskId: unconfirmed.task.id }),
    ).toThrow(TaskRiskNotConfirmedError);

    const started = service.startTask({
      projectId: "project-1",
      taskId: discovered.task.id,
      actorLabel: "implementer",
    });
    service.submitForReview({
      projectId: "project-1",
      taskId: discovered.task.id,
      runId: started.runId,
      commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      branch: "feature/low-risk",
      worktree: "/tmp/milestack-low-risk",
      summary: "Ready for independent review.",
    });

    const secondDatabase = await ensureDatabase(projectRoot);
    const secondService = new TaskService(createSqliteRepository(secondDatabase), {
      now: () => new Date("2026-10-11T12:00:00.000Z"),
      generateId: (() => {
        let counter = 0;
        return () => `review-claim-${++counter}`;
      })(),
    });
    const claims = await Promise.allSettled([
      Promise.resolve().then(() =>
        service.startReview({
          projectId: "project-1",
          taskId: discovered.task.id,
          actorLabel: "reviewer-a",
        }),
      ),
      Promise.resolve().then(() =>
        secondService.startReview({
          projectId: "project-1",
          taskId: discovered.task.id,
          actorLabel: "reviewer-b",
        }),
      ),
    ]);
    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "rejected")).toHaveLength(1);

    const winningClaim = claims.find(
      (claim): claim is PromiseFulfilledResult<ReturnType<TaskService["startReview"]>> =>
        claim.status === "fulfilled",
    );
    if (!winningClaim) throw new Error("Expected one review claim to succeed.");
    expect(() =>
      service.completeReview({
        projectId: "project-1",
        taskId: discovered.task.id,
        reviewRunId: "stale-review-run",
        decision: "passed",
        summary: "Stale review",
        verificationEvidence: [{ command: "pnpm test", result: "passed" }],
      }),
    ).toThrow(ReviewRunOwnershipError);

    const completed = service.completeReview({
      projectId: "project-1",
      taskId: discovered.task.id,
      reviewRunId: winningClaim.value.reviewRunId,
      decision: "passed",
      summary: "Low-risk review passed.",
      verificationEvidence: [{ command: "pnpm test", result: "passed" }],
    });
    expect(completed.task.status).toBe("completed");
    expect(completed.reviews.at(-1)).toMatchObject({
      commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      branch: "feature/low-risk",
      worktree: "/tmp/milestack-low-risk",
      status: "passed",
      reviewerActorLabel: expect.stringMatching(/^reviewer-/),
    });
    expect(completed.task.activeReviewRunId).toBeNull();

    secondDatabase.close();
    database.close();
  });

  it("keeps medium-risk review passes awaiting developer approval and records structured changes", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const task = service.createTask({
      projectId: "project-1",
      title: "Medium-risk review",
      createdBy: "developer",
      status: "ready",
      riskLevel: "medium",
    });
    const started = service.startTask({ projectId: "project-1", taskId: task.task.id });
    service.submitForReview({
      projectId: "project-1",
      taskId: task.task.id,
      runId: started.runId,
      commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      summary: "Ready for review.",
    });
    const review = service.startReview({ projectId: "project-1", taskId: task.task.id });
    const passed = service.completeReview({
      projectId: "project-1",
      taskId: task.task.id,
      reviewRunId: review.reviewRunId,
      decision: "passed",
      summary: "Review passed but needs developer approval.",
      verificationEvidence: [{ command: "pnpm test", result: "passed" }],
    });
    expect(passed.task.status).toBe("in_review");
    expect(() => service.startReview({ projectId: "project-1", taskId: task.task.id })).toThrow(
      InvalidTaskStateError,
    );
    expect(service.approveTask({ projectId: "project-1", taskId: task.task.id }).task.status).toBe(
      "completed",
    );

    const changedTask = service.createTask({
      projectId: "project-1",
      title: "Structured changes",
      createdBy: "developer",
      status: "ready",
      queuePosition: 2,
    });
    const changedRun = service.startTask({ projectId: "project-1", taskId: changedTask.task.id });
    service.submitForReview({
      projectId: "project-1",
      taskId: changedTask.task.id,
      runId: changedRun.runId,
      commitSha: "cccccccccccccccccccccccccccccccccccccccc",
      summary: "Needs review.",
    });
    const changedReview = service.startReview({
      projectId: "project-1",
      taskId: changedTask.task.id,
    });
    const returned = service.completeReview({
      projectId: "project-1",
      taskId: changedTask.task.id,
      reviewRunId: changedReview.reviewRunId,
      decision: "changes_requested",
      summary: "Please address the finding.",
      findings: [
        {
          issue: "Missing rollback coverage",
          suggestion: "Add a regression test for rollback.",
          severity: "high",
        },
      ],
    });
    expect(returned.task).toMatchObject({
      status: "ready",
      activeRunId: null,
      activeReviewRunId: null,
    });
    expect(returned.reviews.at(-1)?.findings).toEqual([
      {
        issue: "Missing rollback coverage",
        suggestion: "Add a regression test for rollback.",
        severity: "high",
      },
    ]);
    database.close();
  });
  it("preserves authoritative objective and acceptanceCriteria through ready -> review -> changes_requested -> ready -> re-claim -> re-submit lifecycle", async () => {
    const projectRoot = createTemporaryProject();
    const { database, service } = await createService(projectRoot);
    const task = service.createTask({
      projectId: "project-1",
      title: "Roundtrip lifecycle task",
      objective: "Keep objective intact across review states",
      acceptanceCriteria: ["Criteria 1", "Criteria 2"],
      createdBy: "developer",
      status: "ready",
      queuePosition: 1,
    });

    // 1. Ready state has authoritative definition
    const initialDetails = service.getTask({ projectId: "project-1", taskId: task.task.id });
    expect(initialDetails.task.objective).toBe("Keep objective intact across review states");
    expect(initialDetails.task.acceptanceCriteria).toEqual(["Criteria 1", "Criteria 2"]);

    // 2. Claim and run
    const run1 = service.startTask({ projectId: "project-1", taskId: task.task.id, actorLabel: "agent-1" });
    const runningDetails = service.getTask({ projectId: "project-1", taskId: task.task.id });
    expect(runningDetails.task.status).toBe("running");
    expect(runningDetails.task.objective).toBe("Keep objective intact across review states");
    expect(runningDetails.task.acceptanceCriteria).toEqual(["Criteria 1", "Criteria 2"]);

    // 3. Submit for review round 1
    service.submitForReview({
      projectId: "project-1",
      taskId: task.task.id,
      runId: run1.runId,
      commitSha: "1111111111111111111111111111111111111111",
      branch: "main",
      summary: "First implementation ready for review.",
    });
    const inReviewDetails = service.getTask({ projectId: "project-1", taskId: task.task.id });
    expect(inReviewDetails.task.status).toBe("in_review");
    expect(inReviewDetails.task.objective).toBe("Keep objective intact across review states");
    expect(inReviewDetails.task.acceptanceCriteria).toEqual(["Criteria 1", "Criteria 2"]);

    // 4. Start review and request changes
    const review1 = service.startReview({ projectId: "project-1", taskId: task.task.id });
    const returned = service.completeReview({
      projectId: "project-1",
      taskId: task.task.id,
      reviewRunId: review1.reviewRunId,
      decision: "changes_requested",
      summary: "Needs fixes.",
      findings: [{ issue: "Defect found", suggestion: "Fix defect", severity: "high" }],
    });
    expect(returned.task.status).toBe("ready");
    expect(returned.task.objective).toBe("Keep objective intact across review states");
    expect(returned.task.acceptanceCriteria).toEqual(["Criteria 1", "Criteria 2"]);

    // 5. Querying task after returning to ready retains authoritative definition
    const returnedDetails = service.getTask({ projectId: "project-1", taskId: task.task.id });
    expect(returnedDetails.task.status).toBe("ready");
    expect(returnedDetails.task.objective).toBe("Keep objective intact across review states");
    expect(returnedDetails.task.acceptanceCriteria).toEqual(["Criteria 1", "Criteria 2"]);
    expect(returnedDetails.reviews).toHaveLength(1);
    expect(returnedDetails.reviews[0]?.status).toBe("changes_requested");

    // 6. Re-claim task (run 2)
    const run2 = service.startTask({ projectId: "project-1", taskId: task.task.id, actorLabel: "agent-2" });
    expect(run2.runId).not.toBe(run1.runId);
    const reClaimedDetails = service.getTask({ projectId: "project-1", taskId: task.task.id });
    expect(reClaimedDetails.task.status).toBe("running");
    expect(reClaimedDetails.task.objective).toBe("Keep objective intact across review states");
    expect(reClaimedDetails.task.acceptanceCriteria).toEqual(["Criteria 1", "Criteria 2"]);

    // 7. Re-submit for review round 2
    service.submitForReview({
      projectId: "project-1",
      taskId: task.task.id,
      runId: run2.runId,
      commitSha: "2222222222222222222222222222222222222222",
      branch: "main",
      summary: "Fixed defect in round 2.",
    });
    const reSubmittedDetails = service.getTask({ projectId: "project-1", taskId: task.task.id });
    expect(reSubmittedDetails.task.status).toBe("in_review");
    expect(reSubmittedDetails.task.objective).toBe("Keep objective intact across review states");
    expect(reSubmittedDetails.task.acceptanceCriteria).toEqual(["Criteria 1", "Criteria 2"]);
    expect(reSubmittedDetails.reviews).toHaveLength(2);
    expect(reSubmittedDetails.reviews[1]?.reviewRound).toBe(2);
    expect(reSubmittedDetails.reviews[1]?.status).toBe("pending");

    database.close();
  });

  it("lets a developer waive an unfinished review and invalidates the in-flight review run", async () => {
    const projectRoot = createTemporaryProject();
    const { database, service } = await createService(projectRoot);
    const task = service.createTask({
      projectId: "project-1",
      title: "Waivable review",
      createdBy: "developer",
      status: "ready",
    });
    const run = service.startTask({
      projectId: "project-1",
      taskId: task.task.id,
      actorLabel: "gpt-5-codex",
    });
    service.submitForReview({
      projectId: "project-1",
      taskId: task.task.id,
      runId: run.runId,
      commitSha: "3333333333333333333333333333333333333333",
      summary: "Implementation complete.",
    });

    expect(() =>
      service.waiveTaskApproval({
        projectId: "project-1",
        taskId: task.task.id,
        reason: "   ",
        actorLabel: "developer",
      }),
    ).toThrow();

    expect(() =>
      service.waiveTaskApproval({
        projectId: "project-1",
        taskId: task.task.id,
        reason: "Verified the artifact manually.",
        actorLabel: "developer",
      }),
    ).not.toThrow();

    const waived = service.getTask({ projectId: "project-1", taskId: task.task.id });
    expect(waived.task.status).toBe("completed");
    expect(waived.task.completedAt).toBeTruthy();
    expect(waived.task.activeReviewRunId).toBeNull();
    expect(waived.reviews[0]).toMatchObject({
      status: "waived",
      reviewerActorLabel: "developer",
    });
    expect(waived.reviews[0]?.concludedAt).toBeTruthy();
    expect(waived.reviews[0]?.verificationEvidence).toEqual([]);
    expect(waived.events.at(-1)).toMatchObject({
      type: "approved",
      actorLabel: "developer",
    });
    expect(waived.events.at(-1)?.summary).toContain("Verified the artifact manually.");

    database.close();
  });

  it("revokes an in-flight review run when the developer waives the review", async () => {
    const projectRoot = createTemporaryProject();
    const { database, service } = await createService(projectRoot);
    const task = service.createTask({
      projectId: "project-1",
      title: "Waived while reviewing",
      createdBy: "developer",
      status: "ready",
    });
    const run = service.startTask({ projectId: "project-1", taskId: task.task.id });
    service.submitForReview({
      projectId: "project-1",
      taskId: task.task.id,
      runId: run.runId,
      commitSha: "4444444444444444444444444444444444444444",
      summary: "Implementation complete.",
    });
    const reviewRun = service.startReview({
      projectId: "project-1",
      taskId: task.task.id,
      actorLabel: "review-agent",
    });

    service.waiveTaskApproval({
      projectId: "project-1",
      taskId: task.task.id,
      reason: "Reviewed the artifact directly.",
      actorLabel: "developer",
    });

    const claimed = service.getTask({ projectId: "project-1", taskId: task.task.id });
    expect(claimed.reviews[0]?.status).toBe("waived");

    expect(() =>
      service.completeReview({
        projectId: "project-1",
        taskId: task.task.id,
        reviewRunId: reviewRun.reviewRunId,
        decision: "passed",
        summary: "Late review conclusion.",
        verificationEvidence: [{ command: "pnpm test", result: "passed" }],
      }),
    ).toThrow(InvalidTaskStateError);

    database.close();
  });

  it("keeps the passed-review approval path separate from developer waivers", async () => {
    const projectRoot = createTemporaryProject();
    const { database, service } = await createService(projectRoot);
    const task = service.createTask({
      projectId: "project-1",
      title: "Passed review",
      createdBy: "developer",
      status: "ready",
    });
    const run = service.startTask({ projectId: "project-1", taskId: task.task.id });
    service.submitForReview({
      projectId: "project-1",
      taskId: task.task.id,
      runId: run.runId,
      commitSha: "5555555555555555555555555555555555555555",
      summary: "Implementation complete.",
    });
    const reviewRun = service.startReview({
      projectId: "project-1",
      taskId: task.task.id,
    });
    service.completeReview({
      projectId: "project-1",
      taskId: task.task.id,
      reviewRunId: reviewRun.reviewRunId,
      decision: "passed",
      summary: "Review passed.",
      verificationEvidence: [{ command: "pnpm test", result: "passed" }],
    });

    expect(() =>
      service.waiveTaskApproval({
        projectId: "project-1",
        taskId: task.task.id,
        reason: "Should not apply to a passed review.",
      }),
    ).toThrow(InvalidTaskStateError);

    const approved = service.approveTask({
      projectId: "project-1",
      taskId: task.task.id,
      actorLabel: "developer",
    });
    expect(approved.task.status).toBe("completed");
    expect(approved.reviews[0]?.status).toBe("passed");

    database.close();
  });

  it("rejects developer waivers outside in_review", async () => {
    const projectRoot = createTemporaryProject();
    const { database, service } = await createService(projectRoot);
    const ready = service.createTask({
      projectId: "project-1",
      title: "Ready task",
      createdBy: "developer",
      status: "ready",
    });
    expect(() =>
      service.waiveTaskApproval({
        projectId: "project-1",
        taskId: ready.task.id,
        reason: "Not submitted yet.",
      }),
    ).toThrow(InvalidTaskStateError);

    const run = service.startTask({ projectId: "project-1", taskId: ready.task.id });
    expect(() =>
      service.waiveTaskApproval({
        projectId: "project-1",
        taskId: ready.task.id,
        reason: "Still running.",
      }),
    ).toThrow(InvalidTaskStateError);
    expect(run.runId).toBeTruthy();

    database.close();
  });
});
