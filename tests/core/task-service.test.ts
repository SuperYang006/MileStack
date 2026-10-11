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
  TaskNotFoundError,
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

    const finished = service.finishTask({
      projectId: "project-1",
      taskId: task.task.id,
      runId: started.runId,
      summary: "Implementation complete.",
      completedWork: ["Implemented and tested the lifecycle"],
    });
    expect(finished.task.status).toBe("completed");
    expect(finished.task.activeRunId).toBeNull();
    expect(finished.events.at(-1)).toMatchObject({
      type: "completed",
      actorLabel: "gpt-5-codex",
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
});
