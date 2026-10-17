import type {
  CriterionResultStatus,
  FindingClosureStatus,
  ReviewFinding,
  RiskLevel,
  TaskEvent,
  TaskReview,
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
