import { randomUUID } from "node:crypto";

import {
  createTaskInputSchema,
  createTasksInputSchema,
  confirmTaskInputSchema,
  deleteTaskInputSchema,
  finishTaskInputSchema,
  getProjectStatusInputSchema,
  getTaskInputSchema,
  projectStatusSchema,
  releaseTaskInputSchema,
  reorderTaskInputSchema,
  setTaskDependenciesInputSchema,
  startTaskInputSchema,
  taskDetailsSchema,
  updateTaskInputSchema,
  type CreateTaskInput,
  type CreateTasksInput,
  type ConfirmTaskInput,
  type DeleteTaskInput,
  type FinishTaskInput,
  type GetProjectStatusInput,
  type GetTaskInput,
  type ProjectStatus,
  type ReleaseTaskInput,
  type ReorderTaskInput,
  type SetTaskDependenciesInput,
  type StartTaskInput,
  type TaskDetails,
  type TaskSummary,
  type UpdateTaskInput,
} from "./query-contract.js";
import {
  InvalidTaskStateError,
  InvalidTaskDependencyError,
  InvalidTaskError,
  ProjectNotFoundError,
  TaskDependenciesIncompleteError,
  TaskDependenciesNotEditableError,
  TaskHasDependentsError,
  TaskNotFoundError,
  TaskRunOwnershipError,
} from "./errors.js";
import type {
  MileStackRepository,
  ProjectRecord,
  TaskDependencyRecord,
  TaskEventRecord,
  TaskRecord,
  TaskRepositoryTransaction,
} from "./repositories.js";

export type TaskServiceOptions = {
  now?: () => Date;
  generateId?: () => string;
  recentlyCompletedLimit?: number;
};

