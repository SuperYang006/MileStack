import type { TaskSummary } from "../types.js";

/**
 * A ready task returned by the latest changes-requested review. The task keeps
 * its existing status and queue position; rework is derived from the latest
 * review digest carried by project status.
 */
export function isReworkTask(task: TaskSummary): boolean {
  return task.status === "ready" && task.latestReview?.status === "changes_requested";
}

export function reworkTasksFor(tasks: readonly TaskSummary[]): TaskSummary[] {
  return tasks.filter(isReworkTask);
}
