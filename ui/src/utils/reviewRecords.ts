import type {
  BatchIntegrationCheckItemInput,
  BatchIntegrationCheckResult,
  CriterionResultStatus,
  FindingClosureStatus,
  ReviewFinding,
  RiskLevel,
  TaskEvent,
  TaskReview,
  TaskSummary,
  VerificationEvidence,
} from "../types.js";

export type DisplayTone = "positive" | "negative" | "warning" | "neutral";

export interface CriterionResultDisplay {
  key: string;
  criterion: string;
  status: CriterionResultStatus;
  statusLabel: string;
  tone: DisplayTone;
  evidence: VerificationEvidence[];
}

export interface FindingDisplay {
  key: string;
  issue: string;
  suggestion: string;
  severity: RiskLevel;
  trigger?: string | undefined;
  impact?: string | undefined;
  evidence?: string | undefined;
  location?: string | undefined;
}

export interface FindingClosureDisplay {
  key: string;
  findingIndex: number;
  issue: string | null;
  status: FindingClosureStatus;
  statusLabel: string;
  tone: DisplayTone;
  evidence: VerificationEvidence[];
}

const criterionStatusLabels: Record<CriterionResultStatus, string> = {
  met: "满足",
  not_met: "不满足",
  unverifiable: "无法验证",
};

const criterionStatusTones: Record<CriterionResultStatus, DisplayTone> = {
  met: "positive",
  not_met: "negative",
  unverifiable: "warning",
};

const closureStatusLabels: Record<FindingClosureStatus, string> = {
  fixed: "已修复",
  partially_fixed: "部分修复",
  not_fixed: "未修复",
  unverifiable: "无法验证",
  invalidated: "原发现不成立",
};

const closureStatusTones: Record<FindingClosureStatus, DisplayTone> = {
  fixed: "positive",
  partially_fixed: "warning",
  not_fixed: "negative",
  unverifiable: "warning",
  invalidated: "neutral",
};

export function criterionResultStatusLabel(status: CriterionResultStatus): string {
  return criterionStatusLabels[status];
}

export function criterionResultStatusTone(status: CriterionResultStatus): DisplayTone {
  return criterionStatusTones[status];
}

export function findingClosureStatusLabel(status: FindingClosureStatus): string {
  return closureStatusLabels[status];
}

export function findingClosureStatusTone(status: FindingClosureStatus): DisplayTone {
  return closureStatusTones[status];
}

/**
 * Per-criterion delivery results carried by a submission event. Legacy events
 * without structured results return an empty list; their completedWork strings
 * keep rendering as before.
 */
export function buildCriterionResultDisplays(
  event: TaskEvent,
): CriterionResultDisplay[] {
  return (event.criteriaResults ?? []).map((result, index) => ({
    key: `${event.id}-criterion-${index}`,
    criterion: result.criterion,
    status: result.status,
    statusLabel: criterionResultStatusLabel(result.status),
    tone: criterionResultStatusTone(result.status),
    evidence: result.evidence ?? [],
  }));
}

/**
 * Findings as displayed in the review card. Structured fields are only
 * included when present so legacy findings keep their original display.
 */
export function buildFindingDisplays(review: TaskReview): FindingDisplay[] {
  return review.findings.map((finding, index) => ({
    key: `${review.id}-finding-${index}`,
    issue: finding.issue,
    suggestion: finding.suggestion,
    severity: finding.severity,
    ...(finding.trigger ? { trigger: finding.trigger } : {}),
    ...(finding.impact ? { impact: finding.impact } : {}),
    ...(finding.evidence ? { evidence: finding.evidence } : {}),
    ...(finding.location ? { location: finding.location } : {}),
  }));
}

/**
 * Closures recorded by this review round for the previous changes-requested
 * round, resolved back to the previous finding text when it is available.
 */
