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

export interface ProjectRepository {
  findById(id: string): ProjectRecord | null;
  findByRootPath(rootPath: string): ProjectRecord | null;
  insert(project: ProjectRecord): ProjectRecord;
}

export interface TaskRepository {
  findById(id: string): TaskRecord | null;
  insert(task: TaskRecord): TaskRecord;
  update(task: TaskRecord): TaskRecord;
}

export interface TaskEventRepository {
  listByTaskId(taskId: string): TaskEventRecord[];
  insert(event: TaskEventRecord): TaskEventRecord;
}