export type StartedTask = {
  runId: string;
  task: TaskDetails;
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

function taskToSummary(
  task: TaskRecord,
  dependencyIds: string[],
  waitingFor: TaskSummary["waitingFor"],
): TaskSummary {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    status: task.status,
    queuePosition: task.queuePosition,
    dependencyIds,
    waitingFor,
    runnable: task.status === "ready" && waitingFor.length === 0,
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
  dependencyIds: string[],
): TaskDetails {
  return taskDetailsSchema.parse({
    task: { ...task, dependencyIds },
    events,
  });
}

function dependencyIdsForTask(
  taskId: string,
  dependencies: TaskDependencyRecord[],
): string[] {
  return dependencies
    .filter((dependency) => dependency.taskId === taskId)
    .map((dependency) => dependency.dependsOnTaskId);
}

function taskToSummaryWithDependencies(
  task: TaskRecord,
  tasks: TaskRecord[],
  dependencies: TaskDependencyRecord[],
): TaskSummary {
  const tasksById = new Map(tasks.map((candidate) => [candidate.id, candidate]));
  const dependencyIds = dependencyIdsForTask(task.id, dependencies);
  const waitingFor = dependencyIds
    .map((dependencyId) => {
      const dependency = tasksById.get(dependencyId);
      if (!dependency) {
        throw new InvalidTaskDependencyError(
          `Task '${task.id}' references missing dependency '${dependencyId}'.`,
        );
      }
      return dependency;
    })
    .filter((dependency) => dependency.status !== "completed")
    .map((dependency) => ({
      id: dependency.id,
      title: dependency.title,
      status: dependency.status,
    }));

  return taskToSummary(task, dependencyIds, waitingFor);
}

function summaryForTask(summaries: TaskSummary[], taskId: string): TaskSummary {
  const summary = summaries.find((candidate) => candidate.id === taskId);
  if (!summary) {
    throw new Error(`Task summary '${taskId}' was not computed.`);
  }
  return summary;
}

function hasDependencyCycle(graph: Map<string, string[]>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (taskId: string): boolean => {
    if (visiting.has(taskId)) {
      return true;
    }
    if (visited.has(taskId)) {
      return false;
    }

    visiting.add(taskId);
    for (const dependencyId of graph.get(taskId) ?? []) {
      if (visit(dependencyId)) {
        return true;
      }
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  };

  return [...graph.keys()].some((taskId) => visit(taskId));
}

function validateTaskDependencies(
  task: TaskRecord,
  dependencyIds: string[],
  projectId: string,
  graphTasks: TaskRecord[],
  existingDependencies: TaskDependencyRecord[],
  transaction: TaskRepositoryTransaction,
): void {
  for (const dependencyId of dependencyIds) {
    if (dependencyId === task.id) {
      throw new InvalidTaskDependencyError(
        `Task '${task.id}' cannot depend on itself.`,
      );
    }

    const dependency = transaction.findTaskById(dependencyId);
    if (!dependency) {
      throw new InvalidTaskDependencyError(
        `Dependency task '${dependencyId}' was not found.`,
      );
    }
    if (dependency.projectId !== projectId) {
      throw new InvalidTaskDependencyError(
        `Dependency task '${dependencyId}' belongs to another project.`,
      );
    }
  }

  const graph = new Map<string, string[]>();
  for (const graphTask of graphTasks) {
    graph.set(graphTask.id, []);
  }
  for (const dependency of existingDependencies) {
    graph.get(dependency.taskId)?.push(dependency.dependsOnTaskId);
  }
  graph.set(task.id, [...dependencyIds]);

  if (hasDependencyCycle(graph)) {
    throw new InvalidTaskDependencyError(
      `Adding dependencies to task '${task.id}' would create a cycle.`,
    );
  }
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
          dependencyIds: parsed.dependencyIds,
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

    this.repository.transaction((transaction) => {
      const existingTasks = transaction.listByProjectId(project.id);
      const existingDependencies = transaction.listDependenciesByProjectId(
        project.id,
      );
      const graphTasks = [...existingTasks, ...records];
      const graphDependencies = [...existingDependencies];
      for (let index = 0; index < records.length; index += 1) {
        for (const dependencyId of taskInputs[index]?.dependencyIds ?? []) {
          graphDependencies.push({
            taskId: records[index]!.id,
            dependsOnTaskId: dependencyId,
          });
        }
      }

      for (let index = 0; index < records.length; index += 1) {
        const task = records[index]!;
        const taskInput = taskInputs[index]!;
        if (task.sourceTaskId) {
          const sourceTask = transaction.findTaskById(task.sourceTaskId);
          if (!sourceTask || sourceTask.projectId !== project.id) {
            throw new TaskNotFoundError(task.sourceTaskId);
          }
        }
        validateTaskDependencies(
          task,
          taskInput.dependencyIds ?? [],
          project.id,
          graphTasks,
          graphDependencies,
          transaction,
        );
      }

      for (let index = 0; index < records.length; index += 1) {
        const task = records[index]!;
        const taskInput = taskInputs[index]!;
        transaction.insertTask(task);
        transaction.replaceTaskDependencies(
          task.id,
          taskInput.dependencyIds ?? [],
        );
        transaction.insertTaskEvent(this.createdEventFor(task));
      }
    });

    return records.map((task) =>
      taskToDetails(
        task,
        this.repository.listByTaskId(task.id),
        this.repository
          .listDependenciesByTaskId(task.id)
          .map((dependency) => dependency.dependsOnTaskId),
      ),
    );
  }

  getTask(input: GetTaskInput): TaskDetails {
    const parsed = getTaskInputSchema.parse(input);
    this.requireProject(parsed.projectId);
    const task = this.repository.findTaskById(parsed.taskId);
    if (!task || task.projectId !== parsed.projectId) {
      throw new TaskNotFoundError(parsed.taskId);
    }

    return taskToDetails(
      task,
      this.repository.listByTaskId(task.id),
      this.repository
        .listDependenciesByTaskId(task.id)
        .map((dependency) => dependency.dependsOnTaskId),
    );
  }

  setTaskDependencies(input: SetTaskDependenciesInput): TaskDetails {
    const parsed = setTaskDependenciesInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);

    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "inbox" && task.status !== "ready") {
        throw new TaskDependenciesNotEditableError(task.id);
      }

      const projectTasks = transaction.listByProjectId(project.id);
      const projectDependencies = transaction.listDependenciesByProjectId(
        project.id,
      );
      validateTaskDependencies(
        task,
        parsed.dependencyIds,
        project.id,
        projectTasks,
        projectDependencies,
        transaction,
      );
      transaction.replaceTaskDependencies(task.id, parsed.dependencyIds);
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId: null,
        type: "progress",
        summary: parsed.summary,
        completedWork: null,
        currentStep: task.currentStep,
        nextStep: task.nextStep,
        blocker: task.blocker,
        requiredAction: task.requiredAction,
        handoffNote: task.handoffNote,
        actorLabel: null,
        createdAt: this.now().toISOString(),
      });
    });

    return this.getTask({ projectId: project.id, taskId: parsed.taskId });
  }

  confirmTask(input: ConfirmTaskInput): TaskDetails {
    const parsed = confirmTaskInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "inbox") {
        throw new InvalidTaskStateError(task.id, "inbox", task.status);
      }
      const queuePosition = transaction
        .listByProjectId(project.id)
        .filter((candidate) => candidate.status === "ready").length + 1;
      const now = this.now().toISOString();
      transaction.updateTask(task.id, {
        status: "ready",
        queuePosition,
        updatedAt: now,
      });
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId: null,
        type: "confirmed",
        summary: `Confirmed as ready task (queue position #${queuePosition}).`,
        completedWork: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: null,
        actorLabel: parsed.actorLabel ?? "developer",
        createdAt: now,
      });
    });
    return this.getTask({ projectId: project.id, taskId: parsed.taskId });
  }

  deleteTask(input: DeleteTaskInput): void {
    const parsed = deleteTaskInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "inbox") {
        throw new InvalidTaskStateError(task.id, "inbox", task.status);
      }
      const dependentTaskIds = transaction
        .listDependenciesByProjectId(project.id)
        .filter((dependency) => dependency.dependsOnTaskId === task.id)
        .map((dependency) => dependency.taskId);
      if (dependentTaskIds.length > 0) {
        throw new TaskHasDependentsError(task.id, dependentTaskIds);
      }
      transaction.deleteTask(task.id);
    });
  }

  reorderTask(input: ReorderTaskInput): TaskDetails {
    const parsed = reorderTaskInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "ready") {
        throw new InvalidTaskStateError(task.id, "ready", task.status);
      }
      const readyTasks = transaction
        .listByProjectId(project.id)
        .filter((candidate) => candidate.status === "ready")
        .sort(compareQueuePosition);
      const index = readyTasks.findIndex((candidate) => candidate.id === task.id);
      const targetIndex = parsed.direction === "up" ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= readyTasks.length) {
        return;
      }
      const reordered = [...readyTasks];
      const current = reordered[index];
      reordered[index] = reordered[targetIndex]!;
      reordered[targetIndex] = current!;
      const now = this.now().toISOString();
      reordered.forEach((candidate, position) => {
        transaction.updateTask(candidate.id, {
          queuePosition: position + 1,
          updatedAt: now,
        });
      });
    });
    return this.getTask({ projectId: project.id, taskId: parsed.taskId });
  }

  startTask(input: StartTaskInput): StartedTask {
    const parsed = startTaskInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    let runId = "";
    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "ready") {
        throw new InvalidTaskStateError(task.id, "ready", task.status);
      }
      const dependencies = transaction
        .listDependenciesByProjectId(project.id)
        .filter((dependency) => dependency.taskId === task.id);
      const projectTasks = new Map(
        transaction.listByProjectId(project.id).map((candidate) => [candidate.id, candidate]),
      );
      const unfinished = dependencies
        .filter((dependency) => projectTasks.get(dependency.dependsOnTaskId)?.status !== "completed")
        .map((dependency) => dependency.dependsOnTaskId);
      if (unfinished.length > 0) {
        throw new TaskDependenciesIncompleteError(task.id, unfinished);
      }

      runId = this.generateId();
      const now = this.now().toISOString();
      const claimed = transaction.updateTask(
        task.id,
        {
          status: "running",
          activeRunId: runId,
          updatedAt: now,
        },
        "ready",
      );
      if (!claimed) {
        throw new InvalidTaskStateError(task.id, "ready", "changed concurrently");
      }
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId,
        type: "started",
        summary: `Started task: ${task.title}`,
        completedWork: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: null,
        actorLabel: parsed.actorLabel ?? null,
        createdAt: now,
      });
    });
    return {
      runId,
      task: this.getTask({ projectId: project.id, taskId: parsed.taskId }),
    };
  }

  updateTask(input: UpdateTaskInput): TaskDetails {
    const parsed = updateTaskInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      this.requireRunOwner(task, parsed.runId);
      if (task.status !== "running") {
        throw new InvalidTaskStateError(task.id, "running", task.status);
      }
      const now = this.now().toISOString();
      const currentStep = parsed.currentStep === undefined ? task.currentStep : parsed.currentStep;
      const nextStep = parsed.nextStep === undefined ? task.nextStep : parsed.nextStep;
      const blocker = parsed.blocker === undefined ? task.blocker : parsed.blocker;
      const requiredAction = parsed.requiredAction === undefined ? task.requiredAction : parsed.requiredAction;
      const handoffNote = parsed.handoffNote === undefined ? task.handoffNote : parsed.handoffNote;
      transaction.updateTask(task.id, {
        currentStep,
        nextStep,
        blocker,
        requiredAction,
        handoffNote,
        updatedAt: now,
      });
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId: parsed.runId,
        type: "progress",
        summary: parsed.summary,
        completedWork: parsed.completedWork,
        currentStep,
        nextStep,
        blocker,
        requiredAction,
        handoffNote,
        actorLabel: parsed.actorLabel ?? null,
        createdAt: now,
      });
    });
    return this.getTask({ projectId: project.id, taskId: parsed.taskId });
  }

  finishTask(input: FinishTaskInput): TaskDetails {
    const parsed = finishTaskInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      this.requireRunOwner(task, parsed.runId);
      if (task.status !== "running" && task.status !== "blocked") {
        throw new InvalidTaskStateError(task.id, "running or blocked", task.status);
      }
      const now = this.now().toISOString();
      transaction.updateTask(task.id, {
        status: "completed",
        queuePosition: null,
        activeRunId: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        completedAt: now,
        updatedAt: now,
      });
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId: parsed.runId,
        type: "completed",
        summary: parsed.summary,
        completedWork: parsed.completedWork,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: task.handoffNote,
        actorLabel: parsed.actorLabel ?? null,
        createdAt: now,
      });
    });
    return this.getTask({ projectId: project.id, taskId: parsed.taskId });
  }

  releaseTask(input: ReleaseTaskInput): TaskDetails {
    const parsed = releaseTaskInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "running" && task.status !== "blocked") {
        throw new InvalidTaskStateError(task.id, "running or blocked", task.status);
      }
      this.requireRunOwner(task, parsed.runId);
      const now = this.now().toISOString();
      transaction
        .listByProjectId(project.id)
        .filter((candidate) => candidate.status === "ready")
        .forEach((candidate) => {
          transaction.updateTask(candidate.id, {
            queuePosition: (candidate.queuePosition ?? 0) + 1,
            updatedAt: now,
          });
        });
      transaction.updateTask(task.id, {
        status: "ready",
        queuePosition: 1,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        activeRunId: null,
        handoffNote: parsed.handoffNote ?? task.handoffNote,
        updatedAt: now,
      });
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId: task.activeRunId,
        type: "released",
        summary: parsed.reason ?? "Task released back to the ready queue.",
        completedWork: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: parsed.handoffNote ?? task.handoffNote,
        actorLabel: parsed.actorLabel ?? "developer",
        createdAt: now,
      });
    });
    return this.getTask({ projectId: project.id, taskId: parsed.taskId });
  }

  private requireRunOwner(task: TaskRecord, runId: string): void {
    if (!task.activeRunId || task.activeRunId !== runId) {
      throw new TaskRunOwnershipError(task.id);
    }
  }

  getProjectStatus(input: GetProjectStatusInput): ProjectStatus {
    const parsed = getProjectStatusInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    const tasks = this.repository.listByProjectId(project.id);
    const dependencies = this.repository.listDependenciesByProjectId(project.id);
    const summaries = tasks.map((task) =>
      taskToSummaryWithDependencies(task, tasks, dependencies),
    );
    const current = tasks
      .filter((task) => task.status === "running")
      .map((task) => summaryForTask(summaries, task.id));
    const next = tasks
      .filter((task) => task.status === "ready")
      .sort(compareQueuePosition)
      .map((task) => summaryForTask(summaries, task.id));
    const blocked = tasks
      .filter((task) => task.status === "blocked")
      .map((task) => summaryForTask(summaries, task.id));
    const inbox = tasks
      .filter((task) => task.status === "inbox")
      .map((task) => summaryForTask(summaries, task.id));
    const recentlyCompleted = tasks
      .filter((task) => task.status === "completed")
      .sort(compareCompletedAt)
      .slice(0, this.recentlyCompletedLimit)
      .map((task) => summaryForTask(summaries, task.id));

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