export function buildFindingClosureDisplays(
  reviews: TaskReview[],
  review: TaskReview,
): FindingClosureDisplay[] {
  const closures = review.findingClosures ?? [];
  const previousReview = reviews.find(
    (candidate) => candidate.reviewRound === review.reviewRound - 1,
  );
  return closures.map((closure, index) => ({
    key: `${review.id}-closure-${index}`,
    findingIndex: closure.findingIndex,
    issue:
      previousReview?.findings?.[closure.findingIndex]?.issue ?? null,
    status: closure.status,
    statusLabel: findingClosureStatusLabel(closure.status),
    tone: findingClosureStatusTone(closure.status),
    evidence: closure.evidence ?? [],
  }));
}

/**
 * The findings a return for changes must close: only the immediately previous
 * round qualifies, and only when it requested changes.
 */
export function findingsAwaitingClosure(
  reviews: TaskReview[] | undefined,
): ReviewFinding[] {
  if (!reviews || reviews.length < 2) {
    return [];
  }
  const previous = reviews[reviews.length - 2];
  return previous?.status === "changes_requested" ? previous.findings : [];
}

/**
 * Whether an in-review task is already accepted, requires local Git
 * integration, and still needs a local integration check against its latest review.
 */
export function isTaskCheckableForIntegration(task: TaskSummary): boolean {
  const digest = task.latestReview;
  if (!digest || task.status !== "in_review") {
    return false;
  }
  const isAutoAccepted = task.riskLevel === "low" && task.riskConfirmed === true;
  const isAccepted =
    digest.status === "waived" ||
    (digest.status === "passed" && (isAutoAccepted || Boolean(digest.approvedAt)));
  return (
    isAccepted &&
    digest.integrationRequired &&
    digest.integrationStatus !== "integrated"
  );
}

/** Collects the exact `{ taskId, expectedReviewId }` targets shown in the UI queue. */
export function selectIntegrationCheckTargets(
  tasks: readonly TaskSummary[],
): BatchIntegrationCheckItemInput[] {
  return tasks.flatMap((task) =>
    isTaskCheckableForIntegration(task) && task.latestReview
      ? [{ taskId: task.id, expectedReviewId: task.latestReview.id }]
      : [],
  );
}

/** Batch header action appears only when 2 or more checkable pending-integration tasks exist. */
export function shouldShowBatchIntegrationButton(
  tasks: readonly TaskSummary[],
): boolean {
  return selectIntegrationCheckTargets(tasks).length >= 2;
}

export interface BatchIntegrationSummaryNotice {
  title: string;
  detail: string;
}

/**
 * Formats a concise non-blocking notice only when batch integration leaves
 * unarchived or errored items; all-archived batches clear quietly on refresh.
 */
export function summarizeBatchIntegrationResult(
  result: BatchIntegrationCheckResult,
): BatchIntegrationSummaryNotice | null {
  const { completed, notIntegrated, unavailable, error } = result.counts;
  if (notIntegrated + unavailable + error === 0) {
    return null;
  }

  const parts = [`已归档 ${completed} 项`];
  if (notIntegrated > 0) {
    parts.push(`待本地集成 ${notIntegrated} 项`);
  }
  if (unavailable > 0) {
    parts.push(`无法检查 ${unavailable} 项`);
  }
  if (error > 0) {
    parts.push(`失败 ${error} 项`);
  }

  const reasons = Array.from(
    new Set(
      result.results
        .filter((item) => item.status !== "completed")
        .map((item) => item.integrationMessage ?? item.error?.message ?? null)
        .filter((message): message is string => Boolean(message && message.trim().length > 0)),
    ),
  );

  const detail =
    reasons.length > 0
      ? `${reasons.slice(0, 2).join("；")}${reasons.length > 2 ? `（另有 ${reasons.length - 2} 项详情见各任务卡片）` : ""}`
      : "其余未归档任务仍保留在待审核队列中，请在各任务卡片查看详情。";

  return {
    title: parts.join("，"),
    detail,
  };
}
