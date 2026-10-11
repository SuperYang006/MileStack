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
WHERE "status" = 'in_review'
	AND NOT EXISTS (
		SELECT 1
		FROM "task_reviews"
		WHERE "task_reviews"."task_id" = "tasks"."id"
	);--> statement-breakpoint
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
	'migration-0004-review-' || "id",
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
DROP TABLE "__legacy_in_review_tasks";
