import { z } from "zod";

import {
  taskEventTypes,
  taskStatuses,
} from "./task-model.js";

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
  })
  .strict();

export const taskSchema = z
  .object({
    id: identifierSchema,
    projectId: identifierSchema,
    title: z.string().min(1),
    objective: nullableTextSchema,
    acceptanceCriteria: z.array(z.string()).nullable(),
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
    currentStep: nullableTextSchema,
    nextStep: nullableTextSchema,
    blocker: nullableTextSchema,
    requiredAction: nullableTextSchema,
    handoffNote: nullableTextSchema,
    actorLabel: nullableTextSchema,
    createdAt: z.string().min(1),
  })
  .strict();

export const projectStatusSchema = z
  .object({
    project: projectSummarySchema,
    current: z.array(taskSummarySchema),
    next: z.array(taskSummarySchema),
    blocked: z.array(taskSummarySchema),
    inReview: z.array(taskSummarySchema),
    inbox: z.array(taskSummarySchema),
    recentlyCompleted: z.array(taskSummarySchema),
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
  })
  .strict();

export const projectStatusViewSchema = z.enum(["compact", "full"]);

export const getProjectStatusInputSchema = z
  .object({
    projectId: identifierSchema,
    view: projectStatusViewSchema.optional(),
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
    summary: z.string().trim().min(1),
    completedWork: z.array(z.string().trim().min(1)).default([]),
    actorLabel: z.string().trim().min(1).optional(),
  })
  .strict();

export const confirmTaskInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
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

export const requestTaskChangesInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    feedback: z.string().trim().min(1),
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

export const editInboxTaskInputSchema = z
  .object({
    projectId: identifierSchema,
    taskId: identifierSchema,
    title: z.string().trim().min(1),
    objective: z.string().trim().min(1).nullable().optional(),
    acceptanceCriteria: z.array(z.string().trim().min(1)).default([]),
    dependencyIds: dependencyIdsSchema.default([]),
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
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type CompactProjectStatus = z.infer<typeof compactProjectStatusSchema>;
export type ProjectStatusResult = z.infer<typeof projectStatusResultSchema>;
export type GetProjectStatusInput = z.infer<
  typeof getProjectStatusInputSchema
>;
export type ListTasksInput = z.input<typeof listTasksInputSchema>;
export type TaskCursor = z.infer<typeof taskCursorSchema>;
export type TaskPage = z.infer<typeof taskPageSchema>;
export type GetTaskInput = z.infer<typeof getTaskInputSchema>;
export type CreateTaskInput = z.input<typeof createTaskInputSchema>;
export type CreateTasksInput = z.input<typeof createTasksInputSchema>;
export type SetTaskDependenciesInput = z.input<
  typeof setTaskDependenciesInputSchema
>;
export type StartTaskInput = z.input<typeof startTaskInputSchema>;
export type UpdateTaskInput = z.input<typeof updateTaskInputSchema>;
export type SubmitForReviewInput = z.input<typeof submitForReviewInputSchema>;
export type ConfirmTaskInput = z.input<typeof confirmTaskInputSchema>;
export type ReturnTaskToInboxInput = z.input<
  typeof returnTaskToInboxInputSchema
>;
export type ApproveTaskInput = z.input<typeof approveTaskInputSchema>;
export type RequestTaskChangesInput = z.input<
  typeof requestTaskChangesInputSchema
>;
export type ReopenTaskInput = z.input<typeof reopenTaskInputSchema>;
export type DeleteTaskInput = z.input<typeof deleteTaskInputSchema>;
export type ReorderTaskInput = z.input<typeof reorderTaskInputSchema>;
export type ReleaseTaskInput = z.input<typeof releaseTaskInputSchema>;
export type EditInboxTaskInput = z.input<typeof editInboxTaskInputSchema>;
