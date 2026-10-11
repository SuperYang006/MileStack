import { describe, expect, it } from "vitest";
import type { ProjectStatus, TaskSummary } from "../../ui/src/types.js";
import {
  buildTaskIndex,
  buildDownstreamMap,
  computeTaskDependencyDetail,
  computeReadyQueueStats,
  buildExecutionFlowGroups,
} from "../../ui/src/utils/dependencyGraph.js";

function makeSummary(partial: Partial<TaskSummary> & { id: string; title: string; status: TaskSummary["status"] }): TaskSummary {
  return {
    id: partial.id,
    projectId: "proj-1",
    title: partial.title,
    status: partial.status,
    queuePosition: partial.queuePosition ?? null,
    dependencyIds: partial.dependencyIds ?? [],
    waitingFor: partial.waitingFor ?? [],
    runnable: partial.runnable ?? false,
    currentStep: null,
    nextStep: null,
    blocker: null,
    requiredAction: null,
    updatedAt: new Date().toISOString(),
    completedAt: partial.status === "completed" ? new Date().toISOString() : null,
  };
}

describe("dependencyGraph calculation utils", () => {
  it("correctly identifies runnable tasks and downstream unblocks", () => {
    const taskA = makeSummary({ id: "task-a", title: "前置任务 A", status: "completed" });
    const taskB = makeSummary({
      id: "task-b",
      title: "就绪任务 B",
      status: "ready",
      dependencyIds: ["task-a"],
    });
    const taskC = makeSummary({
      id: "task-c",
      title: "等待任务 C",
      status: "ready",
      dependencyIds: ["task-b"],
    });

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      current: [],
      next: [taskB, taskC],
      inReview: [],
      blocked: [],
      inbox: [],
      recentlyCompleted: [taskA],
    };

    const taskIndex = buildTaskIndex(status);
    const downstream = buildDownstreamMap(taskIndex);

    // Task B has dependency Task A which is completed -> should be runnable
    const detailB = computeTaskDependencyDetail(taskB, taskIndex, downstream);
    expect(detailB.isRunnable).toBe(true);
    expect(detailB.areAllDependenciesMet).toBe(true);
    expect(detailB.waitingFor).toHaveLength(0);
    expect(detailB.unblocks).toHaveLength(1);
    expect(detailB.unblocks[0]?.id).toBe("task-c");

    // Task C has dependency Task B which is ready (not completed) -> not runnable
    const detailC = computeTaskDependencyDetail(taskC, taskIndex, downstream);
    expect(detailC.isRunnable).toBe(false);
    expect(detailC.areAllDependenciesMet).toBe(false);
    expect(detailC.waitingFor).toHaveLength(1);
    expect(detailC.waitingFor[0]?.id).toBe("task-b");
  });

  it("marks inbox tasks with met dependencies as parallel candidates, never runnable", () => {
    const taskDep = makeSummary({ id: "dep-1", title: "已完成前置", status: "completed" });
    const inboxCandidate = makeSummary({
      id: "inbox-1",
      title: "收件箱无依赖任务",
      status: "inbox",
      dependencyIds: ["dep-1"],
    });

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      current: [],
      next: [],
      inReview: [],
      blocked: [],
      inbox: [inboxCandidate],
      recentlyCompleted: [taskDep],
    };

    const taskIndex = buildTaskIndex(status);
    const detail = computeTaskDependencyDetail(inboxCandidate, taskIndex);

    expect(detail.isRunnable).toBe(false);
    expect(detail.isInboxParallelCandidate).toBe(true);
  });

  it("calculates parallel stats accurately for ready queue", () => {
    const ready1 = makeSummary({ id: "r-1", title: "就绪 1", status: "ready" });
    const ready2 = makeSummary({ id: "r-2", title: "就绪 2", status: "ready" });
    const ready3Waiting = makeSummary({
      id: "r-3",
      title: "就绪 3",
      status: "ready",
      dependencyIds: ["r-1"],
    });

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      current: [],
      next: [ready1, ready2, ready3Waiting],
      inReview: [],
      blocked: [],
      inbox: [],
      recentlyCompleted: [],
    };

    const taskIndex = buildTaskIndex(status);
    const stats = computeReadyQueueStats(status.next, taskIndex);

    expect(stats.runnableCount).toBe(2);
    expect(stats.isParallelizable).toBe(true);
    expect(stats.runnableTasks.map((t: TaskSummary) => t.id)).toEqual(["r-1", "r-2"]);
    expect(stats.blockedByDepTasks.map((t: TaskSummary) => t.id)).toEqual(["r-3"]);
  });

  it("extracts fork-merge DAG segments for execution flow groups", () => {
    const root = makeSummary({ id: "root-1", title: "核心模型", status: "running" });
    const branch1 = makeSummary({ id: "branch-1", title: "UI 展示", status: "ready", dependencyIds: ["root-1"] });
    const branch2 = makeSummary({ id: "branch-2", title: "MCP 工具", status: "ready", dependencyIds: ["root-1"] });
    const merge = makeSummary({
      id: "merge-1",
      title: "端到端闭环验证",
      status: "inbox",
      dependencyIds: ["branch-1", "branch-2"],
    });

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      current: [root],
      next: [branch1, branch2],
      inReview: [],
      blocked: [],
      inbox: [merge],
      recentlyCompleted: [],
    };

    const groups = buildExecutionFlowGroups(status);
    expect(groups.length).toBeGreaterThanOrEqual(1);

    const forkMerge = groups.find((g: { type: string }) => g.type === "fork_merge");
    expect(forkMerge).toBeDefined();
    expect(forkMerge?.root.id).toBe("root-1");
    expect(forkMerge?.branches).toHaveLength(2);
    expect(forkMerge?.mergeTarget?.id).toBe("merge-1");
  });
});
