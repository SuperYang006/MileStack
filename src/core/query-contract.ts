import { z } from "zod";

import {
  taskEventTypes,
  taskStatuses,
} from "./task-model.js";

const identifierSchema = z.string().min(1);
const nullableTextSchema = z.string().nullable();

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
    inbox: z.array(taskSummarySchema),
    recentlyCompleted: z.array(taskSummarySchema),
  })
  .strict();

export const taskDetailsSchema = z
  .object({
    task: taskSchema,
    events: z.array(taskEventSchema),
  })
  .strict();

export const getProjectStatusInputSchema = z
  .object({ projectId: identifierSchema })
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
    status: z.enum(["inbox", "ready"]).optional(),
    queuePosition: z.number().int().nonnegative().optional(),
    sourceTaskId: identifierSchema.optional(),
    createdBy: z.enum(["developer", "agent"]),
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

export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type TaskSummary = z.infer<typeof taskSummarySchema>;
export type TaskDetails = z.infer<typeof taskDetailsSchema>;
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type GetProjectStatusInput = z.infer<
  typeof getProjectStatusInputSchema
>;
export type GetTaskInput = z.infer<typeof getTaskInputSchema>;
export type CreateTaskInput = z.input<typeof createTaskInputSchema>;
export type CreateTasksInput = z.input<typeof createTasksInputSchema>;
