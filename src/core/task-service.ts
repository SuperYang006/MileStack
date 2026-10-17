import { randomUUID } from "node:crypto";

import {
  createTaskInputSchema,
  createTasksInputSchema,
  confirmTaskInputSchema,
  deleteTaskInputSchema,
  submitForReviewInputSchema,
  startReviewInputSchema,
  completeReviewInputSchema,
  getProjectStatusInputSchema,
  getTaskInputSchema,
  listTasksInputSchema,
  projectStatusSchema,
  compactProjectStatusSchema,
  approveTaskInputSchema,
  waiveTaskApprovalInputSchema,
  requestTaskChangesInputSchema,
  reopenTaskInputSchema,
  returnTaskToInboxInputSchema,
  taskCursorSchema,
  taskPageSchema,
  releaseTaskInputSchema,
  reorderTaskInputSchema,
  setTaskDependenciesInputSchema,
  startTaskInputSchema,
  taskDetailsSchema,
  taskWorkingDetailsSchema,
  updateTaskInputSchema,
  editInboxTaskInputSchema,
  setTaskIntegrationPolicyInputSchema,
  checkTaskIntegrationInputSchema,
  type CreateTaskInput,
  type CreateTasksInput,
  type ConfirmTaskInput,
  type DeleteTaskInput,
  type SubmitForReviewInput,
  type StartReviewInput,
  type CompleteReviewInput,
  type GetProjectStatusInput,
  type GetTaskInput,
  type CompactProjectStatus,
  type ListTasksInput,
  type ProjectStatus,
  type ProjectStatusResult,
  type ReleaseTaskInput,
  type ReorderTaskInput,
  type ReviewDigest,
  type ApproveTaskInput,
  type WaiveTaskApprovalInput,
  type RequestTaskChangesInput,
  type ReopenTaskInput,
  type ReturnTaskToInboxInput,
  type SetTaskDependenciesInput,
  type StartTaskInput,
  type TaskDetails,
  type TaskWorkingDetails,
  type TaskCursor,
  type TaskPage,
  type TaskSummary,
  type UpdateTaskInput,
  type EditInboxTaskInput,
  type SetTaskIntegrationPolicyInput,
  type CheckTaskIntegrationInput,
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
  TaskRiskNotConfirmedError,
  ReviewRunOwnershipError,
  ReviewEvidenceIncompleteError,
  IntegrationCheckStaleError,
} from "./errors.js";
import type {
  IntegrationChecker,
  IntegrationCheckResult,
} from "./integration-checker.js";
import type { IntegrationStatus } from "./integration-model.js";
import type {
  ReviewFinding,
} from "./review-model.js";
import type {
  MileStackRepository,
  ProjectRecord,
  TaskDependencyRecord,
  TaskEventRecord,
  ReviewRecord,
  TaskRecord,
  TaskRepositoryTransaction,
} from "./repositories.js";

export type TaskServiceOptions = {
  now?: () => Date;
  generateId?: () => string;
  recentlyCompletedLimit?: number;
  integrationChecker?: IntegrationChecker;
};

const compactProjectStatusLimits = {
  current: 3,
  next: 5,
  blocked: 3,
  inReview: 3,
  inbox: 3,
  recentlyCompleted: 3,
} as const;

export type StartedTask = {
  runId: string;
  task: TaskDetails;
};

export type StartedReview = {
  reviewRunId: string;
  task: TaskDetails;
};

type CompletionIntegrationResult = IntegrationCheckResult | {
  status: "not_required";
  message: string;
};

const emptyTaskFields = {
  currentStep: null,
  nextStep: null,
  blocker: null,
  requiredAction: null,
  handoffNote: null,
  activeRunId: null,
  activeReviewRunId: null,
  completedAt: null,
} as const;

function projectToSummary(project: ProjectRecord) {
  return {
    id: project.id,
    name: project.name,
    goal: project.goal,
  };
}

function reviewToDigest(
  review: ReviewRecord,
  acceptanceCriteriaCount: number,
): ReviewDigest {
  return {
    id: review.id,
    status: review.status,
    reviewRound: review.reviewRound,
    commitSha: review.commitSha,
    reviewerActorLabel: review.reviewerActorLabel,
    branch: review.branch,
    worktree: review.worktree,
    summary: review.summary,
    createdAt: review.createdAt,
    acceptanceCriteriaCount,
    verificationEvidenceCount: review.verificationEvidence.length,
    findingsCount: review.findings.length,
    integrationRequired: review.integrationRequired,
    integrationTargetBranch: review.integrationTargetBranch,
    integrationNotRequiredReason: review.integrationNotRequiredReason,
    approvedAt: review.approvedAt,
    integrationStatus: review.integrationStatus,
    integrationMessage: review.integrationMessage,
    integrationTargetCommitSha: review.integrationTargetCommitSha,
    integrationCheckedAt: review.integrationCheckedAt,
  };
}

function taskToSummary(
  task: TaskRecord,
  dependencyIds: string[],
  waitingFor: TaskSummary["waitingFor"],
  latestReview: ReviewRecord | null = null,
): TaskSummary {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    objective: task.objective,
    acceptanceCriteria: task.acceptanceCriteria,
    status: task.status,
    queuePosition: task.queuePosition,
    dependencyIds,
    waitingFor,
    runnable:
      task.status === "ready" && task.riskConfirmed && waitingFor.length === 0,
    currentStep: task.currentStep,
    nextStep: task.nextStep,
    blocker: task.blocker,
    requiredAction: task.requiredAction,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    riskLevel: task.riskLevel,
    riskConfirmed: task.riskConfirmed,
    integrationRequired: task.integrationRequired,
    integrationTargetBranch: task.integrationTargetBranch,
    integrationNotRequiredReason: task.integrationNotRequiredReason,
    latestReview:
      latestReview === null
        ? null
        : reviewToDigest(latestReview, task.acceptanceCriteria?.length ?? 0),
  };
}

