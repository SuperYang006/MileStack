import { describe, expect, it } from "vitest";

import type { ReviewDigest, TaskSummary } from "../../ui/src/types.js";
import { isReworkTask, reworkTasksFor } from "../../ui/src/utils/rework.js";

function reviewDigest(overrides: Partial<ReviewDigest> = {}): ReviewDigest {
  return {
    id: "review-1",
    status: "changes_requested",
    reviewRound: 2,
    commitSha: "1".repeat(40),
    reviewerActorLabel: "reviewer",
    branch: "main",
    worktree: "/tmp/project",
    summary: "请补充边界测试",
    createdAt: "2026-10-27T00:00:00.000Z",
    acceptanceCriteriaCount: 2,
    verificationEvidenceCount: 1,
    findingsCount: 1,
    integrationRequired: true,
    integrationTargetBranch: "main",
    integrationNotRequiredReason: null,
    approvedAt: null,
    integrationStatus: null,
    integrationMessage: null,
    integrationTargetCommitSha: null,
    integrationCheckedAt: null,
    ...overrides,
  };
}

function taskSummary(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: "task-1",
    projectId: "project-1",
    title: "任务",
    status: "ready",
    queuePosition: 1,
    dependencyIds: [],
    waitingFor: [],
    runnable: true,
    currentStep: null,
    nextStep: null,
    blocker: null,
    requiredAction: null,
    updatedAt: "2026-10-27T00:00:00.000Z",
    completedAt: null,
    integrationRequired: true,
    integrationTargetBranch: "main",
    integrationNotRequiredReason: null,
    latestReview: null,
    ...overrides,
  };
}

describe("rework queue derivation", () => {
  it("marks only ready tasks whose latest review requested changes", () => {
    expect(
      isReworkTask(
        taskSummary({ id: "rework", latestReview: reviewDigest({ reviewRound: 3 }) }),
      ),
    ).toBe(true);
    expect(
      isReworkTask(
        taskSummary({
          id: "passed",
          latestReview: reviewDigest({ status: "passed", reviewRound: 3 }),
        }),
      ),
    ).toBe(false);
    expect(
      isReworkTask(
        taskSummary({
          id: "running",
          status: "running",
          latestReview: reviewDigest({ reviewRound: 3 }),
        }),
      ),
    ).toBe(false);
    expect(isReworkTask(taskSummary({ id: "new-task", latestReview: null }))).toBe(false);
  });

  it("keeps the existing ready-queue order and ignores ordinary tasks", () => {
    const first = taskSummary({ id: "rework-1", latestReview: reviewDigest({ reviewRound: 1 }) });
    const ordinary = taskSummary({ id: "ordinary" });
    const second = taskSummary({ id: "rework-2", latestReview: reviewDigest({ reviewRound: 2 }) });

    expect(reworkTasksFor([first, ordinary, second]).map((task) => task.id)).toEqual([
      "rework-1",
      "rework-2",
    ]);
    expect(reworkTasksFor([first, ordinary, second])).toHaveLength(2);
    expect(reworkTasksFor([ordinary])).toHaveLength(0);
  });
});
