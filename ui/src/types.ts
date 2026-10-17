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

export interface RuntimeHealth {
  status: string;
  timestamp: string;
  version: string | null;
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
  objective?: string | null;
  acceptanceCriteria?: string[] | null;
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
  integrationRequired: boolean;
  integrationTargetBranch: string;
  integrationNotRequiredReason: string | null;
  latestReview?: ReviewDigest | null;
}

export type RiskLevel = "low" | "medium" | "high";
export type IntegrationStatus = "integrated" | "not_integrated" | "unavailable" | "not_required";
export type CriterionResultStatus = "met" | "not_met" | "unverifiable";
export type FindingClosureStatus =
  | "fixed"
  | "partially_fixed"
  | "not_fixed"
  | "unverifiable"
  | "invalidated";

export interface TaskStatusCounts {
  inbox: number;
  ready: number;
  running: number;
  blocked: number;
  inReview: number;
  completed: number;
  total: number;
}

export interface ReviewFinding {
  issue: string;
  suggestion: string;
  severity: RiskLevel;
  /** Structured review fields; absent on records written before they existed. */
  trigger?: string;
  impact?: string;
  evidence?: string;
  location?: string;
}

export interface VerificationEvidence {
  command: string;
  result: string;
}

export interface CriterionResult {
  criterion: string;
  status: CriterionResultStatus;
  evidence: VerificationEvidence[];
}

export interface FindingClosure {
  findingIndex: number;
  status: FindingClosureStatus;
  evidence?: VerificationEvidence[];
}

/** A closure recorded when returning a task for rework; evidence is optional. */
export interface FindingClosureInput {
  findingIndex: number;
  status: FindingClosureStatus;
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
  status: "pending" | "in_progress" | "passed" | "changes_requested" | "waived";
  reviewerActorLabel: string | null;
  summary: string | null;
  findings: ReviewFinding[];
  /** Closures recorded by this round for the previous changes-requested round. */
  findingClosures?: FindingClosure[];
  verificationEvidence: VerificationEvidence[];
  integrationRequired: boolean;
  integrationTargetBranch: string;
  integrationNotRequiredReason: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  integrationStatus: IntegrationStatus | null;
  integrationMessage: string | null;
  integrationTargetCommitSha: string | null;
  integrationCheckedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  concludedAt: string | null;
  updatedAt: string;
}

/** Compact review facts carried by project status for collapsed queue cards. */
export interface ReviewDigest {
  id: string;
  status: "pending" | "in_progress" | "passed" | "changes_requested" | "waived";
  reviewRound: number;
  commitSha: string;
  reviewerActorLabel: string | null;
  branch: string | null;
  worktree: string | null;
  summary: string | null;
  createdAt: string;
  acceptanceCriteriaCount: number;
  verificationEvidenceCount: number;
  findingsCount: number;
  integrationRequired: boolean;
  integrationTargetBranch: string;
  integrationNotRequiredReason: string | null;
  approvedAt: string | null;
  integrationStatus: IntegrationStatus | null;
  integrationMessage: string | null;
  integrationTargetCommitSha: string | null;
  integrationCheckedAt: string | null;
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
  integrationRequired: boolean;
  integrationTargetBranch: string;
  integrationNotRequiredReason: string | null;
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
  /** Per-criterion delivery results; absent on records written before they existed. */
  criteriaResults?: CriterionResult[] | null;
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
  latestUpdatedAt?: string | null;
  counts: TaskStatusCounts;
  current: TaskSummary[];
  next: TaskSummary[];
  blocked: TaskSummary[];
  inReview: TaskSummary[];
  inbox: TaskSummary[];
  recentlyCompleted: TaskSummary[];
}

export interface TaskPage {
  status: TaskStatus;
  tasks: TaskSummary[];
  nextCursor: string | null;
  hasMore: boolean;
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
