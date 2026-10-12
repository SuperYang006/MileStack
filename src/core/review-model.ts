export const riskLevels = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof riskLevels)[number];

export const reviewStatuses = [
  "pending",
  "in_progress",
  "passed",
  "changes_requested",
  "waived",
] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];

export type ReviewFinding = {
  issue: string;
  suggestion: string;
  severity: RiskLevel;
};

export type VerificationEvidence = {
  command: string;
  result: string;
};
