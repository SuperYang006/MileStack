import { z } from "zod";

import {
  acceptanceCriterionSchema,
  taskEventTypes,
  taskStatuses,
} from "./task-model.js";
import {
  criterionResultInputSchema,
  criterionResultSchema,
  findingClosureSchema,
  findingClosureStatuses,
  reviewFindingInputSchema,
  reviewFindingSchema,
  reviewStatuses,
  riskLevels,
  verificationEvidenceSchema,
} from "./review-model.js";
import type {
  AcceptanceCriterion,
  AcceptanceCriteriaPayload,
} from "./task-model.js";
import type {
  CriterionResult,
  CriterionResultInput,
  FindingClosure,
} from "./review-model.js";
import { integrationStatuses } from "./integration-model.js";

const identifierSchema = z.string().min(1);
const nullableTextSchema = z.string().nullable();
const dependencyIdsSchema = z
  .array(identifierSchema)
  .default([])
  .superRefine((dependencyIds, context) => {
    if (new Set(dependencyIds).size !== dependencyIds.length) {
      context.addIssue({
        code: "custom",
        message: "dependencyIds must not contain duplicates.",
      });
    }
  });

export const taskStatusSchema = z.enum(taskStatuses);
export const taskEventTypeSchema = z.enum(taskEventTypes);
export const riskLevelSchema = z.enum(riskLevels);
export const reviewStatusSchema = z.enum(reviewStatuses);
export const integrationStatusSchema = z.enum(integrationStatuses);
export {
  acceptanceCriterionSchema,
  criterionResultInputSchema,
  criterionResultSchema,
  findingClosureSchema,
  reviewFindingInputSchema,
  reviewFindingSchema,
};
export type { AcceptanceCriterion, AcceptanceCriteriaPayload };
export type { CriterionResult, CriterionResultInput, FindingClosure };

export const reviewSchema = z
  .object({
    id: identifierSchema,
    projectId: identifierSchema,
    taskId: identifierSchema,
    reviewRound: z.number().int().positive(),
    commitSha: z.string().regex(/^[0-9a-f]{40}$/i),
    branch: nullableTextSchema,
    worktree: nullableTextSchema,
    reviewRunId: nullableTextSchema,
    status: reviewStatusSchema,
    reviewerActorLabel: nullableTextSchema,
    summary: nullableTextSchema,
    findings: z.array(reviewFindingSchema),
    findingClosures: z.array(findingClosureSchema).default([]),
    verificationEvidence: z.array(verificationEvidenceSchema),
    integrationRequired: z.boolean(),
    integrationTargetBranch: z.string().min(1),
    integrationNotRequiredReason: nullableTextSchema,
    approvedAt: nullableTextSchema,
    approvedBy: nullableTextSchema,
    integrationStatus: integrationStatusSchema.nullable(),
    integrationMessage: nullableTextSchema,
    integrationTargetCommitSha: nullableTextSchema,
    integrationCheckedAt: nullableTextSchema,
    createdAt: z.string().min(1),
    startedAt: nullableTextSchema,
    concludedAt: nullableTextSchema,
    updatedAt: z.string().min(1),
  })
  .strict();

export const reviewDigestSchema = z
  .object({
    id: identifierSchema,
    status: reviewStatusSchema,
    reviewRound: z.number().int().positive(),
    commitSha: z.string().regex(/^[0-9a-f]{40}$/i),
    reviewerActorLabel: nullableTextSchema,
    branch: nullableTextSchema,
    worktree: nullableTextSchema,
    summary: nullableTextSchema,
    createdAt: z.string().min(1),
    acceptanceCriteriaCount: z.number().int().nonnegative(),
    verificationEvidenceCount: z.number().int().nonnegative(),
    findingsCount: z.number().int().nonnegative(),
    integrationRequired: z.boolean(),
    integrationTargetBranch: z.string().min(1),
    integrationNotRequiredReason: nullableTextSchema,
    approvedAt: nullableTextSchema,
    integrationStatus: integrationStatusSchema.nullable(),
    integrationMessage: nullableTextSchema,
    integrationTargetCommitSha: nullableTextSchema,
    integrationCheckedAt: nullableTextSchema,
  })
  .strict();

