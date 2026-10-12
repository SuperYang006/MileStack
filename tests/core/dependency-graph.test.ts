import { describe, expect, it } from "vitest";
import type { ProjectStatus, TaskSummary } from "../../ui/src/types.js";
import {
  buildTaskIndex,
  buildDownstreamMap,
  computeTaskDependencyDetail,
  computeReadyQueueStats,
  computeTransitiveReduction,
  buildConnectedDagGraphs,
} from "../../ui/src/utils/dependencyGraph.js";

function makeSummary(
  partial: Partial<TaskSummary> & { id: string; title: string; status: TaskSummary["status"] },
): TaskSummary {
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

const testCounts = {
  inbox: 0,
  ready: 0,
  running: 0,
  blocked: 0,
  inReview: 0,
  completed: 0,
  total: 0,
};

describe("dependencyGraph calculation utils", () => {
  it("merges paged completed tasks into the dependency index", () => {
    const archived = makeSummary({
      id: "archived-task",
      title: "已归档前置任务",
      status: "completed",
    });
    const nextTask = makeSummary({
      id: "next-task",
      title: "依赖归档任务的待办",
      status: "ready",
      dependencyIds: [archived.id],
    });
    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      counts: testCounts,
      current: [],
      next: [nextTask],
      inReview: [],
      blocked: [],
      inbox: [],
      recentlyCompleted: [],
    };

    const taskIndex = buildTaskIndex(status, [archived]);
    const detail = computeTaskDependencyDetail(nextTask, taskIndex);

    expect(taskIndex.get(archived.id)).toEqual(archived);
    expect(detail.areAllDependenciesMet).toBe(true);
    expect(detail.isRunnable).toBe(true);
  });

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
      counts: testCounts,
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
      counts: testCounts,
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
      counts: testCounts,
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

  it("computes transitive reduction correctly", () => {
    // A -> B, B -> C, and direct edge A -> C
    const nodeIds = ["A", "B", "C"];
    const edges = [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
      { from: "A", to: "C" }, // redundant
    ];
    const reduced = computeTransitiveReduction(nodeIds, edges);
    expect(reduced).toEqual([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ]);
  });

  it("handles empty graph deterministically", () => {
    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      counts: testCounts,
      current: [],
      next: [],
      inReview: [],
      blocked: [],
      inbox: [],
      recentlyCompleted: [],
    };
    const graphs = buildConnectedDagGraphs(status);
    expect(graphs).toEqual([]);
  });

  it("handles simple chain without duplicate nodes or pseudo-parallelism", () => {
    const taskA = makeSummary({ id: "t-a", title: "任务 A", status: "ready" });
    const taskB = makeSummary({ id: "t-b", title: "任务 B", status: "inbox", dependencyIds: ["t-a"] });
    const taskC = makeSummary({ id: "t-c", title: "任务 C", status: "inbox", dependencyIds: ["t-b"] });

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      counts: testCounts,
      current: [],
      next: [taskA],
      inReview: [],
      blocked: [],
      inbox: [taskB, taskC],
      recentlyCompleted: [],
    };

    const graphs = buildConnectedDagGraphs(status);
    expect(graphs).toHaveLength(1);

    const graph = graphs[0]!;
    expect(graph.taskIds).toEqual(["t-a", "t-b", "t-c"]);
    expect(graph.stages).toHaveLength(3);

    // Each stage has exactly 1 task, no parallel labels
    expect(graph.stages[0]?.tasks.map((t) => t.id)).toEqual(["t-a"]);
    expect(graph.stages[0]?.isParallel).toBe(false);
    expect(graph.stages[1]?.tasks.map((t) => t.id)).toEqual(["t-b"]);
    expect(graph.stages[1]?.isParallel).toBe(false);
    expect(graph.stages[2]?.tasks.map((t) => t.id)).toEqual(["t-c"]);
    expect(graph.stages[2]?.isParallel).toBe(false);

    // Every taskId appears exactly once
    const allRenderedTaskIds = graph.stages.flatMap((s) => s.tasks.map((t) => t.id));
    expect(allRenderedTaskIds).toEqual(["t-a", "t-b", "t-c"]);
  });

  it("handles single fork with true parallel stage", () => {
    const root = makeSummary({ id: "root", title: "根任务", status: "ready" });
    const branch1 = makeSummary({ id: "b1", title: "分支 1", status: "inbox", dependencyIds: ["root"] });
    const branch2 = makeSummary({ id: "b2", title: "分支 2", status: "inbox", dependencyIds: ["root"] });

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      counts: testCounts,
      current: [],
      next: [root],
      inReview: [],
      blocked: [],
      inbox: [branch1, branch2],
      recentlyCompleted: [],
    };

    const graphs = buildConnectedDagGraphs(status);
    expect(graphs).toHaveLength(1);

    const graph = graphs[0]!;
    expect(graph.stages).toHaveLength(2);

    expect(graph.stages[0]?.tasks.map((t) => t.id)).toEqual(["root"]);
    expect(graph.stages[0]?.isParallel).toBe(false);

    expect(graph.stages[1]?.tasks.map((t) => t.id).sort()).toEqual(["b1", "b2"]);
    expect(graph.stages[1]?.isParallel).toBe(true);
    expect(graph.stages[1]?.tasks.every((t) => t.isParallelStageTask)).toBe(true);
  });

  it("handles multiple disjoint subgraphs into independent connected graphs", () => {
    // Subgraph 1: X -> Y
    const taskX = makeSummary({ id: "x", title: "任务 X", status: "ready" });
    const taskY = makeSummary({ id: "y", title: "任务 Y", status: "inbox", dependencyIds: ["x"] });

    // Subgraph 2: M -> N, M -> P
    const taskM = makeSummary({ id: "m", title: "任务 M", status: "ready" });
    const taskN = makeSummary({ id: "n", title: "任务 N", status: "inbox", dependencyIds: ["m"] });
    const taskP = makeSummary({ id: "p", title: "任务 P", status: "inbox", dependencyIds: ["m"] });

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      counts: testCounts,
      current: [],
      next: [taskX, taskM],
      inReview: [],
      blocked: [],
      inbox: [taskY, taskN, taskP],
      recentlyCompleted: [],
    };

    const graphs = buildConnectedDagGraphs(status);
    expect(graphs).toHaveLength(2);

    const graph1 = graphs.find((g) => g.taskIds.includes("x"));
    const graph2 = graphs.find((g) => g.taskIds.includes("m"));

    expect(graph1).toBeDefined();
    expect(graph2).toBeDefined();

    expect(graph1?.taskIds.sort()).toEqual(["x", "y"]);
    expect(graph2?.taskIds.sort()).toEqual(["m", "n", "p"]);
  });

  it("regression: correctly computes the 5-node asymmetric AI review DAG without duplicate nodes or pseudo-parallelism (AC 1, AC 2, AC 3, AC 4, AC 5, AC 10)", () => {
    // 1. 核心审核模型 (completed root, forks into HTTP/UI and MCP)
    const coreModel = makeSummary({
      id: "946dd1d9-01fc-4ac2-a56e-9b6493ba7ec8",
      title: "建立 AI 审核会话、风险分级与审核决策核心模型",
      status: "completed",
    });

    // 2. HTTP 与 UI (ready, depends on coreModel and an older unrelated task)
    const httpUi = makeSummary({
      id: "46d81d34-9b67-4161-adb5-35d9a452d2b4",
      title: "在 HTTP 与 UI 中呈现风险等级和 AI 审核结果",
      status: "ready",
      dependencyIds: ["946dd1d9-01fc-4ac2-a56e-9b6493ba7ec8"],
    });

    // 3. MCP 工具 (ready, depends on coreModel)
    const mcpTools = makeSummary({
      id: "e7714038-094a-47b8-bfe5-012f0a49c52a",
      title: "为 AI 审核流程提供 MCP 工具",
      status: "ready",
      dependencyIds: ["946dd1d9-01fc-4ac2-a56e-9b6493ba7ec8"],
    });

    // 4. Agent 指引 (inbox, depends on MCP 工具)
    const agentGuide = makeSummary({
      id: "f3b55a8c-3fd0-48b1-aeeb-7165028571c5",
      title: "生成非侵入式 MileStack Agent 操作指引",
      status: "inbox",
      dependencyIds: ["e7714038-094a-47b8-bfe5-012f0a49c52a"],
    });

    // 5. 端到端闭环验证 (inbox, depends on HTTP/UI and Agent 指引; also has redundant direct dep on coreModel)
    const endToEnd = makeSummary({
      id: "c04642b7-bdeb-4bae-9f7e-e57aac026804",
      title: "验证 AI 审核与风险策略的端到端闭环",
      status: "inbox",
      dependencyIds: [
        "46d81d34-9b67-4161-adb5-35d9a452d2b4",
        "f3b55a8c-3fd0-48b1-aeeb-7165028571c5",
        "946dd1d9-01fc-4ac2-a56e-9b6493ba7ec8", // 传递依赖冗余边 (coreModel -> endToEnd)
      ],
    });

    // Isolated unrelated active task (should not be in this DAG)
    const isolatedTask = makeSummary({
      id: "isolated-1",
      title: "独立无关联任务",
      status: "ready",
      dependencyIds: [],
    });

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "MileStack", goal: null },
      counts: testCounts,
      current: [],
      next: [mcpTools, httpUi, isolatedTask],
      inReview: [],
      blocked: [],
      inbox: [agentGuide, endToEnd],
      recentlyCompleted: [coreModel],
    };

    const graphs = buildConnectedDagGraphs(status);

    // AC 2: 同一连通依赖图只显示为一个拓扑
    expect(graphs).toHaveLength(1);
    const graph = graphs[0]!;

    // AC 2: 同一 taskId 在该拓扑中只出现一次
    expect(graph.taskIds).toHaveLength(5);
    expect(new Set(graph.taskIds).size).toBe(5);
    expect(graph.taskIds).toContain("946dd1d9-01fc-4ac2-a56e-9b6493ba7ec8");
    expect(graph.taskIds).toContain("46d81d34-9b67-4161-adb5-35d9a452d2b4");
    expect(graph.taskIds).toContain("e7714038-094a-47b8-bfe5-012f0a49c52a");
    expect(graph.taskIds).toContain("f3b55a8c-3fd0-48b1-aeeb-7165028571c5");
    expect(graph.taskIds).toContain("c04642b7-bdeb-4bae-9f7e-e57aac026804");
    expect(graph.taskIds).not.toContain("isolated-1");

    // All rendered tasks across all stages must be unique and sum to exactly 5
    const allStageTasks = graph.stages.flatMap((s) => s.tasks.map((t) => t.id));
    expect(allStageTasks).toHaveLength(5);
    expect(new Set(allStageTasks).size).toBe(5);

    // AC 1 & AC 3: 4 distinct stages for asymmetric DAG
    expect(graph.stages).toHaveLength(4);

    // Stage 0: 核心审核模型 (root)
    const stage0 = graph.stages[0]!;
    expect(stage0.tasks).toHaveLength(1);
    expect(stage0.tasks[0]?.id).toBe("946dd1d9-01fc-4ac2-a56e-9b6493ba7ec8");
    expect(stage0.tasks[0]?.status).toBe("completed");
    expect(stage0.isParallel).toBe(false);

    // Stage 1: HTTP/UI 与 MCP 两条首阶段并行分支 (AC 1 & AC 4)
    const stage1 = graph.stages[1]!;
    expect(stage1.tasks).toHaveLength(2);
    const stage1Ids = stage1.tasks.map((t) => t.id).sort();
    expect(stage1Ids).toEqual([
      "46d81d34-9b67-4161-adb5-35d9a452d2b4",
      "e7714038-094a-47b8-bfe5-012f0a49c52a",
    ]);
    expect(stage1.isParallel).toBe(true);
    expect(stage1.tasks.every((t) => t.isParallelStageTask)).toBe(true);
    // Both are runnable since root coreModel is completed
    expect(stage1.tasks.every((t) => t.isRunnable)).toBe(true);

    // Stage 2: MCP 后接 Agent 指引 (AC 1 & AC 4: 依赖另一分支的任务不得计入同一并行组)
    const stage2 = graph.stages[2]!;
    expect(stage2.tasks).toHaveLength(1);
    expect(stage2.tasks[0]?.id).toBe("f3b55a8c-3fd0-48b1-aeeb-7165028571c5");
    expect(stage2.isParallel).toBe(false);
    expect(stage2.tasks[0]?.isParallelStageTask).toBe(false);

    // Stage 3: 端到端验证汇合目标 (AC 1)
    const stage3 = graph.stages[3]!;
    expect(stage3.tasks).toHaveLength(1);
    expect(stage3.tasks[0]?.id).toBe("c04642b7-bdeb-4bae-9f7e-e57aac026804");
    expect(stage3.isParallel).toBe(false);

    // AC 5: 传递归约生效，冗余边 coreModel -> endToEnd 在显示层忽略
    const rawHasTransitive = graph.rawEdges.some(
      (e) => e.from === "946dd1d9-01fc-4ac2-a56e-9b6493ba7ec8" && e.to === "c04642b7-bdeb-4bae-9f7e-e57aac026804",
    );
    expect(rawHasTransitive).toBe(true);

    const reducedHasTransitive = graph.edges.some(
      (e) => e.from === "946dd1d9-01fc-4ac2-a56e-9b6493ba7ec8" && e.to === "c04642b7-bdeb-4bae-9f7e-e57aac026804",
    );
    expect(reducedHasTransitive).toBe(false);

    // Verify key edges present in reduced edges
    expect(graph.edges).toContainEqual({
      from: "946dd1d9-01fc-4ac2-a56e-9b6493ba7ec8",
      to: "e7714038-094a-47b8-bfe5-012f0a49c52a",
    });
    expect(graph.edges).toContainEqual({
      from: "946dd1d9-01fc-4ac2-a56e-9b6493ba7ec8",
      to: "46d81d34-9b67-4161-adb5-35d9a452d2b4",
    });
    expect(graph.edges).toContainEqual({
      from: "e7714038-094a-47b8-bfe5-012f0a49c52a",
      to: "f3b55a8c-3fd0-48b1-aeeb-7165028571c5",
    });
    expect(graph.edges).toContainEqual({
      from: "46d81d34-9b67-4161-adb5-35d9a452d2b4",
      to: "c04642b7-bdeb-4bae-9f7e-e57aac026804",
    });
    expect(graph.edges).toContainEqual({
      from: "f3b55a8c-3fd0-48b1-aeeb-7165028571c5",
      to: "c04642b7-bdeb-4bae-9f7e-e57aac026804",
    });
  });
});
