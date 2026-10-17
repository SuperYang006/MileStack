import { z } from "zod";

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

export const criterionResultStatuses = [
  "met",
  "not_met",
  "unverifiable",
] as const;
export type CriterionResultStatus = (typeof criterionResultStatuses)[number];

export const findingClosureStatuses = [
  "fixed",
  "partially_fixed",
  "not_fixed",
  "unverifiable",
  "invalidated",
] as const;
export type FindingClosureStatus = (typeof findingClosureStatuses)[number];

export const verificationEvidenceSchema = z
  .object({
    command: z.string().trim().min(1),
    result: z.string().trim().min(1),
  })
  .strict();

export type VerificationEvidence = z.infer<typeof verificationEvidenceSchema>;

/**
 * A review finding as stored and read. Fields added for structured reviews are
 * optional so findings written before this shape remain readable.
 */
export const reviewFindingSchema = z
  .object({
    issue: z.string().trim().min(1),
    suggestion: z.string().trim().min(1),
    severity: z.enum(riskLevels).default("medium"),
    trigger: z.string().trim().min(1).optional(),
    impact: z.string().trim().min(1).optional(),
    evidence: z.string().trim().min(1).optional(),
    location: z.string().trim().min(1).optional(),
  })
  .strict();

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

/**
 * The input contract for a newly written finding: every finding must record a
 * trigger condition, an observable impact, and evidence. A location is added
 * when the problem can be located in code or documentation.
 */
export const reviewFindingInputSchema = z
  .object({
    issue: z.string().trim().min(1),
    suggestion: z.string().trim().min(1),
    severity: z.enum(riskLevels).default("medium"),
    trigger: z.string().trim().min(1),
    impact: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
    location: z.string().trim().min(1).optional(),
  })
  .strict();

export type ReviewFindingInput = z.infer<typeof reviewFindingInputSchema>;

/**
 * A delivery result as stored and read. `criterionId` is absent on results
 * written before criterion identities existed; those legacy results stay
 * readable through their criterion text.
 */
export const criterionResultSchema = z
  .object({
    criterionId: z.string().trim().min(1).optional(),
    criterion: z.string().trim().min(1),
    status: z.enum(criterionResultStatuses),
    evidence: z.array(verificationEvidenceSchema).default([]),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "met" && result.evidence.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message:
          "A met criterion must include at least one recorded command and result.",
      });
    }
  });

export type CriterionResult = z.infer<typeof criterionResultSchema>;

/**
 * The input contract for a newly recorded delivery result: it targets the
 * stable criterion id, so a text edit never breaks the match.
 */
export const criterionResultInputSchema = z
  .object({
    criterionId: z.string().trim().min(1),
    status: z.enum(criterionResultStatuses),
    evidence: z.array(verificationEvidenceSchema).default([]),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "met" && result.evidence.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message:
          "A met criterion must include at least one recorded command and result.",
      });
    }
  });

export type CriterionResultInput = z.infer<typeof criterionResultInputSchema>;

export const findingClosureSchema = z
  .object({
    findingIndex: z.number().int().nonnegative(),
    status: z.enum(findingClosureStatuses),
    evidence: z.array(verificationEvidenceSchema).default([]),
  })
  .strict();

export type FindingClosure = z.infer<typeof findingClosureSchema>;

/**
 * JSON payload stored in `task_events.completed_work` for a submission. The
 * plain string array is the legacy shape and stays readable.
 */
export type CompletedWorkPayload =
  | string[]
  | {
      completedWork: string[] | null;
      criteriaResults: CriterionResult[];
    };

const completedWorkPayloadSchema = z.union([
  z.array(z.string()),
  z
    .object({
      completedWork: z.array(z.string()).nullable(),
      criteriaResults: z.array(criterionResultSchema),
    })
    .strict(),
]);

export type NormalizedCompletedWork = {
  completedWork: string[] | null;
  criteriaResults: CriterionResult[] | null;
};

export function normalizeCompletedWorkPayload(
  raw: unknown,
): NormalizedCompletedWork {
  if (raw === null || raw === undefined) {
    return { completedWork: null, criteriaResults: null };
  }
  const parsed = completedWorkPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    const legacy = z.array(z.string()).safeParse(raw);
    return {
      completedWork: legacy.success ? legacy.data : null,
      criteriaResults: null,
    };
  }
  if (Array.isArray(parsed.data)) {
    return { completedWork: parsed.data, criteriaResults: null };
  }
  return {
    completedWork: parsed.data.completedWork,
    criteriaResults: parsed.data.criteriaResults,
  };
}

export function completedWorkPayloadFor(record: {
  completedWork: string[] | null;
  criteriaResults: CriterionResult[] | null;
}): CompletedWorkPayload | null {
  if (record.criteriaResults === null) {
    return record.completedWork;
  }
  return {
    completedWork: record.completedWork,
    criteriaResults: record.criteriaResults,
  };
}

/**
 * JSON payload stored in `task_reviews.findings`. The plain finding array is
 * the legacy shape and stays readable.
 */
export type ReviewFindingsPayload =
  | ReviewFinding[]
  | {
      findings: ReviewFinding[];
      findingClosures: FindingClosure[];
    };

const reviewFindingsPayloadSchema = z.union([
  z.array(reviewFindingSchema),
  z
    .object({
      findings: z.array(reviewFindingSchema),
      findingClosures: z.array(findingClosureSchema),
    })
    .strict(),
]);

export type NormalizedReviewFindings = {
  findings: ReviewFinding[];
  findingClosures: FindingClosure[];
};

export function normalizeReviewFindingsPayload(
  raw: unknown,
): NormalizedReviewFindings {
  if (Array.isArray(raw)) {
    const parsed = z.array(reviewFindingSchema).safeParse(raw);
    return {
      findings: parsed.success ? parsed.data : [],
      findingClosures: [],
    };
  }
  if (raw !== null && typeof raw === "object") {
    const parsed = reviewFindingsPayloadSchema.safeParse(raw);
    if (parsed.success && !Array.isArray(parsed.data)) {
      return parsed.data;
    }
  }
  return { findings: [], findingClosures: [] };
}

export function reviewFindingsPayloadFor(record: {
  findings: ReviewFinding[];
  findingClosures: FindingClosure[];
}): ReviewFindingsPayload {
  if (record.findingClosures.length === 0) {
    return record.findings;
  }
  return {
    findings: record.findings,
    findingClosures: record.findingClosures,
  };
}