export const projectSummarySchema = z
  .object({
    id: identifierSchema,
    name: z.string().min(1),
    goal: nullableTextSchema,
  })
  .strict();

export const taskSummarySchema = z
  .object({
    id: identifierSchema,
    projectId: identifierSchema,
    title: z.string().min(1),
    objective: nullableTextSchema.optional(),
    acceptanceCriteria: z
      .array(acceptanceCriterionSchema)
      .nullable()
      .optional(),
    status: taskStatusSchema,
    queuePosition: z.number().int().nullable(),
    dependencyIds: z.array(identifierSchema),
    waitingFor: z.array(
      z
        .object({
          id: identifierSchema,
          title: z.string().min(1),
          status: taskStatusSchema,
        })
        .strict(),
    ),
    runnable: z.boolean(),
    currentStep: nullableTextSchema,
    nextStep: nullableTextSchema,
    blocker: nullableTextSchema,
    requiredAction: nullableTextSchema,
    updatedAt: z.string().min(1),
    completedAt: nullableTextSchema,
    riskLevel: riskLevelSchema,
    riskConfirmed: z.boolean(),
    integrationRequired: z.boolean(),
    integrationTargetBranch: z.string().min(1),
    integrationNotRequiredReason: nullableTextSchema,
    latestReview: reviewDigestSchema.nullable().optional(),
  })
  .strict();

export const taskSchema = z
  .object({
    id: identifierSchema,
    projectId: identifierSchema,
    title: z.string().min(1),
    objective: nullableTextSchema,
    acceptanceCriteria: z.array(acceptanceCriterionSchema).nullable(),
    status: taskStatusSchema,
    queuePosition: z.number().int().nullable(),
    dependencyIds: z.array(identifierSchema),
    currentStep: nullableTextSchema,
    nextStep: nullableTextSchema,
    blocker: nullableTextSchema,
    requiredAction: nullableTextSchema,
    handoffNote: nullableTextSchema,
    sourceTaskId: identifierSchema.nullable(),
    activeRunId: nullableTextSchema,
    activeReviewRunId: nullableTextSchema,
    riskLevel: riskLevelSchema,
    riskConfirmed: z.boolean(),
    riskConfirmedBy: nullableTextSchema,
    riskConfirmedAt: nullableTextSchema,
    integrationRequired: z.boolean(),
    integrationTargetBranch: z.string().min(1),
    integrationNotRequiredReason: nullableTextSchema,
    createdBy: z.enum(["developer", "agent"]),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    completedAt: nullableTextSchema,
  })
  .strict();

export const taskEventSchema = z
  .object({
    id: identifierSchema,
    projectId: identifierSchema,
    taskId: identifierSchema,
    runId: nullableTextSchema,
    type: taskEventTypeSchema,
    summary: z.string().min(1),
    completedWork: z.array(z.string()).nullable(),
    criteriaResults: z.array(criterionResultSchema).nullable().optional(),
    currentStep: nullableTextSchema,
    nextStep: nullableTextSchema,
    blocker: nullableTextSchema,
    requiredAction: nullableTextSchema,
    handoffNote: nullableTextSchema,
    actorLabel: nullableTextSchema,
    createdAt: z.string().min(1),
  })
  .strict();

