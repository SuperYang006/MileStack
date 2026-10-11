PRAGMA foreign_keys=OFF;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `tasks` RENAME TO `__old_tasks`;--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`objective` text,
	`acceptance_criteria` text,
	`status` text DEFAULT 'inbox' NOT NULL,
	`queue_position` integer,
	`current_step` text,
	`next_step` text,
	`blocker` text,
	`required_action` text,
	`handoff_note` text,
	`source_task_id` text,
	`active_run_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tasks_status_check" CHECK("tasks"."status" in ('inbox', 'ready', 'running', 'blocked', 'in_review', 'completed')),
	CONSTRAINT "tasks_created_by_check" CHECK("tasks"."created_by" in ('developer', 'agent'))
);--> statement-breakpoint
INSERT INTO `tasks`("id", "project_id", "title", "objective", "acceptance_criteria", "status", "queue_position", "current_step", "next_step", "blocker", "required_action", "handoff_note", "source_task_id", "active_run_id", "created_by", "created_at", "updated_at", "completed_at") SELECT "id", "project_id", "title", "objective", "acceptance_criteria", "status", "queue_position", "current_step", "next_step", "blocker", "required_action", "handoff_note", "source_task_id", "active_run_id", "created_by", "created_at", "updated_at", "completed_at" FROM `__old_tasks`;--> statement-breakpoint
ALTER TABLE `task_events` RENAME TO `__old_task_events`;--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text,
	`type` text NOT NULL,
	`summary` text NOT NULL,
	`completed_work` text,
	`current_step` text,
	`next_step` text,
	`blocker` text,
	`required_action` text,
	`handoff_note` text,
	`actor_label` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_events_type_check" CHECK("task_events"."type" in ('created', 'confirmed', 'started', 'progress', 'blocked', 'resumed', 'released', 'submitted_for_review', 'approved', 'changes_requested', 'reopened', 'completed'))
);--> statement-breakpoint
INSERT INTO `task_events`("id", "project_id", "task_id", "run_id", "type", "summary", "completed_work", "current_step", "next_step", "blocker", "required_action", "handoff_note", "actor_label", "created_at") SELECT "id", "project_id", "task_id", "run_id", "type", "summary", "completed_work", "current_step", "next_step", "blocker", "required_action", "handoff_note", "actor_label", "created_at" FROM `__old_task_events`;--> statement-breakpoint
DROP TABLE `__old_task_events`;--> statement-breakpoint
CREATE INDEX `task_events_task_created_idx` ON `task_events` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `task_events_project_created_idx` ON `task_events` (`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `task_dependencies` RENAME TO `__old_task_dependencies`;--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`task_id` text NOT NULL,
	`depends_on_task_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `depends_on_task_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
INSERT INTO `task_dependencies`("task_id", "depends_on_task_id") SELECT "task_id", "depends_on_task_id" FROM `__old_task_dependencies`;--> statement-breakpoint
DROP TABLE `__old_task_dependencies`;--> statement-breakpoint
CREATE INDEX `task_dependencies_dependency_idx` ON `task_dependencies` (`depends_on_task_id`);--> statement-breakpoint
DROP TABLE `__old_tasks`;--> statement-breakpoint
CREATE INDEX `tasks_project_status_idx` ON `tasks` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_project_queue_idx` ON `tasks` (`project_id`,`queue_position`);--> statement-breakpoint
CREATE INDEX `tasks_project_updated_idx` ON `tasks` (`project_id`,`updated_at`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
