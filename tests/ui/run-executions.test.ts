import { describe, expect, it } from "vitest";

import type { TaskEvent, TaskReview } from "../../ui/src/types.js";
import {
  computeRunExecutions,
  formatDuration,
} from "../../ui/src/utils/runExecutions.js";

describe("runExecutions pairing and duration computation", () => {
  describe("formatDuration", () => {
    it("formats durations accurately across seconds, minutes, hours, and days", () => {
      expect(formatDuration(-100)).toBe("0秒");
      expect(formatDuration(0)).toBe("0秒");
      expect(formatDuration(45_000)).toBe("45秒");
      expect(formatDuration(60_000)).toBe("1分");
      expect(formatDuration(61_717)).toBe("1分1秒");
      expect(formatDuration(120_040)).toBe("2分");
      expect(formatDuration(195_340)).toBe("3分15秒");
      expect(formatDuration(3_600_000)).toBe("1小时");
      expect(formatDuration(3_660_000)).toBe("1小时1分");
      expect(formatDuration(86_400_000)).toBe("1天");
      expect(formatDuration(90_000_000)).toBe("1天1小时");
    });
  });

  describe("审核通过 (Review passed)", () => {
    it("pairs review run with review_passed and concludedAt without data loss", () => {
      const reviewRunId = "rev-pass-1";
      const startIso = "2026-10-12T10:00:00.000Z";
      const endIso = "2026-10-12T10:02:15.000Z";

      const events: TaskEvent[] = [
        {
          id: "evt-1",
          projectId: "p1",
          taskId: "t1",
          runId: reviewRunId,
          type: "review_started",
          summary: "Started review",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "reviewer-bot",
          createdAt: startIso,
        },
        {
          id: "evt-2",
          projectId: "p1",
          taskId: "t1",
          runId: reviewRunId,
          type: "review_passed",
          summary: "Review passed",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "reviewer-bot",
          createdAt: endIso,
        },
      ];

      const reviews: TaskReview[] = [
        {
          id: "r-1",
          projectId: "p1",
          taskId: "t1",
          reviewRound: 1,
          commitSha: "a".repeat(40),
          branch: "main",
          worktree: "/tmp",
          reviewRunId,
          status: "passed",
          reviewerActorLabel: "reviewer-bot",
          summary: "Passed",
          findings: [],
          verificationEvidence: [],
          integrationRequired: true,
          integrationTargetBranch: "main",
          integrationNotRequiredReason: null,
          approvedAt: null,
          approvedBy: null,
          integrationStatus: null,
          integrationMessage: null,
          integrationTargetCommitSha: null,
          integrationCheckedAt: null,
          createdAt: startIso,
          startedAt: startIso,
          concludedAt: endIso,
          updatedAt: endIso,
        },
      ];

      const runs = computeRunExecutions(events, null, "completed", Date.now(), reviews);
      expect(runs).toHaveLength(1);
      const reviewRun = runs[0]!;
      expect(reviewRun.runId).toBe(reviewRunId);
      expect(reviewRun.kind).toBe("review");
      expect(reviewRun.status).toBe("review_passed");
      expect(reviewRun.actorLabel).toBe("reviewer-bot");
      expect(reviewRun.durationMs).toBe(135_000); // 2m 15s
      expect(formatDuration(reviewRun.durationMs!)).toBe("2分15秒");
      expect(reviewRun.endedAt).toEqual(new Date(endIso));
    });

    it("falls back to review events when reviews array is not provided", () => {
      const reviewRunId = "rev-pass-fallback";
      const startIso = "2026-10-12T10:00:00.000Z";
      const endIso = "2026-10-12T10:01:05.000Z";

      const events: TaskEvent[] = [
        {
          id: "e-1",
          projectId: "p1",
          taskId: "t1",
          runId: reviewRunId,
          type: "review_started",
          summary: "Started review",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "codex",
          createdAt: startIso,
        },
        {
          id: "e-2",
          projectId: "p1",
          taskId: "t1",
          runId: reviewRunId,
          type: "review_passed",
          summary: "Review passed",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "codex",
          createdAt: endIso,
        },
      ];

      const runs = computeRunExecutions(events, null, "completed", Date.now());
      expect(runs).toHaveLength(1);
      const run = runs[0]!;
      expect(run.status).toBe("review_passed");
      expect(run.durationMs).toBe(65_000);
      expect(formatDuration(run.durationMs!)).toBe("1分5秒");
    });
  });

  describe("要求修改 (Changes requested)", () => {
    it("pairs review run with changes_requested and computes duration correctly", () => {
      const reviewRunId = "rev-cr-1";
      const startIso = "2026-10-12T12:00:00.000Z";
      const endIso = "2026-10-12T12:02:00.000Z";

      const events: TaskEvent[] = [
        {
          id: "e-1",
          projectId: "p1",
          taskId: "t1",
          runId: reviewRunId,
          type: "review_started",
          summary: "Started review",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "reviewer",
          createdAt: startIso,
        },
        {
          id: "e-2",
          projectId: "p1",
          taskId: "t1",
          runId: reviewRunId,
          type: "changes_requested",
          summary: "Changes needed",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "reviewer",
          createdAt: endIso,
        },
      ];

      const reviews: TaskReview[] = [
        {
          id: "r-cr",
          projectId: "p1",
          taskId: "t1",
          reviewRound: 1,
          commitSha: "b".repeat(40),
          branch: "task/branch",
          worktree: "/tmp",
          reviewRunId,
          status: "changes_requested",
          reviewerActorLabel: "reviewer",
          summary: "Changes needed",
          findings: [],
          verificationEvidence: [],
          integrationRequired: true,
          integrationTargetBranch: "main",
          integrationNotRequiredReason: null,
          approvedAt: null,
          approvedBy: null,
          integrationStatus: null,
          integrationMessage: null,
          integrationTargetCommitSha: null,
          integrationCheckedAt: null,
          createdAt: startIso,
          startedAt: startIso,
          concludedAt: endIso,
          updatedAt: endIso,
        },
      ];

      const runs = computeRunExecutions(events, null, "ready", Date.now(), reviews);
      expect(runs).toHaveLength(1);
      const run = runs[0]!;
      expect(run.kind).toBe("review");
      expect(run.status).toBe("changes_requested");
      expect(run.durationMs).toBe(120_000);
      expect(formatDuration(run.durationMs!)).toBe("2分");
    });
  });

  describe("审核进行中 (Review in progress)", () => {
    it("marks review in progress as reviewing with elapsed duration up to now", () => {
      const reviewRunId = "rev-ongoing-1";
      const startMs = 1700000000000;
      const nowMs = startMs + 95_000; // 1m 35s later
      const startIso = new Date(startMs).toISOString();

      const events: TaskEvent[] = [
        {
          id: "e-1",
          projectId: "p1",
          taskId: "t1",
          runId: reviewRunId,
          type: "review_started",
          summary: "Reviewing",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "reviewer-bot",
          createdAt: startIso,
        },
      ];

      const reviews: TaskReview[] = [
        {
          id: "r-prog",
          projectId: "p1",
          taskId: "t1",
          reviewRound: 1,
          commitSha: "c".repeat(40),
          branch: "main",
          worktree: "/tmp",
          reviewRunId,
          status: "in_progress",
          reviewerActorLabel: "reviewer-bot",
          summary: null,
          findings: [],
          verificationEvidence: [],
          integrationRequired: true,
          integrationTargetBranch: "main",
          integrationNotRequiredReason: null,
          approvedAt: null,
          approvedBy: null,
          integrationStatus: null,
          integrationMessage: null,
          integrationTargetCommitSha: null,
          integrationCheckedAt: null,
          createdAt: startIso,
          startedAt: startIso,
          concludedAt: null,
          updatedAt: startIso,
        },
      ];

      const runs = computeRunExecutions(
        events,
        null,
        "in_review",
        nowMs,
        reviews,
        reviewRunId,
      );

      expect(runs).toHaveLength(1);
      const run = runs[0]!;
      expect(run.kind).toBe("review");
      expect(run.status).toBe("reviewing");
      expect(run.durationMs).toBe(95_000);
      expect(formatDuration(run.durationMs!)).toBe("1分35秒");
      expect(run.endedAt).toBeUndefined();
    });
  });

  describe("执行领取与审核 runId 分开 (Separation of execution and review runs)", () => {
    it("ensures completed event on reviewRunId does not alter execution run duration", () => {
      const execRunId = "exec-run-1";
      const reviewRunId = "review-run-1";

      const execStartIso = "2026-10-12T08:00:00.000Z";
      const execSubmitIso = "2026-10-12T08:15:00.000Z"; // 15 mins execution
      const reviewStartIso = "2026-10-12T08:16:00.000Z";
      const reviewConcludeIso = "2026-10-12T08:18:00.000Z"; // 2 mins review

      const events: TaskEvent[] = [
        {
          id: "e-1",
          projectId: "p1",
          taskId: "t1",
          runId: execRunId,
          type: "started",
          summary: "Started",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "implementer",
          createdAt: execStartIso,
        },
        {
          id: "e-2",
          projectId: "p1",
          taskId: "t1",
          runId: execRunId,
          type: "submitted_for_review",
          summary: "Submitted",
          completedWork: ["Work done"],
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "implementer",
          createdAt: execSubmitIso,
        },
        {
          id: "e-3",
          projectId: "p1",
          taskId: "t1",
          runId: reviewRunId,
          type: "review_started",
          summary: "Review started",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "ai-reviewer",
          createdAt: reviewStartIso,
        },
        {
          id: "e-4",
          projectId: "p1",
          taskId: "t1",
          runId: reviewRunId,
          type: "review_passed",
          summary: "Review passed",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "ai-reviewer",
          createdAt: reviewConcludeIso,
        },
        // In low-risk auto completion, completed is inserted on reviewRunId
        {
          id: "e-5",
          projectId: "p1",
          taskId: "t1",
          runId: reviewRunId,
          type: "completed",
          summary: "Task completed",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "ai-reviewer",
          createdAt: reviewConcludeIso,
        },
      ];

      const reviews: TaskReview[] = [
        {
          id: "r-1",
          projectId: "p1",
          taskId: "t1",
          reviewRound: 1,
          commitSha: "d".repeat(40),
          branch: "task/t1",
          worktree: "/tmp",
          reviewRunId,
          status: "passed",
          reviewerActorLabel: "ai-reviewer",
          summary: "Passed",
          findings: [],
          verificationEvidence: [],
          integrationRequired: true,
          integrationTargetBranch: "main",
          integrationNotRequiredReason: null,
          approvedAt: null,
          approvedBy: null,
          integrationStatus: null,
          integrationMessage: null,
          integrationTargetCommitSha: null,
          integrationCheckedAt: null,
          createdAt: execSubmitIso,
          startedAt: reviewStartIso,
          concludedAt: reviewConcludeIso,
          updatedAt: reviewConcludeIso,
        },
      ];

      const runs = computeRunExecutions(events, null, "completed", Date.now(), reviews);
      expect(runs).toHaveLength(2);

      const execRun = runs[0]!;
      const revRun = runs[1]!;

      // Execution run checks:
      expect(execRun.runId).toBe(execRunId);
      expect(execRun.kind).toBe("execution");
      expect(execRun.status).toBe("in_review");
      expect(execRun.actorLabel).toBe("implementer");
      expect(execRun.durationMs).toBe(15 * 60 * 1000); // exactly 15 mins (not modified by review completion)
      expect(formatDuration(execRun.durationMs!)).toBe("15分");

      // Review run checks:
      expect(revRun.runId).toBe(reviewRunId);
      expect(revRun.kind).toBe("review");
      expect(revRun.status).toBe("review_passed");
      expect(revRun.actorLabel).toBe("ai-reviewer");
      expect(revRun.durationMs).toBe(2 * 60 * 1000); // exactly 2 mins
      expect(formatDuration(revRun.durationMs!)).toBe("2分");
    });
  });

  describe("任务 e3449f72-90af-45d8-8dac-1cad2f094819 真实历史事件回放", () => {
    it("correctly calculates durations for 6c5333ec (~2m) and 1fc81a04 (~1m) without data loss", () => {
      const events: TaskEvent[] = [
        {
          id: "e-rel-1",
          projectId: "e71858fb",
          taskId: "e3449f72",
          runId: "ae31f2b3-ba0c-4c55-bfbc-34a4ec3405b2",
          type: "started",
          summary: "Started",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "claude-opus-4-6",
          createdAt: "2026-10-12T13:35:32.453Z",
        },
        {
          id: "e-rel-2",
          projectId: "e71858fb",
          taskId: "e3449f72",
          runId: "ae31f2b3-ba0c-4c55-bfbc-34a4ec3405b2",
          type: "released",
          summary: "Released",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "developer",
          createdAt: "2026-10-12T17:58:21.664Z",
        },
        {
          id: "e-sub1-1",
          projectId: "e71858fb",
          taskId: "e3449f72",
          runId: "a09c1451-00d5-4a8f-955c-43b03000644e",
          type: "started",
          summary: "Started",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "gemini-3.8-flash",
          createdAt: "2026-10-12T17:59:57.522Z",
        },
        {
          id: "e-sub1-2",
          projectId: "e71858fb",
          taskId: "e3449f72",
          runId: "a09c1451-00d5-4a8f-955c-43b03000644e",
          type: "submitted_for_review",
          summary: "Submitted for review round 1",
          completedWork: ["initial work"],
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "gemini-3.8-flash",
          createdAt: "2026-10-12T18:16:00.007Z",
        },
        {
          id: "e-rev1-1",
          projectId: "e71858fb",
          taskId: "e3449f72",
          runId: "6c5333ec-4868-4c37-9733-f91767cf1e72",
          type: "review_started",
          summary: "Started AI review round 1",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "codex",
          createdAt: "2026-10-12T18:16:53.514Z",
        },
        {
          id: "e-rev1-2",
          projectId: "e71858fb",
          taskId: "e3449f72",
          runId: "6c5333ec-4868-4c37-9733-f91767cf1e72",
          type: "changes_requested",
          summary: "Requested changes",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "codex",
          createdAt: "2026-10-12T18:18:53.554Z",
        },
        {
          id: "e-sub2-1",
          projectId: "e71858fb",
          taskId: "e3449f72",
          runId: "aefbce2b-257e-448d-83c4-e03d2b45fa36",
          type: "started",
          summary: "Started second claim",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "gemini-3.8-flash",
          createdAt: "2026-10-12T18:21:33.151Z",
        },
        {
          id: "e-sub2-2",
          projectId: "e71858fb",
          taskId: "e3449f72",
          runId: "aefbce2b-257e-448d-83c4-e03d2b45fa36",
          type: "submitted_for_review",
          summary: "Submitted for review round 2",
          completedWork: ["follow-up fixes"],
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "gemini-3.8-flash",
          createdAt: "2026-10-12T18:24:48.491Z",
        },
        {
          id: "e-rev2-1",
          projectId: "e71858fb",
          taskId: "e3449f72",
          runId: "1fc81a04-05de-454e-8c8a-47ae8848b450",
          type: "review_started",
          summary: "Started AI review round 2",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "codex",
          createdAt: "2026-10-12T18:25:37.151Z",
        },
        {
          id: "e-rev2-2",
          projectId: "e71858fb",
          taskId: "e3449f72",
          runId: "1fc81a04-05de-454e-8c8a-47ae8848b450",
          type: "review_passed",
          summary: "Passed AI review round 2",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "codex",
          createdAt: "2026-10-12T18:26:38.868Z",
        },
      ];

      const reviews: TaskReview[] = [
        {
          id: "rev-r1",
          projectId: "e71858fb",
          taskId: "e3449f72",
          reviewRound: 1,
          commitSha: "d5556af9b57914b2a91d8816069911959f1fb4ff",
          branch: "task/e3449f72-agy-mcp-discover",
          worktree: "/Users/superyang/Projects/MileStack",
          reviewRunId: "6c5333ec-4868-4c37-9733-f91767cf1e72",
          status: "changes_requested",
          reviewerActorLabel: "codex",
          summary: "Requested changes",
          findings: [],
          verificationEvidence: [],
          integrationRequired: true,
          integrationTargetBranch: "main",
          integrationNotRequiredReason: null,
          approvedAt: null,
          approvedBy: null,
          integrationStatus: null,
          integrationMessage: null,
          integrationTargetCommitSha: null,
          integrationCheckedAt: null,
          createdAt: "2026-10-12T18:16:00.007Z",
          startedAt: "2026-10-12T18:16:53.514Z",
          concludedAt: "2026-10-12T18:18:53.554Z",
          updatedAt: "2026-10-12T18:18:53.554Z",
        },
        {
          id: "rev-r2",
          projectId: "e71858fb",
          taskId: "e3449f72",
          reviewRound: 2,
          commitSha: "ba2ef318ec85bbfa4a4d258d7c71b99410372892",
          branch: "task/e3449f72-agy-mcp-discover",
          worktree: "/Users/superyang/Projects/MileStack",
          reviewRunId: "1fc81a04-05de-454e-8c8a-47ae8848b450",
          status: "passed",
          reviewerActorLabel: "codex",
          summary: "Passed",
          findings: [],
          verificationEvidence: [],
          integrationRequired: true,
          integrationTargetBranch: "main",
          integrationNotRequiredReason: null,
          approvedAt: null,
          approvedBy: null,
          integrationStatus: null,
          integrationMessage: null,
          integrationTargetCommitSha: null,
          integrationCheckedAt: null,
          createdAt: "2026-10-12T18:24:48.491Z",
          startedAt: "2026-10-12T18:25:37.151Z",
          concludedAt: "2026-10-12T18:26:38.868Z",
          updatedAt: "2026-10-12T18:26:38.868Z",
        },
      ];

      const runs = computeRunExecutions(events, null, "completed", Date.now(), reviews);
      expect(runs).toHaveLength(5);

      const run0 = runs[0]!;
      const run1 = runs[1]!;
      const run2 = runs[2]!;
      const run3 = runs[3]!;
      const run4 = runs[4]!;

      // Run 1: ae31f2b3 (released)
      expect(run0.runId).toBe("ae31f2b3-ba0c-4c55-bfbc-34a4ec3405b2");
      expect(run0.kind).toBe("execution");
      expect(run0.status).toBe("released");
      expect(run0.durationMs).not.toBeNull();

      // Run 2: a09c1451 (in_review round 1)
      expect(run1.runId).toBe("a09c1451-00d5-4a8f-955c-43b03000644e");
      expect(run1.kind).toBe("execution");
      expect(run1.status).toBe("in_review");
      expect(formatDuration(run1.durationMs!)).toBe("16分2秒");

      // Run 3: 6c5333ec (review round 1, changes_requested)
      expect(run2.runId).toBe("6c5333ec-4868-4c37-9733-f91767cf1e72");
      expect(run2.kind).toBe("review");
      expect(run2.status).toBe("changes_requested");
      expect(run2.durationMs).toBe(120_040);
      expect(formatDuration(run2.durationMs!)).toBe("2分");

      // Run 4: aefbce2b (in_review round 2)
      expect(run3.runId).toBe("aefbce2b-257e-448d-83c4-e03d2b45fa36");
      expect(run3.kind).toBe("execution");
      expect(run3.status).toBe("in_review");
      expect(formatDuration(run3.durationMs!)).toBe("3分15秒");

      // Run 5: 1fc81a04 (review round 2, review_passed)
      expect(run4.runId).toBe("1fc81a04-05de-454e-8c8a-47ae8848b450");
      expect(run4.kind).toBe("review");
      expect(run4.status).toBe("review_passed");
      expect(run4.durationMs).toBe(61_717);
      expect(formatDuration(run4.durationMs!)).toBe("1分1秒");
    });
  });
});
