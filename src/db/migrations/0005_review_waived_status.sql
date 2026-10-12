PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_task_reviews` (
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
	CONSTRAINT "task_reviews_status_check" CHECK("__new_task_reviews"."status" in ('pending', 'in_progress', 'passed', 'changes_requested', 'waived')),
	CONSTRAINT "task_reviews_round_check" CHECK("__new_task_reviews"."review_round" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_task_reviews`("id", "project_id", "task_id", "review_round", "commit_sha", "branch", "worktree", "review_run_id", "status", "reviewer_actor_label", "summary", "findings", "verification_evidence", "created_at", "started_at", "concluded_at", "updated_at") SELECT "id", "project_id", "task_id", "review_round", "commit_sha", "branch", "worktree", "review_run_id", "status", "reviewer_actor_label", "summary", "findings", "verification_evidence", "created_at", "started_at", "concluded_at", "updated_at" FROM `task_reviews`;--> statement-breakpoint
DROP TABLE `task_reviews`;--> statement-breakpoint
ALTER TABLE `__new_task_reviews` RENAME TO `task_reviews`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `task_reviews_task_round_idx` ON `task_reviews` (`task_id`,`review_round`);--> statement-breakpoint
CREATE INDEX `task_reviews_project_created_idx` ON `task_reviews` (`project_id`,`created_at`);