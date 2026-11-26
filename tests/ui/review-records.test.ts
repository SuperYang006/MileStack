import { describe, expect, it } from "vitest";

import type {
  BatchIntegrationCheckResult,
  ReviewDigest,
  TaskEvent,
  TaskReview,
  TaskSummary,
} from "../../ui/src/types.js";
import {
  buildCriterionResultDisplays,
  buildFindingClosureDisplays,
  buildFindingDisplays,
  findingsAwaitingClosure,
  isTaskCheckableForIntegration,
  selectIntegrationCheckTargets,
  shouldShowBatchIntegrationButton,
  summarizeBatchIntegrationResult,
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

  it("derives batch integration button visibility and targets from checkable tasks", () => {
    const digest = (overrides: Partial<ReviewDigest> = {}): ReviewDigest => ({
      id: "review-1",
      status: "passed",
      reviewRound: 1,
      commitSha: "1".repeat(40),
      reviewerActorLabel: "reviewer",
      branch: "main",
      worktree: "/tmp/project",
      summary: "Passed",
      createdAt: "2026-10-17T00:00:00.000Z",
      acceptanceCriteriaCount: 1,
      verificationEvidenceCount: 1,
      findingsCount: 0,
      integrationRequired: true,
      integrationTargetBranch: "main",
      integrationNotRequiredReason: null,
      approvedAt: "2026-10-17T00:01:00.000Z",
      integrationStatus: "not_integrated",
      integrationMessage: "未检测到审核提交进入本地 'main'。",
      integrationTargetCommitSha: null,
      integrationCheckedAt: null,
      ...overrides,
    });
    const inReviewTask = (overrides: Partial<TaskSummary> = {}): TaskSummary => ({
      id: "task-1",
      projectId: "project-1",
      title: "Review item",
      status: "in_review",
      queuePosition: null,
      dependencyIds: [],
      waitingFor: [],
      runnable: false,
      currentStep: null,
      nextStep: null,
      blocker: null,
      requiredAction: null,
      updatedAt: "2026-10-17T00:00:00.000Z",
      completedAt: null,
      riskLevel: "medium",
      riskConfirmed: true,
      integrationRequired: true,
      integrationTargetBranch: "main",
      integrationNotRequiredReason: null,
      latestReview: digest(),
      ...overrides,
    });

    const lowAutoCheckable = inReviewTask({
      id: "low-auto",
      riskLevel: "low",
      riskConfirmed: true,
      latestReview: digest({
        id: "rev-low",
        approvedAt: null,
        integrationStatus: "not_integrated",
      }),
    });
    const mediumApprovedCheckable = inReviewTask({
      id: "medium-approved",
      riskLevel: "medium",
      latestReview: digest({
        id: "rev-medium",
        integrationStatus: "unavailable",
      }),
    });
    const waivedCheckable = inReviewTask({
      id: "waived-checkable",
      riskLevel: "high",
      latestReview: digest({
        id: "rev-waived",
        status: "waived",
        approvedAt: "2026-10-17T00:02:00.000Z",
        integrationStatus: null,
      }),
    });
    const unapprovedMedium = inReviewTask({
      id: "unapproved-medium",
      riskLevel: "medium",
      latestReview: digest({ id: "rev-unapproved", approvedAt: null }),
    });
    const pendingReview = inReviewTask({
      id: "pending-review",
      latestReview: digest({ id: "rev-pending", status: "pending", approvedAt: null }),
    });
    const noIntegrationNeeded = inReviewTask({
      id: "no-integration",
      integrationRequired: false,
      latestReview: digest({
        id: "rev-no-int",
        integrationRequired: false,
        integrationStatus: "not_required",
      }),
    });
    const alreadyIntegrated = inReviewTask({
      id: "already-integrated",
      latestReview: digest({
        id: "rev-integrated",
        integrationStatus: "integrated",
      }),
    });
    const notInReviewStatus = inReviewTask({
      id: "completed-task",
      status: "completed",
      latestReview: digest({ id: "rev-completed" }),
    });

    expect(isTaskCheckableForIntegration(lowAutoCheckable)).toBe(true);
    expect(isTaskCheckableForIntegration(mediumApprovedCheckable)).toBe(true);
    expect(isTaskCheckableForIntegration(waivedCheckable)).toBe(true);
    expect(isTaskCheckableForIntegration(unapprovedMedium)).toBe(false);
    expect(isTaskCheckableForIntegration(pendingReview)).toBe(false);
    expect(isTaskCheckableForIntegration(noIntegrationNeeded)).toBe(false);
    expect(isTaskCheckableForIntegration(alreadyIntegrated)).toBe(false);
    expect(isTaskCheckableForIntegration(notInReviewStatus)).toBe(false);

    expect(shouldShowBatchIntegrationButton([])).toBe(false);
    expect(
      shouldShowBatchIntegrationButton([unapprovedMedium, pendingReview, noIntegrationNeeded]),
    ).toBe(false);
    expect(
      shouldShowBatchIntegrationButton([lowAutoCheckable, unapprovedMedium, alreadyIntegrated]),
    ).toBe(false);

    const mixedQueue = [
      lowAutoCheckable,
      unapprovedMedium,
      pendingReview,
      mediumApprovedCheckable,
      waivedCheckable,
    ];
    expect(shouldShowBatchIntegrationButton(mixedQueue)).toBe(true);
    expect(selectIntegrationCheckTargets(mixedQueue)).toEqual([
      { taskId: "low-auto", expectedReviewId: "rev-low" },
      { taskId: "medium-approved", expectedReviewId: "rev-medium" },
      { taskId: "waived-checkable", expectedReviewId: "rev-waived" },
    ]);
  });

  it("summarizes batch integration results cleanly across full and partial outcomes", () => {
    const allArchived: BatchIntegrationCheckResult = {
      counts: { total: 2, completed: 2, notIntegrated: 0, unavailable: 0, error: 0 },
      results: [
        {
          taskId: "t1",
          expectedReviewId: "r1",
          status: "completed",
          taskStatus: "completed",
          integrationStatus: "integrated",
          integrationMessage: null,
          integrationTargetCommitSha: "a".repeat(40),
          error: null,
        },
        {
          taskId: "t2",
          expectedReviewId: "r2",
          status: "completed",
          taskStatus: "completed",
          integrationStatus: "integrated",
          integrationMessage: null,
          integrationTargetCommitSha: "a".repeat(40),
          error: null,
        },
      ],
    };
    expect(summarizeBatchIntegrationResult(allArchived)).toBeNull();

    const partialArchived: BatchIntegrationCheckResult = {
      counts: { total: 4, completed: 1, notIntegrated: 1, unavailable: 1, error: 1 },
      results: [
        {
          taskId: "t1",
          expectedReviewId: "r1",
          status: "completed",
          taskStatus: "completed",
          integrationStatus: "integrated",
          integrationMessage: null,
          integrationTargetCommitSha: "a".repeat(40),
          error: null,
        },
        {
          taskId: "t2",
          expectedReviewId: "r2",
          status: "not_integrated",
          taskStatus: "in_review",
          integrationStatus: "not_integrated",
          integrationMessage: "未检测到审核提交进入本地 'main'。",
          integrationTargetCommitSha: "b".repeat(40),
          error: null,
        },
        {
          taskId: "t3",
          expectedReviewId: "r3",
          status: "unavailable",
          taskStatus: "in_review",
          integrationStatus: "unavailable",
          integrationMessage: "仓库目录不可访问",
          integrationTargetCommitSha: null,
          error: null,
        },
        {
          taskId: "t4",
          expectedReviewId: "r4",
          status: "error",
          taskStatus: null,
          integrationStatus: null,
          integrationMessage: null,
          integrationTargetCommitSha: null,
          error: { code: "INTEGRATION_CHECK_STALE", message: "Review state changed." },
        },
      ],
    };
    const notice = summarizeBatchIntegrationResult(partialArchived);
    expect(notice).toEqual({
      title: "已归档 1 项，待本地集成 1 项，无法检查 1 项，失败 1 项",
      detail: "未检测到审核提交进入本地 'main'。；仓库目录不可访问（另有 1 项详情见各任务卡片）",
    });
  });
});
