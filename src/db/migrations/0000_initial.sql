CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`root_path` text,
	`goal` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
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
	CONSTRAINT "task_events_type_check" CHECK("task_events"."type" in ('created', 'confirmed', 'started', 'progress', 'blocked', 'resumed', 'released', 'completed'))
);
--> statement-breakpoint
CREATE INDEX `task_events_task_created_idx` ON `task_events` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `task_events_project_created_idx` ON `task_events` (`project_id`,`created_at`);--> statement-breakpoint
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
	CONSTRAINT "tasks_status_check" CHECK("tasks"."status" in ('inbox', 'ready', 'running', 'blocked', 'completed')),
	CONSTRAINT "tasks_created_by_check" CHECK("tasks"."created_by" in ('developer', 'agent'))
);
--> statement-breakpoint
CREATE INDEX `tasks_project_status_idx` ON `tasks` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_project_queue_idx` ON `tasks` (`project_id`,`queue_position`);--> statement-breakpoint
CREATE INDEX `tasks_project_updated_idx` ON `tasks` (`project_id`,`updated_at`);