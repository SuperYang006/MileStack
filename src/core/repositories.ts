import type { TaskEventType, TaskStatus } from "./task-model.js";

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
  createdBy: "developer" | "agent";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
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

export interface TaskRepositoryTransaction {
  findTaskById(id: string): TaskRecord | null;
  listByProjectId(projectId: string): TaskRecord[];
  listDependenciesByProjectId(projectId: string): TaskDependencyRecord[];
  updateTask(
    id: string,
    changes: Partial<TaskRecord>,
    expectedStatus?: TaskStatus,
  ): TaskRecord | null;
  deleteTask(id: string): void;
  insertTask(task: TaskRecord): TaskRecord;
  insertTaskEvent(event: TaskEventRecord): TaskEventRecord;
  replaceTaskDependencies(taskId: string, dependencyIds: string[]): void;
}

export interface MileStackRepository
  extends ProjectRepository,
    TaskRepository,
    TaskEventRepository,
    TaskDependencyRepository {
  transaction<T>(work: (transaction: TaskRepositoryTransaction) => T): T;
}
