import { randomUUID } from "node:crypto";

import {
  createTaskInputSchema,
  createTasksInputSchema,
  getProjectStatusInputSchema,
  getTaskInputSchema,
  projectStatusSchema,
  taskDetailsSchema,
  type CreateTaskInput,
  type CreateTasksInput,
  type GetProjectStatusInput,
  type GetTaskInput,
  type ProjectStatus,
  type TaskDetails,
  type TaskSummary,
} from "./query-contract.js";
import {
  InvalidTaskError,
  ProjectNotFoundError,
  TaskNotFoundError,
} from "./errors.js";
import type {
  MileStackRepository,
  ProjectRecord,
  TaskEventRecord,
  TaskRecord,
} from "./repositories.js";

export type TaskServiceOptions = {
  now?: () => Date;
  generateId?: () => string;
  recentlyCompletedLimit?: number;
};

const emptyTaskFields = {
  currentStep: null,
  nextStep: null,
  blocker: null,
  requiredAction: null,
  handoffNote: null,
  activeRunId: null,
  completedAt: null,
} as const;

function projectToSummary(project: ProjectRecord) {
  return {
    id: project.id,
    name: project.name,
    goal: project.goal,
  };
}

function taskToSummary(task: TaskRecord): TaskSummary {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    status: task.status,
    queuePosition: task.queuePosition,
    currentStep: task.currentStep,
    nextStep: task.nextStep,
    blocker: task.blocker,
    requiredAction: task.requiredAction,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}

function taskToDetails(
  task: TaskRecord,
  events: TaskEventRecord[],
): TaskDetails {
  return taskDetailsSchema.parse({ task, events });
}

export class TaskService {
  private readonly now: () => Date;
  private readonly generateId: () => string;
  private readonly recentlyCompletedLimit: number;

  constructor(
    private readonly repository: MileStackRepository,
    options: TaskServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? randomUUID;
    this.recentlyCompletedLimit = options.recentlyCompletedLimit ?? 10;

    if (
      !Number.isInteger(this.recentlyCompletedLimit) ||
      this.recentlyCompletedLimit < 0
    ) {
      throw new RangeError("recentlyCompletedLimit must be a non-negative integer.");
    }
  }

  createTask(input: CreateTaskInput): TaskDetails {
    const parsed = createTaskInputSchema.parse(input);
    const [created] = this.createTasks({
      projectId: parsed.projectId,
      tasks: [
        {
          title: parsed.title,
          objective: parsed.objective,
          acceptanceCriteria: parsed.acceptanceCriteria,
          status: parsed.status,
          queuePosition: parsed.queuePosition,
          sourceTaskId: parsed.sourceTaskId,
          createdBy: parsed.createdBy,
        },
      ],
    });

    if (!created) {
      throw new Error("Task creation returned no task.");
    }
    return created;
  }

  createTasks(input: CreateTasksInput): TaskDetails[] {
    const parsed = createTasksInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    const taskInputs = parsed.tasks.map((task) =>
      createTaskInputSchema.parse({ ...task, projectId: project.id }),
    );
    const now = this.now().toISOString();
    const records = taskInputs.map((task) =>
      this.buildTaskRecord(project, task, now),
    );

    for (const task of records) {
      if (task.sourceTaskId) {
        const sourceTask = this.repository.findTaskById(task.sourceTaskId);
        if (!sourceTask || sourceTask.projectId !== project.id) {
          throw new TaskNotFoundError(task.sourceTaskId);
        }
      }
    }

    this.repository.transaction((transaction) => {
      for (const task of records) {
        transaction.insertTask(task);
        transaction.insertTaskEvent(this.createdEventFor(task));
      }
    });

    return records.map((task) =>
      taskToDetails(task, this.repository.listByTaskId(task.id)),
    );
  }

  getTask(input: GetTaskInput): TaskDetails {
    const parsed = getTaskInputSchema.parse(input);
    this.requireProject(parsed.projectId);
    const task = this.repository.findTaskById(parsed.taskId);
    if (!task || task.projectId !== parsed.projectId) {
      throw new TaskNotFoundError(parsed.taskId);
    }

    return taskToDetails(task, this.repository.listByTaskId(task.id));
  }

  getProjectStatus(input: GetProjectStatusInput): ProjectStatus {
    const parsed = getProjectStatusInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    const tasks = this.repository.listByProjectId(project.id);
    const current = tasks
      .filter((task) => task.status === "running")
      .map(taskToSummary);
    const next = tasks
      .filter((task) => task.status === "ready")
      .sort(compareQueuePosition)
      .map(taskToSummary);
    const blocked = tasks
      .filter((task) => task.status === "blocked")
      .map(taskToSummary);
    const inbox = tasks
      .filter((task) => task.status === "inbox")
      .map(taskToSummary);
    const recentlyCompleted = tasks
      .filter((task) => task.status === "completed")
      .sort(compareCompletedAt)
      .slice(0, this.recentlyCompletedLimit)
      .map(taskToSummary);

    return projectStatusSchema.parse({
      project: projectToSummary(project),
      current,
      next,
      blocked,
      inbox,
      recentlyCompleted,
    });
  }

  private requireProject(projectId: string): ProjectRecord {
    const project = this.repository.findProjectById(projectId);
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }
    return project;
  }

  private buildTaskRecord(
    project: ProjectRecord,
    input: CreateTaskInput,
    timestamp: string,
  ): TaskRecord {
    const status = input.status ?? (input.createdBy === "agent" ? "inbox" : "ready");

    if (status !== "ready" && input.queuePosition !== undefined) {
      throw new InvalidTaskError(
        "queuePosition can only be set for a ready task.",
      );
    }

    return {
      id: this.generateId(),
      projectId: project.id,
      title: input.title,
      objective: input.objective ?? null,
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      status,
      queuePosition: input.queuePosition ?? null,
      ...emptyTaskFields,
      sourceTaskId: input.sourceTaskId ?? null,
      createdBy: input.createdBy,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private createdEventFor(task: TaskRecord): TaskEventRecord {
    return {
      id: this.generateId(),
      projectId: task.projectId,
      taskId: task.id,
      runId: null,
      type: "created",
      summary: `Task created: ${task.title}`,
      completedWork: null,
      currentStep: null,
      nextStep: null,
      blocker: null,
      requiredAction: null,
      handoffNote: null,
      actorLabel: null,
      createdAt: task.createdAt,
    };
  }
}

function compareQueuePosition(left: TaskRecord, right: TaskRecord): number {
  const leftPosition = left.queuePosition ?? Number.POSITIVE_INFINITY;
  const rightPosition = right.queuePosition ?? Number.POSITIVE_INFINITY;
  return (
    leftPosition - rightPosition ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareCompletedAt(left: TaskRecord, right: TaskRecord): number {
  const leftCompletedAt = left.completedAt ?? "";
  const rightCompletedAt = right.completedAt ?? "";
  return (
    rightCompletedAt.localeCompare(leftCompletedAt) ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.id.localeCompare(left.id)
  );
}