const taskStatusCountSchema = z
  .object({
    inbox: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    inReview: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const projectStatusSchema = z
  .object({
    project: projectSummarySchema,
    latestUpdatedAt: nullableTextSchema.optional(),
    counts: taskStatusCountSchema,
    current: z.array(taskSummarySchema),
    next: z.array(taskSummarySchema),
    blocked: z.array(taskSummarySchema),
    inReview: z.array(taskSummarySchema),
    inbox: z.array(taskSummarySchema),
    recentlyCompleted: z.array(taskSummarySchema),
  })
  .strict();

const statusTruncationSchema = z
  .object({
    current: z.boolean(),
    next: z.boolean(),
    blocked: z.boolean(),
    inReview: z.boolean(),
    inbox: z.boolean(),
    recentlyCompleted: z.boolean(),
  })
  .strict();

export const compactProjectStatusSchema = z
  .object({
    view: z.literal("compact"),
    project: projectSummarySchema,
    latestUpdatedAt: nullableTextSchema.optional(),
    counts: taskStatusCountSchema,
    current: z.array(taskSummarySchema),
    next: z.array(taskSummarySchema),
    nextRunnable: taskSummarySchema.nullable(),
    blocked: z.array(taskSummarySchema),
    inReview: z.array(taskSummarySchema),
    inbox: z.array(taskSummarySchema),
    recentlyCompleted: z.array(taskSummarySchema),
    truncated: statusTruncationSchema,
  })
  .strict();

export const projectStatusResultSchema = z.union([
  projectStatusSchema,
  compactProjectStatusSchema,
]);

export const taskDetailsSchema = z
  .object({
    task: taskSchema,
    events: z.array(taskEventSchema),
    reviews: z.array(reviewSchema),
  })
  .strict();

export const taskWorkingDependencySchema = z
  .object({
    id: identifierSchema,
    title: z.string().min(1),
    status: taskStatusSchema,
  })
  .strict();

export const taskWorkingPhaseSchema = z.enum(["implementation", "review"]);

export const taskWorkingSubmissionSchema = z
  .object({
    review: reviewSchema,
    summary: nullableTextSchema,
    completedWork: z.array(z.string()).nullable(),
    criteriaResults: z.array(criterionResultSchema).nullable(),
  })
  .strict();

const taskWorkingFindingFields = {
  issue: z.string().min(1),
  suggestion: z.string().min(1),
  severity: riskLevelSchema,
  trigger: z.string().min(1).optional(),
  impact: z.string().min(1).optional(),
  evidence: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
};

export const taskWorkingPreviousFindingSchema = z
  .object({
    findingIndex: z.number().int().nonnegative(),
    ...taskWorkingFindingFields,
  })
  .strict();

export const taskWorkingOpenFindingSchema = z
  .object({
    reviewRound: z.number().int().positive(),
    findingIndex: z.number().int().nonnegative(),
    ...taskWorkingFindingFields,
    closureStatus: z.enum(findingClosureStatuses).nullable(),
  })
  .strict();

export const taskWorkingDetailsSchema = z
  .object({
    task: taskSchema,
    phase: taskWorkingPhaseSchema,
    dependencies: z.array(taskWorkingDependencySchema),
    currentRunEvents: z.array(taskEventSchema),
    latestSubmission: taskWorkingSubmissionSchema.nullable(),
    previousFindings: z.array(taskWorkingPreviousFindingSchema),
    openFindings: z.array(taskWorkingOpenFindingSchema),
  })
  .strict();

export const projectStatusViewSchema = z.enum(["compact", "full"]);

export const getProjectStatusInputSchema = z
  .object({
    projectId: identifierSchema,
    view: projectStatusViewSchema.optional(),
    since: z.string().min(1).optional(),
  })
  .strict();

export const listTasksInputSchema = z
  .object({
    projectId: identifierSchema,
    status: taskStatusSchema,
    limit: z.number().int().min(1).max(100).default(20),
    cursor: identifierSchema.optional(),
  })
  .strict();

export const taskCursorSchema = z
  .object({
    status: taskStatusSchema,
    id: identifierSchema,
    queuePosition: z.number().int().nullable().optional(),
    createdAt: z.string().min(1).optional(),
    completedAt: z.string().min(1).nullable().optional(),
    updatedAt: z.string().min(1).optional(),
  })
  .strict();

export const taskPageSchema = z
  .object({
    status: taskStatusSchema,
    tasks: z.array(taskSummarySchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export const getTaskInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    view: z.enum(["working", "full"]).default("working"),
  })
  .strict();

export const createTaskInputSchema = z
  .object({
    projectId: identifierSchema,
    title: z.string().trim().min(1),
    objective: z.string().trim().min(1).optional(),
    acceptanceCriteria: z.array(z.string().trim().min(1)).default([]),
    dependencyIds: dependencyIdsSchema,
    status: z.enum(["inbox", "ready"]).optional(),
    queuePosition: z.number().int().nonnegative().optional(),
    sourceTaskId: identifierSchema.optional(),
    riskLevel: riskLevelSchema.optional(),
    createdBy: z.enum(["developer", "agent"]),
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict();

export const setTaskDependenciesInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    dependencyIds: dependencyIdsSchema,
    summary: z.string().trim().min(1).default("Task dependencies updated."),
  })
  .strict();

export const createTasksInputSchema = z
  .object({
    projectId: identifierSchema,
    tasks: z
      .array(createTaskInputSchema.omit({ projectId: true }))
      .min(1),
  })
  .strict();

export const startTaskInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict();

const executionUpdateFields = {
  projectId: identifierSchema,
  taskId: identifierSchema,
  runId: identifierSchema,
  summary: z.string().trim().min(1),
  completedWork: z.array(z.string().trim().min(1)).default([]),
  currentStep: z.string().trim().min(1).nullable().optional(),
  nextStep: z.string().trim().min(1).nullable().optional(),
  blocker: z.string().trim().min(1).nullable().optional(),
  requiredAction: z.string().trim().min(1).nullable().optional(),
  handoffNote: z.string().trim().min(1).nullable().optional(),
  actorLabel: z.string().trim().min(1).optional(),
};

export const updateTaskInputSchema = z.object(executionUpdateFields).strict();

export const submitForReviewInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    runId: identifierSchema,
    commitSha: z.string().regex(/^[0-9a-f]{40}$/i),
    branch: z.string().trim().min(1).optional(),
    worktree: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(1),
    completedWork: z.array(z.string().trim().min(1)).default([]),
    criteriaResults: z.array(criterionResultInputSchema).default([]),
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict();

export const confirmTaskInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    riskLevel: riskLevelSchema.optional(),
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict();

export const returnTaskToInboxInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict();

export const approveTaskInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict();

export const setTaskIntegrationPolicyInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    integrationRequired: z.boolean(),
    integrationTargetBranch: z.string().trim().min(1).max(255).default("main"),
    integrationNotRequiredReason: z.string().trim().min(1).max(2_000).nullable().optional(),
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.integrationRequired && !input.integrationNotRequiredReason) {
      context.addIssue({
        code: "custom",
        path: ["integrationNotRequiredReason"],
        message: "A developer reason is required when Git integration is not required.",
      });
    }
    if (input.integrationRequired && input.integrationNotRequiredReason) {
      context.addIssue({
        code: "custom",
        path: ["integrationNotRequiredReason"],
        message: "A no-integration reason is only valid when integration is not required.",
      });
    }
  });

