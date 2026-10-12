import type { TaskEvent, TaskReview } from "../types.js";

export function formatDuration(ms: number): string {
  if (ms < 0) return "0秒";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}秒`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return `${totalMinutes}分${remainingSeconds > 0 ? `${remainingSeconds}秒` : ""}`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return `${totalHours}小时${remainingMinutes > 0 ? `${remainingMinutes}分` : ""}`;
  }
  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return `${days}天${remainingHours > 0 ? `${remainingHours}小时` : ""}`;
}

export type RunExecutionStatus =
  | "running"
  | "in_review"
  | "completed"
  | "released"
  | "incomplete"
  | "review_passed"
  | "changes_requested"
  | "waived"
  | "reviewing";

export interface RunExecution {
  runId: string;
  kind: "execution" | "review";
  actorLabel?: string | null | undefined;
  startedAt: Date;
  endedAt?: Date | undefined;
  status: RunExecutionStatus;
  durationMs: number | null;
}

export function computeRunExecutions(
  events: TaskEvent[],
  activeRunId: string | null = null,
  taskStatus: string = "",
  nowMs: number = Date.now(),
  reviews?: TaskReview[],
  activeReviewRunId?: string | null,
): RunExecution[] {
  const runEventsMap = new Map<string, TaskEvent[]>();
  const runOrder: string[] = [];

  for (const event of events) {
    if (!event.runId) continue;
    if (!runEventsMap.has(event.runId)) {
      runEventsMap.set(event.runId, []);
      runOrder.push(event.runId);
    }
    runEventsMap.get(event.runId)!.push(event);
  }

  if (reviews) {
    for (const rev of reviews) {
      if (rev.reviewRunId && !runEventsMap.has(rev.reviewRunId)) {
        runEventsMap.set(rev.reviewRunId, []);
        runOrder.push(rev.reviewRunId);
      }
    }
  }

  const runs: RunExecution[] = [];

  for (const runId of runOrder) {
    const runEvts = runEventsMap.get(runId) || [];
    const matchingReview = reviews?.find((r) => r.reviewRunId === runId);
    const hasReviewEvents = runEvts.some(
      (e) =>
        e.type === "review_started" ||
        e.type === "review_passed" ||
        e.type === "changes_requested",
    );
    const isReview = Boolean(matchingReview) || hasReviewEvents;

    if (isReview) {
      const reviewStartedEvent = runEvts.find((e) => e.type === "review_started");
      const reviewPassedEvent = runEvts.find((e) => e.type === "review_passed");
      const changesRequestedEvent = runEvts.find((e) => e.type === "changes_requested");

      const isPassed = matchingReview?.status === "passed" || Boolean(reviewPassedEvent);
      const isChangesRequested =
        matchingReview?.status === "changes_requested" || Boolean(changesRequestedEvent);
      const isWaived = matchingReview?.status === "waived";

      const startIso = matchingReview?.startedAt || reviewStartedEvent?.createdAt;
      const startMs = startIso ? new Date(startIso).getTime() : NaN;

      if (isNaN(startMs)) {
        runs.push({
          runId,
          kind: "review",
          actorLabel: matchingReview?.reviewerActorLabel ?? runEvts[0]?.actorLabel ?? null,
          startedAt: new Date(NaN),
          status: "incomplete",
          durationMs: null,
        });
        continue;
      }

      const actorLabel =
        matchingReview?.reviewerActorLabel ??
        reviewPassedEvent?.actorLabel ??
        changesRequestedEvent?.actorLabel ??
        reviewStartedEvent?.actorLabel ??
        runEvts[0]?.actorLabel ??
        null;

      if (isPassed || isChangesRequested || isWaived) {
        const endIso =
          matchingReview?.concludedAt ||
          (isPassed ? reviewPassedEvent?.createdAt : undefined) ||
          (isChangesRequested ? changesRequestedEvent?.createdAt : undefined);
        const endMs = endIso ? new Date(endIso).getTime() : NaN;
        const isValidEnd = !isNaN(endMs) && endMs >= startMs;

        runs.push({
          runId,
          kind: "review",
          actorLabel,
          startedAt: new Date(startMs),
          endedAt: isValidEnd ? new Date(endMs) : undefined,
          status: isPassed
            ? "review_passed"
            : isChangesRequested
              ? "changes_requested"
              : "waived",
          durationMs: isValidEnd ? Math.max(0, endMs - startMs) : null,
        });
      } else if (
        matchingReview?.status === "in_progress" ||
        activeReviewRunId === runId ||
        (taskStatus === "in_review" && !matchingReview?.concludedAt)
      ) {
        const elapsed = Math.max(0, nowMs - startMs);
        runs.push({
          runId,
          kind: "review",
          actorLabel,
          startedAt: new Date(startMs),
          status: "reviewing",
          durationMs: elapsed,
        });
      } else {
        runs.push({
          runId,
          kind: "review",
          actorLabel,
          startedAt: new Date(startMs),
          status: "incomplete",
          durationMs: null,
        });
      }
    } else {
      const startedEvent = runEvts.find((e) => e.type === "started");
      if (!startedEvent) {
        runs.push({
          runId,
          kind: "execution",
          actorLabel: runEvts[0]?.actorLabel ?? null,
          startedAt: new Date(NaN),
          status: "incomplete",
          durationMs: null,
        });
        continue;
      }

      const startMs = new Date(startedEvent.createdAt).getTime();
      if (isNaN(startMs)) {
        runs.push({
          runId,
          kind: "execution",
          actorLabel: startedEvent.actorLabel,
          startedAt: new Date(NaN),
          status: "incomplete",
          durationMs: null,
        });
        continue;
      }

      const completedEvent = runEvts.find((e) => e.type === "completed");
      const releasedEvent = runEvts.find((e) => e.type === "released");
      const submittedEvent = runEvts.find((e) => e.type === "submitted_for_review");
      const terminalEvent = completedEvent || releasedEvent || submittedEvent;

      if (terminalEvent) {
        const endMs = new Date(terminalEvent.createdAt).getTime();
        const isValidEnd = !isNaN(endMs) && endMs >= startMs;
        runs.push({
          runId,
          kind: "execution",
          actorLabel: terminalEvent.actorLabel || startedEvent.actorLabel,
          startedAt: new Date(startMs),
          endedAt: isValidEnd ? new Date(endMs) : undefined,
          status:
            terminalEvent.type === "completed"
              ? "completed"
              : terminalEvent.type === "submitted_for_review"
              ? "in_review"
              : "released",
          durationMs: isValidEnd ? Math.max(0, endMs - startMs) : null,
        });
      } else if (
        activeRunId === runId &&
        (taskStatus === "running" || taskStatus === "blocked")
      ) {
        const elapsed = Math.max(0, nowMs - startMs);
        runs.push({
          runId,
          kind: "execution",
          actorLabel: startedEvent.actorLabel,
          startedAt: new Date(startMs),
          status: "running",
          durationMs: elapsed,
        });
      } else {
        runs.push({
          runId,
          kind: "execution",
          actorLabel: startedEvent.actorLabel,
          startedAt: new Date(startMs),
          status: "incomplete",
          durationMs: null,
        });
      }
    }
  }

  return runs;
}
