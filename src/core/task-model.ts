export const taskStatuses = [
  "inbox",
  "ready",
  "running",
  "blocked",
  "in_review",
  "completed",
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export const taskEventTypes = [
  "created",
  "confirmed",
  "started",
  "progress",
  "blocked",
  "resumed",
  "released",
  "submitted_for_review",
  "review_started",
  "review_passed",
  "approved",
  "changes_requested",
  "reopened",
  "completed",
] as const;

export type TaskEventType = (typeof taskEventTypes)[number];
