CREATE TABLE `task_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`review_round` integer NOT NULL,
	`commit_sha` text NOT NULL,
	`branch` text,
	`worktree` text,
	`review_run_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewer_actor_label` text,
	`summary` text,
	`findings` text,
	`verification_evidence` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`concluded_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_reviews_status_check" CHECK("task_reviews"."status" in ('pending', 'in_progress', 'passed', 'changes_requested')),
	CONSTRAINT "task_reviews_round_check" CHECK("task_reviews"."review_round" > 0)
);
--> statement-breakpoint
CREATE INDEX `task_reviews_task_round_idx` ON `task_reviews` (`task_id`,`review_round`);--> statement-breakpoint
CREATE INDEX `task_reviews_project_created_idx` ON `task_reviews` (`project_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_task_events` (
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
	CONSTRAINT "task_events_type_check" CHECK("__new_task_events"."type" in ('created', 'confirmed', 'started', 'progress', 'blocked', 'resumed', 'released', 'submitted_for_review', 'review_started', 'review_passed', 'approved', 'changes_requested', 'reopened', 'completed'))
);
--> statement-breakpoint
INSERT INTO `__new_task_events`("id", "project_id", "task_id", "run_id", "type", "summary", "completed_work", "current_step", "next_step", "blocker", "required_action", "handoff_note", "actor_label", "created_at") SELECT "id", "project_id", "task_id", "run_id", "type", "summary", "completed_work", "current_step", "next_step", "blocker", "required_action", "handoff_note", "actor_label", "created_at" FROM `task_events`;--> statement-breakpoint
DROP TABLE `task_events`;--> statement-breakpoint
ALTER TABLE `__new_task_events` RENAME TO `task_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `task_events_task_created_idx` ON `task_events` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `task_events_project_created_idx` ON `task_events` (`project_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TEMP TABLE `__task_events_backup` AS SELECT "id", "project_id", "task_id", "run_id", "type", "summary", "completed_work", "current_step", "next_step", "blocker", "required_action", "handoff_note", "actor_label", "created_at" FROM `task_events`;--> statement-breakpoint
CREATE TEMP TABLE `__task_dependencies_backup` AS SELECT "task_id", "depends_on_task_id" FROM `task_dependencies`;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
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
	`active_review_run_id` text,
	`risk_level` text DEFAULT 'medium' NOT NULL,
	`risk_confirmed` integer DEFAULT true NOT NULL,
	`risk_confirmed_by` text,
	`risk_confirmed_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tasks_status_check" CHECK("__new_tasks"."status" in ('inbox', 'ready', 'running', 'blocked', 'in_review', 'completed')),
	CONSTRAINT "tasks_created_by_check" CHECK("__new_tasks"."created_by" in ('developer', 'agent')),
	CONSTRAINT "tasks_risk_level_check" CHECK("__new_tasks"."risk_level" in ('low', 'medium', 'high'))
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "project_id", "title", "objective", "acceptance_criteria", "status", "queue_position", "current_step", "next_step", "blocker", "required_action", "handoff_note", "source_task_id", "active_run_id", "active_review_run_id", "risk_level", "risk_confirmed", "risk_confirmed_by", "risk_confirmed_at", "created_by", "created_at", "updated_at", "completed_at") SELECT "id", "project_id", "title", "objective", "acceptance_criteria", "status", "queue_position", "current_step", "next_step", "blocker", "required_action", "handoff_note", "source_task_id", "active_run_id", NULL, 'medium', 1, NULL, NULL, "created_by", "created_at", "updated_at", "completed_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
CREATE INDEX `tasks_project_status_idx` ON `tasks` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_project_queue_idx` ON `tasks` (`project_id`,`queue_position`);--> statement-breakpoint
INSERT INTO `task_events`("id", "project_id", "task_id", "run_id", "type", "summary", "completed_work", "current_step", "next_step", "blocker", "required_action", "handoff_note", "actor_label", "created_at") SELECT "id", "project_id", "task_id", "run_id", "type", "summary", "completed_work", "current_step", "next_step", "blocker", "required_action", "handoff_note", "actor_label", "created_at" FROM `__task_events_backup`;--> statement-breakpoint
DROP TABLE `__task_events_backup`;--> statement-breakpoint
INSERT INTO `task_dependencies`("task_id", "depends_on_task_id") SELECT "task_id", "depends_on_task_id" FROM `__task_dependencies_backup`;--> statement-breakpoint
DROP TABLE `__task_dependencies_backup`;--> statement-breakpoint
CREATE INDEX `tasks_project_updated_idx` ON `tasks` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE TEMP TABLE `__legacy_in_review_tasks` AS
SELECT
	"id",
	"project_id",
	"handoff_note",
	COALESCE(
		(SELECT MAX("queue_position") FROM "tasks" WHERE "status" = 'ready'),
		0
	) + ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS "queue_position"
FROM "tasks"
WHERE "status" = 'in_review';--> statement-breakpoint
UPDATE "tasks"
SET
	"status" = 'ready',
	"queue_position" = (
		SELECT "queue_position"
		FROM "__legacy_in_review_tasks"
		WHERE "__legacy_in_review_tasks"."id" = "tasks"."id"
	),
	"active_run_id" = NULL,
	"active_review_run_id" = NULL,
	"completed_at" = NULL,
	"handoff_note" = CASE
		WHEN "__legacy_in_review_tasks"."handoff_note" IS NULL
			OR trim("__legacy_in_review_tasks"."handoff_note") = ''
		THEN 'Legacy in_review task requires a fresh submission with a real commit SHA.'
		ELSE "__legacy_in_review_tasks"."handoff_note" || char(10) || char(10) ||
			'Legacy in_review task requires a fresh submission with a real commit SHA.'
	END
FROM "__legacy_in_review_tasks"
WHERE "__legacy_in_review_tasks"."id" = "tasks"."id";--> statement-breakpoint
INSERT INTO "task_events"(
	"id",
	"project_id",
	"task_id",
	"run_id",
	"type",
	"summary",
	"completed_work",
	"current_step",
	"next_step",
	"blocker",
	"required_action",
	"handoff_note",
	"actor_label",
	"created_at"
)
SELECT
	'migration-0003-review-' || "id",
	"project_id",
	"id",
	NULL,
	'progress',
	'Legacy in_review task returned to ready for a fresh commit submission.',
	NULL,
	NULL,
	NULL,
	NULL,
	NULL,
	CASE
		WHEN "handoff_note" IS NULL OR trim("handoff_note") = ''
		THEN 'Legacy in_review task requires a fresh submission with a real commit SHA.'
		ELSE "handoff_note" || char(10) || char(10) ||
			'Legacy in_review task requires a fresh submission with a real commit SHA.'
	END,
	'system',
	strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM "__legacy_in_review_tasks";--> statement-breakpoint
DROP TABLE "__legacy_in_review_tasks";--> statement-breakpoint
PRAGMA foreign_keys=ON;
