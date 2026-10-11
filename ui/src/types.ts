export type TaskStatus =
  | "inbox"
  | "ready"
  | "running"
  | "blocked"
  | "completed";

export type TaskEventType =
  | "created"
  | "started"
  | "progress"
  | "blocked"
  | "resumed"
  | "released"
  | "completed";

export interface ProjectSummary {
  id: string;
  name: string;
  goal: string | null;
}

export interface WaitingForTask {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface TaskSummary {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  queuePosition: number | null;
  dependencyIds: string[];
  waitingFor: WaitingForTask[];
  runnable: boolean;
  currentStep: string | null;
  nextStep: string | null;
  blocker: string | null;
  requiredAction: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskModel {
  id: string;
  projectId: string;
  title: string;
  objective: string | null;
  acceptanceCriteria: string[] | null;
  status: TaskStatus;
  queuePosition: number | null;
  dependencyIds: string[];
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
}

export interface TaskEvent {
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
}

export interface ProjectStatus {
  project: ProjectSummary;
  current: TaskSummary[];
  next: TaskSummary[];
  blocked: TaskSummary[];
  inbox: TaskSummary[];
  recentlyCompleted: TaskSummary[];
}

export interface TaskDetails {
  task: TaskModel;
  events: TaskEvent[];
}

export interface CreateTaskPayload {
  title: string;
  objective?: string;
  acceptanceCriteria?: string[];
  dependencyIds?: string[];
  status?: "inbox" | "ready";
}

export interface EditInboxTaskPayload {
  title: string;
  objective?: string | null;
  acceptanceCriteria?: string[];
  dependencyIds?: string[];
}
