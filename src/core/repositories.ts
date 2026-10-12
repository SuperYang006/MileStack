import type { TaskEventType, TaskStatus } from "./task-model.js";
import type {
  ReviewFinding,
  ReviewStatus,
  RiskLevel,
  VerificationEvidence,
} from "./review-model.js";

export type { TaskEventType, TaskStatus } from "./task-model.js";

export type ProjectRecord = {
  id: string;
  name: string;
  rootPath: string | null;
  goal: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskRecord = {
  id: string;
  projectId: string;
  title: string;
  objective: string | null;
  acceptanceCriteria: string[] | null;
  status: TaskStatus;
  queuePosition: number | null;
  currentStep: string | null;
  nextStep: string | null;
  blocker: string | null;
  requiredAction: string | null;
  handoffNote: string | null;
  sourceTaskId: string | null;
  activeRunId: string | null;
  activeReviewRunId: string | null;
  riskLevel: RiskLevel;
  riskConfirmed: boolean;
  riskConfirmedBy: string | null;
  riskConfirmedAt: string | null;
  createdBy: "developer" | "agent";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ReviewRecord = {
  id: string;
  projectId: string;
  taskId: string;
  reviewRound: number;
  commitSha: string;
  branch: string | null;
  worktree: string | null;
  reviewRunId: string | null;
  status: ReviewStatus;
  reviewerActorLabel: string | null;
  summary: string | null;
  findings: ReviewFinding[];
  verificationEvidence: VerificationEvidence[];
  createdAt: string;
  startedAt: string | null;
  concludedAt: string | null;
  updatedAt: string;
};

export type TaskEventRecord = {
  id: string;
  projectId: string;
  taskId: string;
  runId: string | null;
  type: TaskEventType;
  summary: string;
  completedWork: string[] | null;
  currentStep: string | null;
  nextStep: string | null;
  blocker: string | null;
  requiredAction: string | null;
  handoffNote: string | null;
  actorLabel: string | null;
  createdAt: string;
};

export type TaskDependencyRecord = {
  taskId: string;
  dependsOnTaskId: string;
};

export interface ProjectRepository {
  findProjectById(id: string): ProjectRecord | null;
  findByRootPath(rootPath: string): ProjectRecord | null;
  /** Return the single project in the database, or null if empty or ambiguous. */
  findSingleProject(): ProjectRecord | null;
  insert(project: ProjectRecord): ProjectRecord;
}

export interface TaskRepository {
  findTaskById(id: string): TaskRecord | null;
  listByProjectId(projectId: string): TaskRecord[];
}

export interface TaskDependencyRepository {
  listDependenciesByProjectId(projectId: string): TaskDependencyRecord[];
  listDependenciesByTaskId(taskId: string): TaskDependencyRecord[];
}

export interface TaskEventRepository {
  listByTaskId(taskId: string): TaskEventRecord[];
}

export interface TaskReviewRepository {
  listReviewsByTaskId(taskId: string): ReviewRecord[];
}

export interface TaskRepositoryTransaction {
  findTaskById(id: string): TaskRecord | null;
  listByProjectId(projectId: string): TaskRecord[];
  listEventsByTaskId(taskId: string): TaskEventRecord[];
  listDependenciesByProjectId(projectId: string): TaskDependencyRecord[];
  listReviewsByTaskId(taskId: string): ReviewRecord[];
  updateTask(
    id: string,
    changes: Partial<TaskRecord>,
    expectedStatus?: TaskStatus,
  ): TaskRecord | null;
  deleteTask(id: string): void;
  insertTask(task: TaskRecord): TaskRecord;
  insertTaskEvent(event: TaskEventRecord): TaskEventRecord;
  insertReview(review: ReviewRecord): ReviewRecord;
  updateReview(id: string, changes: Partial<ReviewRecord>): ReviewRecord | null;
  replaceTaskDependencies(taskId: string, dependencyIds: string[]): void;
}

export interface MileStackRepository
  extends ProjectRepository,
    TaskRepository,
    TaskEventRepository,
    TaskDependencyRepository,
    TaskReviewRepository {
  transaction<T>(work: (transaction: TaskRepositoryTransaction) => T): T;
}