export const checkTaskIntegrationInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    expectedReviewId: identifierSchema,
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict();

export const waiveTaskApprovalInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    reason: z.string().trim().min(1),
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict();

export const requestTaskChangesInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    reviewRunId: identifierSchema.optional(),
    feedback: z.string().trim().min(1).optional(),
    findings: z.array(reviewFindingInputSchema).default([]),
    findingClosures: z.array(findingClosureSchema).default([]),
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.feedback && input.findings.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["feedback"],
        message: "feedback or findings must be provided.",
      });
    }
  });

export const startReviewInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict();

export const completeReviewInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    reviewRunId: identifierSchema,
    decision: z.enum(["passed", "changes_requested"]),
    summary: z.string().trim().min(1),
    findings: z.array(reviewFindingInputSchema).default([]),
    findingClosures: z.array(findingClosureSchema).default([]),
    verificationEvidence: z.array(verificationEvidenceSchema).default([]),
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict();

export const reopenTaskInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    reason: z.string().trim().min(1),
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict();

/**
 * An edited acceptance criterion. Entries that keep an existing `id` stay the
 * same criterion even when the text changes; entries without an id are matched
 * by identical text or become a new criterion.
 */
export const acceptanceCriteriaEditEntrySchema = z.union([
  z.string().trim().min(1),
  z
    .object({
      id: identifierSchema.optional(),
      text: z.string().trim().min(1),
    })
    .strict(),
]);

