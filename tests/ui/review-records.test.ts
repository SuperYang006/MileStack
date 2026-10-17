import { describe, expect, it } from "vitest";

import type { TaskEvent, TaskReview } from "../../ui/src/types.js";
import {
  buildCriterionResultDisplays,
  buildFindingClosureDisplays,
  buildFindingDisplays,
  findingsAwaitingClosure,
} from "../../ui/src/utils/reviewRecords.js";

function taskEvent(overrides: Partial<TaskEvent> = {}): TaskEvent {
  return {
    id: "event-1",
    projectId: "project-1",
    taskId: "task-1",
    runId: "run-1",
    type: "submitted_for_review",
    summary: "Submitted",
    completedWork: null,
    currentStep: null,
    nextStep: null,
    blocker: null,
    requiredAction: null,
    handoffNote: null,
    actorLabel: "agent",
    createdAt: "2026-10-17T00:00:00.000Z",
    ...overrides,
  };
}

function taskReview(overrides: Partial<TaskReview> = {}): TaskReview {
  return {
    id: "review-1",
    projectId: "project-1",
    taskId: "task-1",
    reviewRound: 1,
    commitSha: "1".repeat(40),
    branch: "main",
    worktree: "/tmp/project",
    reviewRunId: null,
    status: "changes_requested",
    reviewerActorLabel: "reviewer",
    summary: null,
    findings: [],
    findingClosures: [],
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
    createdAt: "2026-10-17T00:00:00.000Z",
    startedAt: null,
    concludedAt: null,
    updatedAt: "2026-10-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("task detail structured review records", () => {
  it("maps every criterion result with its original text, distinguishable status, and evidence", () => {
    const event = taskEvent({
      criteriaResults: [
        {
          criterion: "满足的标准原文",
          status: "met",
          evidence: [{ command: "pnpm test", result: "passed" }],
        },
        {
          criterion: "不满足的标准原文",
          status: "not_met",
          evidence: [{ command: "pnpm test", result: "failed" }],
        },
        {
          criterion: "无法验证的标准原文",
          status: "unverifiable",
          evidence: [],
        },
      ],
    });

    const displays = buildCriterionResultDisplays(event);
    expect(displays.map((display) => display.criterion)).toEqual([
      "满足的标准原文",
      "不满足的标准原文",
      "无法验证的标准原文",
    ]);
    expect(displays.map((display) => display.statusLabel)).toEqual([
      "满足",
      "不满足",
      "无法验证",
    ]);
    expect(new Set(displays.map((display) => display.tone)).size).toBe(3);
    expect(displays[0]?.evidence).toEqual([
      { command: "pnpm test", result: "passed" },
    ]);
    expect(displays[2]?.evidence).toEqual([]);
  });

  it("keeps duplicate criterion texts distinguishable through unique keys", () => {
    const event = taskEvent({
      criteriaResults: [
        { criterion: "重复原文", status: "met", evidence: [] },
        { criterion: "重复原文", status: "not_met", evidence: [] },
      ],
    });

    const displays = buildCriterionResultDisplays(event);
    expect(displays).toHaveLength(2);
    expect(displays[0]?.key).not.toBe(displays[1]?.key);
  });

  it("shows structured finding fields and tolerates a missing location", () => {
    const review = taskReview({
      findings: [
        {
          issue: "有位置的发现",
          suggestion: "修复它",
          severity: "high",
          trigger: "执行失败路径时",
          impact: "审核结果不可信",
          evidence: "pnpm test 失败输出",
          location: "src/core/task-service.ts:100",
        },
        {
          issue: "没有位置的发现",
          suggestion: "补充测试",
          severity: "low",
          trigger: "复审时",
          impact: "回归可能漏检",
          evidence: "缺少覆盖",
        },
      ],
    });

    const displays = buildFindingDisplays(review);
    expect(displays).toHaveLength(2);
    expect(displays[0]).toMatchObject({
      issue: "有位置的发现",
      trigger: "执行失败路径时",
      impact: "审核结果不可信",
      evidence: "pnpm test 失败输出",
      location: "src/core/task-service.ts:100",
    });
    expect(displays[1]).toMatchObject({
      issue: "没有位置的发现",
      trigger: "复审时",
      impact: "回归可能漏检",
      evidence: "缺少覆盖",
    });
    expect(displays[1]?.location).toBeUndefined();
    expect(displays[0]?.key).not.toBe(displays[1]?.key);
  });

  it("resolves closures against the previous round and labels every status", () => {
    const previous = taskReview({
      id: "review-round-1",
      reviewRound: 1,
      findings: [
        { issue: "第一条旧发现", suggestion: "A", severity: "high" },
        { issue: "第二条旧发现", suggestion: "B", severity: "medium" },
        { issue: "第三条旧发现", suggestion: "C", severity: "low" },
      ],
    });
    const current = taskReview({
      id: "review-round-2",
      reviewRound: 2,
      findingClosures: [
        { findingIndex: 0, status: "fixed", evidence: [{ command: "pnpm test", result: "passed" }] },
        { findingIndex: 1, status: "partially_fixed", evidence: [] },
        { findingIndex: 2, status: "not_fixed", evidence: [] },
      ],
    });
    const unverifiable = taskReview({
      id: "review-round-3",
      reviewRound: 3,
      findingClosures: [{ findingIndex: 9, status: "unverifiable", evidence: [] }],
    });
    const invalidated = taskReview({
      id: "review-round-4",
      reviewRound: 4,
      findingClosures: [{ findingIndex: 0, status: "invalidated", evidence: [] }],
    });

    const reviews = [previous, current, unverifiable, invalidated];
    const closures = buildFindingClosureDisplays(reviews, current);
    expect(closures.map((closure) => closure.issue)).toEqual([
      "第一条旧发现",
      "第二条旧发现",
      "第三条旧发现",
    ]);
    expect(closures.map((closure) => closure.statusLabel)).toEqual([
      "已修复",
      "部分修复",
      "未修复",
    ]);
    expect(new Set(closures.map((closure) => closure.tone)).size).toBe(3);
    expect(closures[0]?.evidence).toEqual([
      { command: "pnpm test", result: "passed" },
    ]);

    const outOfRange = buildFindingClosureDisplays(reviews, unverifiable);
    expect(outOfRange).toEqual([
      expect.objectContaining({
        findingIndex: 9,
        issue: null,
        statusLabel: "无法验证",
      }),
    ]);

    const invalidatedDisplay = buildFindingClosureDisplays(reviews, invalidated);
    expect(invalidatedDisplay).toEqual([
      expect.objectContaining({
        findingIndex: 0,
        issue: null,
        statusLabel: "原发现不成立",
      }),
    ]);
  });

  it("keeps legacy submissions and findings displayable without structured fields", () => {
    const legacyEvent = taskEvent({ completedWork: ["旧完成项"] });
    expect(buildCriterionResultDisplays(legacyEvent)).toEqual([]);

    const legacyReview = taskReview({
      findings: [
        { issue: "旧发现", suggestion: "旧建议", severity: "medium" },
      ],
    });
    const displays = buildFindingDisplays(legacyReview);
    expect(displays).toEqual([
      expect.objectContaining({
        issue: "旧发现",
        suggestion: "旧建议",
        severity: "medium",
      }),
    ]);
    expect(displays[0]?.trigger).toBeUndefined();
    expect(displays[0]?.impact).toBeUndefined();
    expect(displays[0]?.evidence).toBeUndefined();
    expect(displays[0]?.location).toBeUndefined();

    expect(buildFindingClosureDisplays([legacyReview], legacyReview)).toEqual([]);
  });

  it("collects closure inputs only from the immediately previous changes-requested round", () => {
    expect(findingsAwaitingClosure(undefined)).toEqual([]);

    const singleReview = [taskReview({ status: "pending" })];
    expect(findingsAwaitingClosure(singleReview)).toEqual([]);

    const passedPrevious = [
      taskReview({
        id: "review-1",
        reviewRound: 1,
        status: "passed",
        findings: [{ issue: "不该收集", suggestion: "A", severity: "low" }],
      }),
      taskReview({ id: "review-2", reviewRound: 2, status: "pending" }),
    ];
    expect(findingsAwaitingClosure(passedPrevious)).toEqual([]);

    const returnedPrevious = [
      taskReview({
        id: "review-1",
        reviewRound: 1,
        status: "changes_requested",
        findings: [
          { issue: "上一轮发现一", suggestion: "A", severity: "high" },
          { issue: "上一轮发现二", suggestion: "B", severity: "medium" },
        ],
      }),
      taskReview({ id: "review-2", reviewRound: 2, status: "pending" }),
    ];
    expect(
      findingsAwaitingClosure(returnedPrevious).map((finding) => finding.issue),
    ).toEqual(["上一轮发现一", "上一轮发现二"]);
  });
});
