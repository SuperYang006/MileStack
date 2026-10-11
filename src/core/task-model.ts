export const taskStatuses = [
  "inbox",
  "ready",
  "running",
  "blocked",
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
  "completed",
] as const;

export type TaskEventType = (typeof taskEventTypes)[number];
