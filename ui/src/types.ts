export type TaskStatus =
  | "inbox"
  | "ready"
  | "running"
  | "blocked"
  | "in_review"
  | "completed";

export type TaskEventType =
  | "created"
  | "started"
  | "progress"
  | "blocked"
  | "resumed"
  | "released"
  | "submitted_for_review"
  | "review_started"
  | "review_passed"
  | "approved"
  | "changes_requested"
  | "reopened"
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
  riskLevel?: RiskLevel;
  riskConfirmed?: boolean;
}

export type RiskLevel = "low" | "medium" | "high";

export interface ReviewFinding {
  issue: string;
  suggestion: string;
  severity: RiskLevel;
}

export interface VerificationEvidence {
  command: string;
  result: string;
}

export interface TaskReview {
  id: string;
  projectId: string;
  taskId: string;
  reviewRound: number;
  commitSha: string;
  branch: string | null;
  worktree: string | null;
  reviewRunId: string | null;
  status: "pending" | "in_progress" | "passed" | "changes_requested";
  reviewerActorLabel: string | null;
  summary: string | null;
  findings: ReviewFinding[];
  verificationEvidence: VerificationEvidence[];
  createdAt: string;
  startedAt: string | null;
  concludedAt: string | null;
  updatedAt: string;
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
  activeReviewRunId?: string | null;
  riskLevel?: RiskLevel;
  riskConfirmed?: boolean;
  riskConfirmedBy?: string | null;
  riskConfirmedAt?: string | null;
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
  inReview: TaskSummary[];
  inbox: TaskSummary[];
  recentlyCompleted: TaskSummary[];
}

export interface TaskDetails {
  task: TaskModel;
  events: TaskEvent[];
  reviews?: TaskReview[];
}

export interface CreateTaskPayload {
  title: string;
  objective?: string;
  acceptanceCriteria?: string[];
  dependencyIds?: string[];
  status?: "inbox" | "ready";
  riskLevel?: RiskLevel;
}

export interface EditInboxTaskPayload {
  title: string;
  objective?: string | null;
  acceptanceCriteria?: string[];
  dependencyIds?: string[];
  riskLevel?: RiskLevel;
}
