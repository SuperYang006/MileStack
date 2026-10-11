import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import {
  taskEventTypes,
  taskStatuses,
} from "../core/task-model.js";

export { taskEventTypes, taskStatuses } from "../core/task-model.js";
export type { TaskEventType, TaskStatus } from "../core/task-model.js";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rootPath: text("root_path"),
  goal: text("goal"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    objective: text("objective"),
    acceptanceCriteria: text("acceptance_criteria", { mode: "json" }).$type<
      string[]
    >(),
    status: text("status", { enum: taskStatuses }).notNull().default("inbox"),
    queuePosition: integer("queue_position"),
    currentStep: text("current_step"),
    nextStep: text("next_step"),
    blocker: text("blocker"),
    requiredAction: text("required_action"),
    handoffNote: text("handoff_note"),
    sourceTaskId: text("source_task_id").references(
      (): AnySQLiteColumn => tasks.id,
      {
      onDelete: "set null",
      },
    ),
    activeRunId: text("active_run_id"),
    createdBy: text("created_by", { enum: ["developer", "agent"] }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    check(
      "tasks_status_check",
      sql`${table.status} in ('inbox', 'ready', 'running', 'blocked', 'completed')`,
    ),
    check(
      "tasks_created_by_check",
      sql`${table.createdBy} in ('developer', 'agent')`,
    ),
    index("tasks_project_status_idx").on(table.projectId, table.status),
    index("tasks_project_queue_idx").on(
      table.projectId,
      table.queuePosition,
    ),
    index("tasks_project_updated_idx").on(table.projectId, table.updatedAt),
  ],
);

export const taskEvents = sqliteTable(
  "task_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    runId: text("run_id"),
    type: text("type", { enum: taskEventTypes }).notNull(),
    summary: text("summary").notNull(),
    completedWork: text("completed_work", { mode: "json" }).$type<string[]>(),
    currentStep: text("current_step"),
    nextStep: text("next_step"),
    blocker: text("blocker"),
    requiredAction: text("required_action"),
    handoffNote: text("handoff_note"),
    actorLabel: text("actor_label"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "task_events_type_check",
      sql`${table.type} in ('created', 'confirmed', 'started', 'progress', 'blocked', 'resumed', 'released', 'completed')`,
    ),
    index("task_events_task_created_idx").on(table.taskId, table.createdAt),
    index("task_events_project_created_idx").on(table.projectId, table.createdAt),
  ],
);

export const taskDependencies = sqliteTable(
  "task_dependencies",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: text("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.dependsOnTaskId] }),
    index("task_dependencies_dependency_idx").on(table.dependsOnTaskId),
  ],
);

export const schema = { projects, tasks, taskEvents, taskDependencies };

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskEvent = typeof taskEvents.$inferSelect;
export type NewTaskEvent = typeof taskEvents.$inferInsert;
export type TaskDependency = typeof taskDependencies.$inferSelect;
export type NewTaskDependency = typeof taskDependencies.$inferInsert;
