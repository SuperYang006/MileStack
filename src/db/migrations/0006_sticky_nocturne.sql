ALTER TABLE `task_reviews` ADD `integration_required` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `task_reviews` ADD `integration_target_branch` text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE `task_reviews` ADD `integration_not_required_reason` text;--> statement-breakpoint
ALTER TABLE `task_reviews` ADD `approved_at` text;--> statement-breakpoint
ALTER TABLE `task_reviews` ADD `approved_by` text;--> statement-breakpoint
ALTER TABLE `task_reviews` ADD `integration_status` text;--> statement-breakpoint
ALTER TABLE `task_reviews` ADD `integration_message` text;--> statement-breakpoint
ALTER TABLE `task_reviews` ADD `integration_target_commit_sha` text;--> statement-breakpoint
ALTER TABLE `task_reviews` ADD `integration_checked_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `integration_required` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `integration_target_branch` text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `integration_not_required_reason` text;