function latestReviewsByTaskId(reviews: ReviewRecord[]): Map<string, ReviewRecord> {
  const latestReviews = new Map<string, ReviewRecord>();
  for (const review of reviews) {
    const current = latestReviews.get(review.taskId);
    if (!current || review.reviewRound > current.reviewRound) {
      latestReviews.set(review.taskId, review);
    }
  }
  return latestReviews;
}

function taskToDetails(
  task: TaskRecord,
  events: TaskEventRecord[],
  dependencyIds: string[],
  reviews: ReviewRecord[],
): TaskDetails {
  return taskDetailsSchema.parse({
    task: { ...task, dependencyIds },
    events,
    reviews,
  });
}

function taskToWorkingDetails(
  task: TaskRecord,
  events: TaskEventRecord[],
  dependencyIds: string[],
  dependencies: TaskWorkingDetails["dependencies"],
  reviews: ReviewRecord[],
): TaskWorkingDetails {
  const latestReview = reviews.at(-1) ?? null;
  const latestSubmissionEvent = events
    .filter((event) => event.type === "submitted_for_review")
    .at(-1);
  const latestSubmission =
    latestReview && latestSubmissionEvent
      ? {
          review: latestReview,
          summary:
            task.status === "in_review" ? latestSubmissionEvent.summary : null,
          completedWork:
            task.status === "in_review"
              ? latestSubmissionEvent.completedWork
              : null,
        }
      : null;
  const currentRunId =
    task.activeRunId ??
    (task.status === "in_review" ? latestSubmissionEvent?.runId ?? null : null);
  const currentRunEvents = currentRunId
    ? events.filter(
        (event) =>
          event.runId === currentRunId &&
          event.type !== "submitted_for_review",
      )
    : [];

  return taskWorkingDetailsSchema.parse({
    task: { ...task, dependencyIds },
    dependencies,
    currentRunEvents,
    latestSubmission,
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
  latestReviews: ReadonlyMap<string, ReviewRecord>,
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

  return taskToSummary(task, dependencyIds, waitingFor, latestReviews.get(task.id) ?? null);
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
  private readonly integrationChecker: IntegrationChecker | undefined;

  constructor(
    private readonly repository: MileStackRepository,
    options: TaskServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? randomUUID;
    this.recentlyCompletedLimit = options.recentlyCompletedLimit ?? 10;
    this.integrationChecker = options.integrationChecker;

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
          riskLevel: parsed.riskLevel,
          createdBy: parsed.createdBy,
          actorLabel: parsed.actorLabel,
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
        transaction.insertTaskEvent(this.createdEventFor(task, taskInput.actorLabel));
      }
    });

    return records.map((task) =>
      taskToDetails(
        task,
        this.repository.listByTaskId(task.id),
        this.repository
          .listDependenciesByTaskId(task.id)
          .map((dependency) => dependency.dependsOnTaskId),
        this.repository.listReviewsByTaskId(task.id),
      ),
    );
  }

  getTask(input: GetTaskInput & { view: "full" }): TaskDetails;
  getTask(input: GetTaskInput & { view?: "working" }): TaskWorkingDetails;
  getTask(input: GetTaskInput): TaskDetails | TaskWorkingDetails;
  getTask(input: GetTaskInput): TaskDetails | TaskWorkingDetails {
    const parsed = getTaskInputSchema.parse(input);
    this.requireProject(parsed.projectId);
    const task = this.repository.findTaskById(parsed.taskId);
    if (!task || task.projectId !== parsed.projectId) {
      throw new TaskNotFoundError(parsed.taskId);
    }

    const events = this.repository.listByTaskId(task.id);
    const dependencyIds = this.repository
      .listDependenciesByTaskId(task.id)
      .map((dependency) => dependency.dependsOnTaskId);
    const reviews = this.repository.listReviewsByTaskId(task.id);

    if (parsed.view === "full") {
      return taskToDetails(task, events, dependencyIds, reviews);
    }

    const dependencies = dependencyIds.map((dependencyId) => {
      const dependency = this.repository.findTaskById(dependencyId);
      if (!dependency || dependency.projectId !== task.projectId) {
        throw new TaskNotFoundError(dependencyId);
      }
      return {
        id: dependency.id,
        title: dependency.title,
        status: dependency.status,
      };
    });

    return taskToWorkingDetails(
      task,
      events,
      dependencyIds,
      dependencies,
      reviews,
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
        actorLabel: "developer",
        createdAt: this.now().toISOString(),
      });
    });

    return this.getTask({ projectId: project.id, taskId: parsed.taskId, view: "full" });
  }

  setTaskIntegrationPolicy(input: SetTaskIntegrationPolicyInput): TaskDetails {
    const parsed = setTaskIntegrationPolicyInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "inbox" && task.status !== "ready") {
        throw new InvalidTaskStateError(task.id, "inbox or ready", task.status);
      }

      const now = this.now().toISOString();
      const integrationNotRequiredReason = parsed.integrationRequired
        ? null
        : parsed.integrationNotRequiredReason ?? null;
      const integrationTargetBranch = parsed.integrationTargetBranch;
      transaction.updateTask(task.id, {
        integrationRequired: parsed.integrationRequired,
        integrationTargetBranch,
        integrationNotRequiredReason,
        updatedAt: now,
      });
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId: null,
        type: "progress",
        summary: parsed.integrationRequired
          ? `Developer requires local Git integration on '${integrationTargetBranch}'.`
          : `Developer waived Git integration: ${integrationNotRequiredReason}`,
        completedWork: null,
        currentStep: task.currentStep,
        nextStep: task.nextStep,
        blocker: task.blocker,
        requiredAction: task.requiredAction,
        handoffNote: task.handoffNote,
        actorLabel: parsed.actorLabel ?? "developer",
        createdAt: now,
      });
    });
    return this.getTask({ projectId: project.id, taskId: parsed.taskId, view: "full" });
  }
  editInboxTask(input: EditInboxTaskInput): TaskDetails {
    const parsed = editInboxTaskInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);

    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "inbox") {
        throw new InvalidTaskStateError(task.id, "inbox", task.status);
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

      const now = this.now().toISOString();
      const objective =
        parsed.objective && parsed.objective.trim().length > 0
          ? parsed.objective.trim()
          : null;
      transaction.updateTask(task.id, {
        title: parsed.title,
        objective,
        acceptanceCriteria: parsed.acceptanceCriteria,
        riskLevel: parsed.riskLevel ?? task.riskLevel,
        updatedAt: now,
      });
      transaction.replaceTaskDependencies(task.id, parsed.dependencyIds);
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId: null,
        type: "progress",
        summary: "Inbox task definition updated by developer.",
        completedWork: null,
        currentStep: task.currentStep,
        nextStep: task.nextStep,
        blocker: task.blocker,
        requiredAction: task.requiredAction,
        handoffNote: task.handoffNote,
        actorLabel: parsed.actorLabel ?? "developer",
        createdAt: now,
      });
    });

    return this.getTask({ projectId: project.id, taskId: parsed.taskId, view: "full" });
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
        riskLevel: parsed.riskLevel ?? task.riskLevel,
        riskConfirmed: true,
        riskConfirmedBy: parsed.actorLabel ?? "developer",
        riskConfirmedAt: now,
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
    return this.getTask({ projectId: project.id, taskId: parsed.taskId, view: "full" });
  }

  returnTaskToInbox(input: ReturnTaskToInboxInput): TaskDetails {
    const parsed = returnTaskToInboxInputSchema.parse(input);
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
        .filter((candidate) => candidate.status === "ready" && candidate.id !== task.id)
        .sort(compareQueuePosition);
      const now = this.now().toISOString();
      transaction.updateTask(task.id, {
        status: "inbox",
        queuePosition: null,
        updatedAt: now,
      });
      readyTasks.forEach((candidate, position) => {
        transaction.updateTask(candidate.id, {
          queuePosition: position + 1,
          updatedAt: now,
        });
      });
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId: null,
        type: "progress",
        summary: "Ready task returned to inbox by developer.",
        completedWork: null,
        currentStep: task.currentStep,
        nextStep: task.nextStep,
        blocker: task.blocker,
        requiredAction: task.requiredAction,
        handoffNote: task.handoffNote,
        actorLabel: parsed.actorLabel ?? "developer",
        createdAt: now,
      });
    });
    return this.getTask({ projectId: project.id, taskId: parsed.taskId, view: "full" });
  }

  deleteTask(input: DeleteTaskInput): void {
    const parsed = deleteTaskInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "inbox" && task.status !== "ready") {
        throw new InvalidTaskStateError(task.id, "inbox or ready", task.status);
      }
      const dependentTaskIds = transaction
        .listDependenciesByProjectId(project.id)
        .filter((dependency) => dependency.dependsOnTaskId === task.id)
        .map((dependency) => dependency.taskId);
      if (dependentTaskIds.length > 0) {
        throw new TaskHasDependentsError(task.id, dependentTaskIds);
      }
      const readyTasks = task.status === "ready"
        ? transaction
            .listByProjectId(project.id)
            .filter((candidate) => candidate.status === "ready" && candidate.id !== task.id)
            .sort(compareQueuePosition)
        : [];
      transaction.deleteTask(task.id);
      const now = this.now().toISOString();
      readyTasks.forEach((candidate, position) => {
        transaction.updateTask(candidate.id, {
          queuePosition: position + 1,
          updatedAt: now,
        });
      });
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
    return this.getTask({ projectId: project.id, taskId: parsed.taskId, view: "full" });
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
      if (!task.riskConfirmed) {
        throw new TaskRiskNotConfirmedError(task.id);
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
        actorLabel: parsed.actorLabel ?? "agent",
        createdAt: now,
      });
    });
    return {
      runId,
      task: this.getTask({ projectId: project.id, taskId: parsed.taskId, view: "full" }),
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
      const actorLabel =
        parsed.actorLabel ??
        this.actorLabelForRun(transaction, task.id, parsed.runId);
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
        actorLabel,
        createdAt: now,
      });
    });
    return this.getTask({ projectId: project.id, taskId: parsed.taskId, view: "full" });
  }

  submitForReview(input: SubmitForReviewInput): TaskDetails {
    const parsed = submitForReviewInputSchema.parse(input);
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
      const actorLabel =
        parsed.actorLabel ??
        this.actorLabelForRun(transaction, task.id, parsed.runId);
      transaction.updateTask(task.id, {
        status: "in_review",
        queuePosition: null,
        activeRunId: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        completedAt: null,
        updatedAt: now,
      });
      const previousReviews = transaction.listReviewsByTaskId(task.id);
      const reviewRound =
        (previousReviews.at(-1)?.reviewRound ?? 0) + 1;
      transaction.insertReview({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        reviewRound,
        commitSha: parsed.commitSha,
        branch: parsed.branch ?? null,
        worktree: parsed.worktree ?? null,
        reviewRunId: null,
        status: "pending",
        reviewerActorLabel: null,
        summary: null,
        findings: [],
        verificationEvidence: [],
        integrationRequired: task.integrationRequired,
        integrationTargetBranch: task.integrationTargetBranch,
        integrationNotRequiredReason: task.integrationNotRequiredReason,
        approvedAt: null,
        approvedBy: null,
        integrationStatus: null,
        integrationMessage: null,
        integrationTargetCommitSha: null,
        integrationCheckedAt: null,
        createdAt: now,
        startedAt: null,
        concludedAt: null,
        updatedAt: now,
      });
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId: parsed.runId,
        type: "submitted_for_review",
        summary: parsed.summary,
        completedWork: parsed.completedWork,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: task.handoffNote,
        actorLabel,
        createdAt: now,
      });
    });
    return this.getTask({ projectId: project.id, taskId: parsed.taskId, view: "full" });
  }

  startReview(input: StartReviewInput): StartedReview {
    const parsed = startReviewInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    let reviewRunId = "";

    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "in_review") {
        throw new InvalidTaskStateError(task.id, "in_review", task.status);
      }
      if (task.activeReviewRunId) {
        throw new InvalidTaskStateError(task.id, "an unclaimed review", "claimed");
      }

      const review = transaction.listReviewsByTaskId(task.id).at(-1);
      if (!review || review.status !== "pending") {
        throw new InvalidTaskStateError(task.id, "a pending review", review?.status ?? "missing");
      }

      reviewRunId = this.generateId();
      const now = this.now().toISOString();
      const reviewerActorLabel = parsed.actorLabel ?? "agent";
      transaction.updateTask(task.id, {
        activeReviewRunId: reviewRunId,
        updatedAt: now,
      });
      transaction.updateReview(review.id, {
        status: "in_progress",
        reviewRunId,
        reviewerActorLabel,
        startedAt: now,
        updatedAt: now,
      });
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId: reviewRunId,
        type: "review_started",
        summary: `Started AI review for commit ${review.commitSha}.`,
        completedWork: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: task.handoffNote,
        actorLabel: reviewerActorLabel,
        createdAt: now,
      });
    });

    return {
      reviewRunId,
      task: this.getTask({ projectId: project.id, taskId: parsed.taskId, view: "full" }),
    };
  }

  completeReview(input: CompleteReviewInput): TaskDetails {
    const parsed = completeReviewInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    let reviewId = "";
    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "in_review") {
        throw new InvalidTaskStateError(task.id, "in_review", task.status);
      }
      if (task.activeReviewRunId !== parsed.reviewRunId) {
        throw new ReviewRunOwnershipError(task.id);
      }

      const review = transaction.listReviewsByTaskId(task.id).at(-1);
      if (
        !review ||
        review.status !== "in_progress" ||
        review.reviewRunId !== parsed.reviewRunId
      ) {
        throw new ReviewRunOwnershipError(task.id);
      }
      if (parsed.decision === "passed" && parsed.verificationEvidence.length === 0) {
        throw new ReviewEvidenceIncompleteError(task.id);
      }

      const now = this.now().toISOString();
      reviewId = review.id;
      const actorLabel =
        parsed.actorLabel ?? review.reviewerActorLabel ?? "agent";
      transaction.updateReview(review.id, {
        status: parsed.decision,
        reviewerActorLabel: actorLabel,
        summary: parsed.summary,
        findings: parsed.findings,
        verificationEvidence: parsed.verificationEvidence,
        concludedAt: now,
        updatedAt: now,
      });

      if (parsed.decision === "changes_requested") {
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
          activeRunId: null,
          activeReviewRunId: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: formatReviewFeedback(parsed.summary, parsed.findings),
          completedAt: null,
          updatedAt: now,
        });
        transaction.insertTaskEvent({
          id: this.generateId(),
          projectId: task.projectId,
          taskId: task.id,
          runId: parsed.reviewRunId,
          type: "changes_requested",
          summary: parsed.summary,
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: formatReviewFeedback(parsed.summary, parsed.findings),
          actorLabel,
          createdAt: now,
        });
        return;
      }

      transaction.updateTask(task.id, {
        activeReviewRunId: null,
        requiredAction:
          task.riskLevel === "low" && task.riskConfirmed
            ? "AI review passed. Checking local Git integration."
            : "AI review passed. Developer approval is required before completion.",
        updatedAt: now,
      });
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId: parsed.reviewRunId,
        type: "review_passed",
        summary: parsed.summary,
        completedWork: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: task.handoffNote,
        actorLabel,
        createdAt: now,
      });
    });
    if (parsed.decision === "passed") {
      return this.checkAndCompleteIntegration(
        project.id,
        parsed.taskId,
        reviewId,
        parsed.actorLabel ?? "agent",
        false,
      );
    }
    return this.getTask({ projectId: project.id, taskId: parsed.taskId, view: "full" });
  }

  approveTask(input: ApproveTaskInput): TaskDetails {
    const parsed = approveTaskInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    let reviewId = "";
    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "in_review") {
        throw new InvalidTaskStateError(task.id, "in_review", task.status);
      }
      const review = transaction.listReviewsByTaskId(task.id).at(-1);
      if (!review || review.status !== "passed") {
        throw new InvalidTaskStateError(
          task.id,
          "an AI review with a passed conclusion",
          review?.status ?? "missing",
        );
      }
      const now = this.now().toISOString();
      reviewId = review.id;
      const actorLabel = parsed.actorLabel ?? "developer";
      const firstApproval = review.approvedAt === null;
      transaction.updateReview(review.id, {
        approvedAt: review.approvedAt ?? now,
        approvedBy: review.approvedBy ?? actorLabel,
        updatedAt: now,
      });
      transaction.updateTask(task.id, {
        activeReviewRunId: null,
        requiredAction: "Developer approval recorded. Checking local Git integration.",
        updatedAt: now,
      });
      if (firstApproval) {
        transaction.insertTaskEvent({
          id: this.generateId(),
          projectId: task.projectId,
          taskId: task.id,
          runId: null,
          type: "approved",
          summary: "Task approved by developer.",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: task.handoffNote,
          actorLabel,
          createdAt: now,
        });
      }
    });
    return this.checkAndCompleteIntegration(
      project.id,
      parsed.taskId,
      reviewId,
      parsed.actorLabel ?? "developer",
      false,
    );
  }

  checkTaskIntegration(input: CheckTaskIntegrationInput): TaskDetails {
    const parsed = checkTaskIntegrationInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    return this.checkAndCompleteIntegration(
      project.id,
      parsed.taskId,
      parsed.expectedReviewId,
      parsed.actorLabel ?? "developer",
      true,
    );
  }

  private checkAndCompleteIntegration(
    projectId: string,
    taskId: string,
    expectedReviewId: string,
    actorLabel: string,
    requireAcceptedReview: boolean,
  ): TaskDetails {
    const snapshot = this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(taskId);
      if (!task || task.projectId !== projectId) {
        throw new TaskNotFoundError(taskId);
      }
      const review = transaction.listReviewsByTaskId(taskId).at(-1);
      if (!review || review.id !== expectedReviewId) {
        throw new IntegrationCheckStaleError(taskId);
      }
      if (task.status === "completed") {
        return { task, review, alreadyCompleted: true };
      }
      if (task.status !== "in_review") {
        throw new InvalidTaskStateError(taskId, "in_review", task.status);
      }
      if (review.status !== "passed" && review.status !== "waived") {
        throw new InvalidTaskStateError(
          taskId,
          "a passed or directly accepted latest review",
          review.status,
        );
      }
      if (requireAcceptedReview && !this.reviewAcceptanceSatisfied(task, review)) {
        throw new InvalidTaskStateError(
          taskId,
          "the latest review to satisfy the task risk approval policy",
          review.status === "passed" ? "developer approval required" : "not accepted",
        );
      }
      return { task, review, alreadyCompleted: false };
    });

    if (snapshot.alreadyCompleted) {
      return this.getTask({ projectId, taskId, view: "full" });
    }

    let result: CompletionIntegrationResult;
    let checkedAt = snapshot.review.integrationCheckedAt;
    if (!snapshot.review.integrationRequired) {
      result = {
        status: "not_required",
        message: snapshot.review.integrationNotRequiredReason ??
          "Developer recorded that local Git integration is not required.",
      };
      checkedAt = this.now().toISOString();
    } else if (
      !requireAcceptedReview &&
      snapshot.review.integrationStatus === "integrated" &&
      snapshot.review.integrationTargetCommitSha
    ) {
      result = {
        status: "integrated",
        targetCommitSha: snapshot.review.integrationTargetCommitSha,
      };
    } else {
      checkedAt = this.now().toISOString();
      try {
        result = this.integrationChecker
          ? this.integrationChecker.check({
              commitSha: snapshot.review.commitSha,
              targetBranch: snapshot.review.integrationTargetBranch,
            })
          : {
              status: "unavailable",
              message: "本地 Git 集成检查器未装配，无法验证审核提交。",
            };
      } catch (error) {
        result = {
          status: "unavailable",
          message: `本地 Git 集成检查失败：${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(taskId);
      const latestReview = transaction.listReviewsByTaskId(taskId).at(-1);
      if (!task || task.projectId !== projectId || !latestReview) {
        throw new IntegrationCheckStaleError(taskId);
      }
      if (
        task.status === "completed" &&
        latestReview.id === expectedReviewId &&
        (latestReview.integrationStatus === "integrated" ||
          latestReview.integrationStatus === "not_required")
      ) {
        return;
      }
      if (
        task.status !== "in_review" ||
        latestReview.id !== expectedReviewId ||
        latestReview.commitSha !== snapshot.review.commitSha ||
        latestReview.integrationRequired !== snapshot.review.integrationRequired ||
        latestReview.integrationTargetBranch !== snapshot.review.integrationTargetBranch ||
        latestReview.integrationNotRequiredReason !== snapshot.review.integrationNotRequiredReason ||
        latestReview.status !== snapshot.review.status ||
        task.riskLevel !== snapshot.task.riskLevel ||
        task.riskConfirmed !== snapshot.task.riskConfirmed
      ) {
        throw new IntegrationCheckStaleError(taskId);
      }

      const now = checkedAt ?? this.now().toISOString();
      const acceptanceSatisfied = this.reviewAcceptanceSatisfied(task, latestReview);
      const complete = acceptanceSatisfied &&
        (result.status === "integrated" || result.status === "not_required");
      transaction.updateReview(latestReview.id, {
        integrationStatus: result.status,
        integrationMessage: result.status === "integrated" ? null : result.message,
        integrationTargetCommitSha:
          result.status === "integrated"
            ? result.targetCommitSha
            : ("targetCommitSha" in result ? result.targetCommitSha ?? null : null),
        integrationCheckedAt: now,
        updatedAt: now,
      });
      transaction.updateTask(taskId, {
        ...(complete
          ? {
              status: "completed" as const,
              queuePosition: null,
              activeRunId: null,
              activeReviewRunId: null,
              currentStep: null,
              nextStep: null,
              blocker: null,
              requiredAction: null,
              completedAt: now,
            }
          : {
              activeReviewRunId: null,
              requiredAction: acceptanceSatisfied
                ? result.status === "not_integrated" || result.status === "unavailable"
                  ? `${result.message} After an authorized local merge or Git repair, retry the integration check.`
                  : "Developer approval is required before completion."
                : result.status === "integrated" || result.status === "not_required"
                  ? "Local integration requirements are satisfied. Developer approval is still required."
                  : "AI review passed. Developer approval is required before completion.",
            }),
        updatedAt: now,
      });
      if (complete) {
        transaction.insertTaskEvent({
          id: this.generateId(),
          projectId,
          taskId,
          runId: null,
          type: "completed",
          summary:
            result.status === "not_required"
              ? "Task completed after developer-confirmed no-integration policy and required review approval."
              : `Task completed after local '${latestReview.integrationTargetBranch}' was verified to contain review commit ${latestReview.commitSha}.`,
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: task.handoffNote,
          actorLabel,
          createdAt: now,
        });
      }
    });

    return this.getTask({ projectId, taskId, view: "full" });
  }

  private reviewAcceptanceSatisfied(task: TaskRecord, review: ReviewRecord): boolean {
    if (!task.riskConfirmed) {
      return false;
    }
    if (review.status === "waived") {
      return review.approvedAt !== null && review.approvedBy !== null;
    }
    if (review.status !== "passed" || review.verificationEvidence.length === 0) {
      return false;
    }
    return task.riskLevel === "low" && task.riskConfirmed
      ? true
      : review.approvedAt !== null && review.approvedBy !== null;
  }

  /**
   * Developer-only completion path: accept a submitted review that has no AI
   * conclusion. The review round is recorded as `waived` instead of `passed`,
   * and any in-flight review run loses ownership so its conclusion is rejected.
   */
  waiveTaskApproval(input: WaiveTaskApprovalInput): TaskDetails {
    const parsed = waiveTaskApprovalInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    let reviewId = "";
    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "in_review") {
        throw new InvalidTaskStateError(task.id, "in_review", task.status);
      }
      const review = transaction.listReviewsByTaskId(task.id).at(-1);
      if (!review) {
        throw new InvalidTaskStateError(task.id, "a submitted review record", "missing");
      }
      if (review.status !== "pending" && review.status !== "in_progress") {
        throw new InvalidTaskStateError(
          task.id,
          "a pending or in-progress review",
          review.status,
        );
      }
      const now = this.now().toISOString();
      reviewId = review.id;
      transaction.updateReview(review.id, {
        status: "waived",
        reviewerActorLabel: parsed.actorLabel ?? "developer",
        summary: `Developer directly accepted this task: ${parsed.reason}`,
        approvedAt: now,
        approvedBy: parsed.actorLabel ?? "developer",
        concludedAt: now,
        updatedAt: now,
      });
      transaction.updateTask(task.id, {
        activeReviewRunId: null,
        requiredAction: "Developer direct acceptance recorded. Checking local Git integration.",
        updatedAt: now,
      });
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId: null,
        type: "approved",
        summary: `Task approved by developer without an AI review conclusion: ${parsed.reason}`,
        completedWork: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: task.handoffNote,
        actorLabel: parsed.actorLabel ?? "developer",
        createdAt: now,
      });
    });
    return this.checkAndCompleteIntegration(
      project.id,
      parsed.taskId,
      reviewId,
      parsed.actorLabel ?? "developer",
      false,
    );
  }

  requestTaskChanges(input: RequestTaskChangesInput): TaskDetails {
    const parsed = requestTaskChangesInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "in_review") {
        throw new InvalidTaskStateError(task.id, "in_review", task.status);
      }
      if (
        parsed.reviewRunId &&
        task.activeReviewRunId !== parsed.reviewRunId
      ) {
        throw new ReviewRunOwnershipError(task.id);
      }
      const now = this.now().toISOString();
      const review = transaction.listReviewsByTaskId(task.id).at(-1);
      const feedback = formatReviewFeedback(parsed.feedback, parsed.findings);
      if (review) {
        transaction.updateReview(review.id, {
          status: "changes_requested",
          reviewerActorLabel:
            parsed.actorLabel ?? review.reviewerActorLabel ?? "developer",
          summary: feedback,
          findings: parsed.findings,
          concludedAt: now,
          updatedAt: now,
        });
      }
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
        activeRunId: null,
        activeReviewRunId: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: feedback,
        completedAt: null,
        updatedAt: now,
      });
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId: parsed.reviewRunId ?? task.activeReviewRunId,
        type: "changes_requested",
        summary: feedback,
        completedWork: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: feedback,
        actorLabel: parsed.actorLabel ?? "developer",
        createdAt: now,
      });
    });
    return this.getTask({ projectId: project.id, taskId: parsed.taskId, view: "full" });
  }

  reopenTask(input: ReopenTaskInput): TaskDetails {
    const parsed = reopenTaskInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    this.repository.transaction((transaction) => {
      const task = transaction.findTaskById(parsed.taskId);
      if (!task || task.projectId !== project.id) {
        throw new TaskNotFoundError(parsed.taskId);
      }
      if (task.status !== "completed") {
        throw new InvalidTaskStateError(task.id, "completed", task.status);
      }
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
        activeRunId: null,
        activeReviewRunId: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: parsed.reason,
        completedAt: null,
        updatedAt: now,
      });
      transaction.insertTaskEvent({
        id: this.generateId(),
        projectId: task.projectId,
        taskId: task.id,
        runId: null,
        type: "reopened",
        summary: parsed.reason,
        completedWork: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: parsed.reason,
        actorLabel: parsed.actorLabel ?? "developer",
        createdAt: now,
      });
    });
    return this.getTask({ projectId: project.id, taskId: parsed.taskId, view: "full" });
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
      const actorLabel =
        parsed.actorLabel ??
        this.actorLabelForRun(transaction, task.id, parsed.runId);
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
        actorLabel,
        createdAt: now,
      });
    });
    return this.getTask({ projectId: project.id, taskId: parsed.taskId, view: "full" });
  }

  private requireRunOwner(task: TaskRecord, runId: string): void {
    if (!task.activeRunId || task.activeRunId !== runId) {
      throw new TaskRunOwnershipError(task.id);
    }
  }

  private actorLabelForRun(
    transaction: TaskRepositoryTransaction,
    taskId: string,
    runId: string,
  ): string {
    const events = transaction.listEventsByTaskId(taskId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type === "started" && event.runId === runId) {
        return event.actorLabel ?? "agent";
      }
    }
    return "agent";
  }

  getProjectStatus(input: GetProjectStatusInput & { view: "compact" }): CompactProjectStatus;
  getProjectStatus(input: { projectId: string; view?: "full" }): ProjectStatus;
  getProjectStatus(input: GetProjectStatusInput): ProjectStatusResult;
  getProjectStatus(input: GetProjectStatusInput): ProjectStatusResult {
    const parsed = getProjectStatusInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    return this.buildProjectStatus(
      project,
      parsed.view,
      this.repository.findLatestUpdatedAtByProjectId(project.id),
    );
  }

  getProjectStatusIfChanged(
    input: GetProjectStatusInput,
  ): ProjectStatusResult | null {
    const parsed = getProjectStatusInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    const latestUpdatedAt = this.repository.findLatestUpdatedAtByProjectId(project.id);
    if (parsed.since !== undefined && parsed.since === latestUpdatedAt) {
      return null;
    }
    return this.buildProjectStatus(project, parsed.view, latestUpdatedAt);
  }

  private buildProjectStatus(
    project: ProjectRecord,
    view: GetProjectStatusInput["view"],
    latestUpdatedAt: string | null,
  ): ProjectStatusResult {
    const tasks = this.repository.listByProjectId(project.id);
    const dependencies = this.repository.listDependenciesByProjectId(project.id);
    const latestReviews = latestReviewsByTaskId(
      this.repository.listReviewsByProjectId(project.id),
    );
    const summaries = tasks.map((task) =>
      taskToSummaryWithDependencies(task, tasks, dependencies, latestReviews),
    );
    const currentTasks = tasks
      .filter((task) => task.status === "running")
      .sort(compareCreatedAt);
    const nextTasks = tasks
      .filter((task) => task.status === "ready")
      .sort(compareQueuePosition);
    const blockedTasks = tasks
      .filter((task) => task.status === "blocked")
      .sort(compareCreatedAt);
    const inReviewTasks = tasks
      .filter((task) => task.status === "in_review")
      .sort(compareCreatedAt);
    const inboxTasks = tasks
      .filter((task) => task.status === "inbox")
      .sort(compareCreatedAt);
    const completedTasks = tasks
      .filter((task) => task.status === "completed")
      .sort(compareCompletedAt);

    const current = currentTasks.map((task) => summaryForTask(summaries, task.id));
    const next = nextTasks.map((task) => summaryForTask(summaries, task.id));
    const blocked = blockedTasks.map((task) => summaryForTask(summaries, task.id));
    const inReview = inReviewTasks.map((task) => summaryForTask(summaries, task.id));
    const inbox = inboxTasks.map((task) => summaryForTask(summaries, task.id));
    const completedSummaries = completedTasks.map((task) =>
      summaryForTask(summaries, task.id),
    );
    const recentlyCompleted = completedSummaries
      .slice(0, this.recentlyCompletedLimit);
    const counts = {
      inbox: inboxTasks.length,
      ready: nextTasks.length,
      running: currentTasks.length,
      blocked: blockedTasks.length,
      inReview: inReviewTasks.length,
      completed: completedTasks.length,
      total: tasks.length,
    };

    if (view === "compact") {
      const compact = {
        view: "compact" as const,
        project: projectToSummary(project),
        latestUpdatedAt,
        counts,
        current: current.slice(0, compactProjectStatusLimits.current),
        next: next.slice(0, compactProjectStatusLimits.next),
        nextRunnable:
          next.find((task) => task.runnable) ?? null,
        blocked: blocked.slice(0, compactProjectStatusLimits.blocked),
        inReview: inReview.slice(0, compactProjectStatusLimits.inReview),
        inbox: inbox.slice(0, compactProjectStatusLimits.inbox),
        recentlyCompleted: completedSummaries.slice(
          0,
          compactProjectStatusLimits.recentlyCompleted,
        ),
        truncated: {
          current: current.length > compactProjectStatusLimits.current,
          next: next.length > compactProjectStatusLimits.next,
          blocked: blocked.length > compactProjectStatusLimits.blocked,
          inReview: inReview.length > compactProjectStatusLimits.inReview,
          inbox: inbox.length > compactProjectStatusLimits.inbox,
          recentlyCompleted:
            completedTasks.length > compactProjectStatusLimits.recentlyCompleted,
        },
      };
      return compactProjectStatusSchema.parse(compact);
    }

    return projectStatusSchema.parse({
      project: projectToSummary(project),
      latestUpdatedAt,
      counts,
      current,
      next,
      blocked,
      inReview,
      inbox,
      recentlyCompleted,
    });
  }

  listTasks(input: ListTasksInput): TaskPage {
    const parsed = listTasksInputSchema.parse(input);
    const project = this.requireProject(parsed.projectId);
    const allTasks = this.repository.listByProjectId(project.id);
    const tasks = allTasks
      .filter((task) => task.status === parsed.status)
      .sort((left, right) => compareTasksByStatus(left, right, parsed.status));
    const dependencies = this.repository.listDependenciesByProjectId(project.id);
    const latestReviews = latestReviewsByTaskId(
      this.repository.listReviewsByProjectId(project.id),
    );
    const allSummaries = allTasks.map((task) =>
      taskToSummaryWithDependencies(task, allTasks, dependencies, latestReviews),
    );

    let startIndex = 0;
    if (parsed.cursor) {
      const cursor = decodeTaskCursor(parsed.cursor, parsed.status);
      const cursorIndex = tasks.findIndex(
        (task) => compareTaskCursors(taskCursorForTask(task), cursor) > 0,
      );
      startIndex = cursorIndex === -1 ? tasks.length : cursorIndex;
    }

    const pageTasks = tasks.slice(startIndex, startIndex + parsed.limit);
    const hasMore = startIndex + pageTasks.length < tasks.length;
    const lastTask = pageTasks.at(-1);
    return taskPageSchema.parse({
      status: parsed.status,
      tasks: pageTasks.map((task) => summaryForTask(allSummaries, task.id)),
      nextCursor: hasMore && lastTask ? encodeTaskCursor(taskCursorForTask(lastTask)) : null,
      hasMore,
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
    const riskConfirmed = status === "ready" && input.createdBy === "developer";

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
      riskLevel: input.riskLevel ?? "medium",
      riskConfirmed,
      riskConfirmedBy: riskConfirmed ? input.actorLabel ?? "developer" : null,
      riskConfirmedAt: riskConfirmed ? timestamp : null,
      integrationRequired: true,
      integrationTargetBranch: "main",
      integrationNotRequiredReason: null,
      sourceTaskId: input.sourceTaskId ?? null,
      createdBy: input.createdBy,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private createdEventFor(task: TaskRecord, actorLabel?: string): TaskEventRecord {
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
      actorLabel: actorLabel ?? task.createdBy,
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

function formatReviewFeedback(
  summary: string | undefined,
  findings: ReviewFinding[],
): string {
  const findingText = findings
    .map((finding) => `${finding.issue} 建议：${finding.suggestion}`)
    .join("；");
  return [summary, findingText].filter(Boolean).join("；");
}

function compareCreatedAt(left: TaskRecord, right: TaskRecord): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareTasksByStatus(
  left: TaskRecord,
  right: TaskRecord,
  status: TaskRecord["status"],
): number {
  if (status === "ready") {
    return compareQueuePosition(left, right);
  }
  if (status === "completed") {
    return compareCompletedAt(left, right);
  }
  return compareCreatedAt(left, right);
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

function taskCursorForTask(task: TaskRecord): TaskCursor {
  if (task.status === "ready") {
    return {
      status: task.status,
      id: task.id,
      queuePosition: task.queuePosition,
      createdAt: task.createdAt,
    };
  }
  if (task.status === "completed") {
    return {
      status: task.status,
      id: task.id,
      completedAt: task.completedAt,
      updatedAt: task.updatedAt,
    };
  }
  return {
    status: task.status,
    id: task.id,
    createdAt: task.createdAt,
  };
}

function compareTaskCursors(left: TaskCursor, right: TaskCursor): number {
  if (left.status !== right.status) {
    return left.status.localeCompare(right.status);
  }
  if (left.status === "ready" && right.status === "ready") {
    const leftPosition = left.queuePosition ?? Number.POSITIVE_INFINITY;
    const rightPosition = right.queuePosition ?? Number.POSITIVE_INFINITY;
    return (
      leftPosition - rightPosition ||
      (left.createdAt ?? "").localeCompare(right.createdAt ?? "") ||
      left.id.localeCompare(right.id)
    );
  }
  if (left.status === "completed" && right.status === "completed") {
    return (
      (right.completedAt ?? "").localeCompare(left.completedAt ?? "") ||
      (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
      right.id.localeCompare(left.id)
    );
  }
  return (
    (left.createdAt ?? "").localeCompare(right.createdAt ?? "") ||
    left.id.localeCompare(right.id)
  );
}

function encodeTaskCursor(cursor: TaskCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeTaskCursor(encoded: string, status: TaskRecord["status"]): TaskCursor {
  try {
    const candidate: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    const parsed = taskCursorSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.status !== status) {
      throw new Error("Cursor does not match the requested task status.");
    }
    if (status === "ready" &&
      (parsed.data.queuePosition === undefined || parsed.data.createdAt === undefined)) {
      throw new Error("Ready cursor is incomplete.");
    }
    if (status === "completed" &&
      (parsed.data.completedAt === undefined || parsed.data.updatedAt === undefined)) {
      throw new Error("Completed cursor is incomplete.");
    }
    if (status !== "ready" && status !== "completed" && parsed.data.createdAt === undefined) {
      throw new Error("Task cursor is incomplete.");
    }
    return parsed.data;
  } catch {
    throw new InvalidTaskError(`Invalid cursor for '${status}' tasks.`);
  }
}