export type AcceptanceCriteriaEditEntry = z.infer<
  typeof acceptanceCriteriaEditEntrySchema
>;

export const editInboxTaskInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    title: z.string().trim().min(1),
    objective: z.string().trim().min(1).nullable().optional(),
    acceptanceCriteria: z.array(acceptanceCriteriaEditEntrySchema).default([]),
    dependencyIds: dependencyIdsSchema.default([]),
    riskLevel: riskLevelSchema.optional(),
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict();
export const deleteTaskInputSchema = z
  .object({ projectId: identifierSchema, taskId: identifierSchema })
  .strict();

export const reorderTaskInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    direction: z.enum(["up", "down"]),
  })
  .strict();

export const releaseTaskInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    runId: identifierSchema,
    reason: z.string().trim().min(1).optional(),
    handoffNote: z.string().trim().min(1).nullable().optional(),
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict();

export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type TaskSummary = z.infer<typeof taskSummarySchema>;
export type TaskDetails = z.infer<typeof taskDetailsSchema>;
export type TaskWorkingDetails = z.infer<typeof taskWorkingDetailsSchema>;
export type TaskWorkingPhase = z.infer<typeof taskWorkingPhaseSchema>;
export type TaskWorkingPreviousFinding = z.infer<
  typeof taskWorkingPreviousFindingSchema
>;
export type TaskWorkingOpenFinding = z.infer<
  typeof taskWorkingOpenFindingSchema
>;
export type Review = z.infer<typeof reviewSchema>;
export type ReviewDigest = z.infer<typeof reviewDigestSchema>;
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type CompactProjectStatus = z.infer<typeof compactProjectStatusSchema>;
export type ProjectStatusResult = z.infer<typeof projectStatusResultSchema>;
export type GetProjectStatusInput = z.infer<
  typeof getProjectStatusInputSchema
>;
export type ListTasksInput = z.input<typeof listTasksInputSchema>;
export type TaskCursor = z.infer<typeof taskCursorSchema>;
export type TaskPage = z.infer<typeof taskPageSchema>;
export type GetTaskInput = z.input<typeof getTaskInputSchema>;
export type CreateTaskInput = z.input<typeof createTaskInputSchema>;
export type CreateTasksInput = z.input<typeof createTasksInputSchema>;
export type SetTaskDependenciesInput = z.input<
  typeof setTaskDependenciesInputSchema
>;
export type StartTaskInput = z.input<typeof startTaskInputSchema>;
export type UpdateTaskInput = z.input<typeof updateTaskInputSchema>;
export type SubmitForReviewInput = z.input<typeof submitForReviewInputSchema>;
export type StartReviewInput = z.input<typeof startReviewInputSchema>;
export type CompleteReviewInput = z.input<typeof completeReviewInputSchema>;
export type ConfirmTaskInput = z.input<typeof confirmTaskInputSchema>;
export type ReturnTaskToInboxInput = z.input<
  typeof returnTaskToInboxInputSchema
>;
export type ApproveTaskInput = z.input<typeof approveTaskInputSchema>;
export type SetTaskIntegrationPolicyInput = z.input<
  typeof setTaskIntegrationPolicyInputSchema
>;
export type CheckTaskIntegrationInput = z.input<typeof checkTaskIntegrationInputSchema>;
export type WaiveTaskApprovalInput = z.input<typeof waiveTaskApprovalInputSchema>;
export type RequestTaskChangesInput = z.input<
  typeof requestTaskChangesInputSchema
>;
export type ReopenTaskInput = z.input<typeof reopenTaskInputSchema>;
export type DeleteTaskInput = z.input<typeof deleteTaskInputSchema>;
export type ReorderTaskInput = z.input<typeof reorderTaskInputSchema>;
export type ReleaseTaskInput = z.input<typeof releaseTaskInputSchema>;
export type EditInboxTaskInput = z.input<typeof editInboxTaskInputSchema>;
