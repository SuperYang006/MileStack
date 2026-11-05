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
    integrationRequired: true,
    integrationTargetBranch: "main",
    integrationNotRequiredReason: null,
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

  it("groups a chain only by the final goal task", () => {
    // 未完成直线链：任务 A <- 任务 B <- 任务 C
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

    // 只有最终任务 C 成组；A、B 作为前置留在同一组里，不另外成组
    expect(graphs).toHaveLength(1);
    const graph = graphs[0]!;
    expect(graph.title).toBe("任务 C");
    expect(graph.taskIds).toEqual(["t-a", "t-b", "t-c"]);

    // 每个任务只出现一次，三个阶段各一个任务，没有伪并行
    expect(graph.stages).toHaveLength(3);
    expect(graph.stages[0]?.tasks.map((t) => t.id)).toEqual(["t-a"]);
    expect(graph.stages[1]?.tasks.map((t) => t.id)).toEqual(["t-b"]);
    expect(graph.stages[2]?.tasks.map((t) => t.id)).toEqual(["t-c"]);
    expect(graph.stages.every((stage) => !stage.isParallel)).toBe(true);

    // 只有末端的 C 是终点，A、B 不是；唯一终点独占最后一步，标为最终目标
    expect(graph.stages.flatMap((s) => s.tasks).filter((t) => t.isGoal).map((t) => t.id)).toEqual(["t-c"]);
    expect(graph.stages[2]?.label).toContain("最终目标");
  });

  it("merges goals that share one incomplete prerequisite into a single group", () => {
    // 共用前置 R 同时被互不依赖的目标 G1 与 G2 依赖
    const shared = makeSummary({ id: "shared", title: "共用前置 R", status: "ready" });
    const goal1 = makeSummary({
      id: "goal-1",
      title: "目标 G1",
      status: "inbox",
      dependencyIds: ["shared"],
    });
    const goal2 = makeSummary({
      id: "goal-2",
      title: "目标 G2",
      status: "inbox",
      dependencyIds: ["shared"],
    });

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      counts: testCounts,
      current: [],
      next: [shared],
      inReview: [],
      blocked: [],
      inbox: [goal1, goal2],
      recentlyCompleted: [],
    };

    const graphs = buildConnectedDagGraphs(status);

    // 共用前置只出现一次，两个终点同在一组，标题列出两个终点
    expect(graphs).toHaveLength(1);
    const graph = graphs[0]!;
    expect(graph.title).toBe("目标 G1、目标 G2");
    expect([...graph.taskIds].sort()).toEqual(["goal-1", "goal-2", "shared"]);
    expect(graph.stages.map((stage) => stage.tasks.map((t) => t.id).sort())).toEqual([
      ["shared"],
      ["goal-1", "goal-2"],
    ]);
    expect(graph.stages[1]?.isParallel).toBe(true);

    // 多个终点时不使用“最终目标”
    expect(graph.stages.some((stage) => stage.label.includes("最终目标"))).toBe(false);
    expect(
      graph.stages.flatMap((s) => s.tasks).filter((t) => t.isGoal).map((t) => t.id).sort(),
    ).toEqual(["goal-1", "goal-2"]);
  });

  it("keeps branches that converge on one task in a single group", () => {
    // S 被 A、B 依赖，C 同时依赖 A 与 B：多条线汇合到 C 仍是一组
    const taskS = makeSummary({ id: "s", title: "共用前置 S", status: "ready" });
    const taskA = makeSummary({ id: "a", title: "分支 A", status: "inbox", dependencyIds: ["s"] });
    const taskB = makeSummary({ id: "b", title: "分支 B", status: "inbox", dependencyIds: ["s"] });
    const taskC = makeSummary({
      id: "c",
      title: "汇合目标 C",
      status: "inbox",
      dependencyIds: ["a", "b"],
    });

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      counts: testCounts,
      current: [],
      next: [taskS],
      inReview: [],
      blocked: [],
      inbox: [taskA, taskB, taskC],
      recentlyCompleted: [],
    };

    const graphs = buildConnectedDagGraphs(status);

    // 汇合后的任务 C 是唯一目标，整条汇聚线只有一组
    expect(graphs).toHaveLength(1);
    const graph = graphs[0]!;
    expect(graph.title).toBe("汇合目标 C");
    expect(new Set(graph.taskIds).size).toBe(4);
    expect([...graph.taskIds].sort()).toEqual(["a", "b", "c", "s"]);

    // S 是公共入口，A、B 是同一目标下互不依赖的并行前置，C 是最终目标
    expect(graph.stages).toHaveLength(3);
    expect(graph.stages[0]?.tasks.map((t) => t.id)).toEqual(["s"]);
    expect(graph.stages[1]?.tasks.map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect(graph.stages[1]?.isParallel).toBe(true);
    expect(graph.stages[1]?.tasks.every((t) => t.isParallelStageTask)).toBe(true);
    expect(graph.stages[2]?.tasks.map((t) => t.id)).toEqual(["c"]);
    expect(graph.stages[2]?.label).toContain("最终目标");

    const branchA = graph.stages[1]?.tasks.find((t) => t.id === "a");
    const branchB = graph.stages[1]?.tasks.find((t) => t.id === "b");
    expect(branchA?.upstreamIds).toEqual(["s"]);
    expect(branchB?.upstreamIds).toEqual(["s"]);
    expect(branchA?.downstreamIds).toEqual(["c"]);
    expect(branchB?.downstreamIds).toEqual(["c"]);
    expect(branchA?.upstreamIds).not.toContain("b");
    expect(branchB?.upstreamIds).not.toContain("a");

    // 汇合边保留，不同目标不会被标成并行（这里只有一组）
    expect(graph.edges).toContainEqual({ from: "s", to: "a" });
    expect(graph.edges).toContainEqual({ from: "s", to: "b" });
    expect(graph.edges).toContainEqual({ from: "a", to: "c" });
    expect(graph.edges).toContainEqual({ from: "b", to: "c" });
  });

  it("does not pull completed prerequisites or their goals into one topology", () => {
    // 已完成任务 C 同时被两个互不依赖的未完成目标依赖，两个目标没有其他未完成前置
    const completed = makeSummary({ id: "done-c", title: "已完成前置 C", status: "completed" });
    const goal1 = makeSummary({
      id: "goal-1",
      title: "目标 G1",
      status: "ready",
      dependencyIds: ["done-c"],
    });
    const goal2 = makeSummary({
      id: "goal-2",
      title: "目标 G2",
      status: "ready",
      dependencyIds: ["done-c"],
    });

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      counts: testCounts,
      current: [],
      next: [goal1, goal2],
      inReview: [],
      blocked: [],
      inbox: [],
      recentlyCompleted: [completed],
    };

    const graphs = buildConnectedDagGraphs(status);

    // 没有未完成关联时不显示拓扑组：C 不进入拓扑，两个目标也不会被粘到同一张图里
    expect(graphs).toEqual([]);
  });

  it("shows the first two goal titles and the total when a group has more than two goals", () => {
    // 同一个未完成前置被 3 个互不依赖的目标依赖
    const shared = makeSummary({ id: "shared", title: "共用前置 R", status: "ready" });
    const goalTasks = [1, 2, 3].map((n) =>
      makeSummary({
        id: `goal-${n}`,
        title: `目标 ${n}`,
        status: "inbox",
        dependencyIds: ["shared"],
      }),
    );

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      counts: testCounts,
      current: [],
      next: [shared],
      inReview: [],
      blocked: [],
      inbox: goalTasks,
      recentlyCompleted: [],
    };

    const graphs = buildConnectedDagGraphs(status);

    expect(graphs).toHaveLength(1);
    expect(graphs[0]?.title).toBe("目标 1、目标 2 等 3 个目标");
    expect(graphs[0]?.taskIds).toHaveLength(4);
  });

  it("keeps a fork in a single group with both branches as goals", () => {
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
    expect([...graphs[0]!.taskIds].sort()).toEqual(["b1", "b2", "root"]);
    expect(graphs[0]?.stages).toHaveLength(2);
  });

  it("keeps unconnected dependency graphs in separate groups", () => {
    // 链 1：X -> Y
    const taskX = makeSummary({ id: "x", title: "任务 X", status: "ready" });
    const taskY = makeSummary({ id: "y", title: "任务 Y", status: "inbox", dependencyIds: ["x"] });

    // 分叉 2：M -> N、M -> P
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
    const graphY = graphs.find((g) => g.taskIds.includes("y"));
    const graphFork = graphs.find((g) => g.taskIds.includes("m"));
    expect(graphY?.title).toBe("任务 Y");
    expect([...graphY!.taskIds].sort()).toEqual(["x", "y"]);
    expect(graphFork?.title).toBe("任务 N、任务 P");
    expect([...graphFork!.taskIds].sort()).toEqual(["m", "n", "p"]);
  });

  it("does not connect two goals through a completed task", () => {
    // X、Y 都依赖已完成的 P，但各自还有未完成前置
    const done = makeSummary({ id: "done-p", title: "已完成 P", status: "completed" });
    const preX = makeSummary({ id: "pre-x", title: "前置 X", status: "ready", dependencyIds: ["done-p"] });
    const preY = makeSummary({ id: "pre-y", title: "前置 Y", status: "ready", dependencyIds: ["done-p"] });
    const goalX = makeSummary({
      id: "goal-x",
      title: "目标 X",
      status: "inbox",
      dependencyIds: ["done-p", "pre-x"],
    });
    const goalY = makeSummary({
      id: "goal-y",
      title: "目标 Y",
      status: "inbox",
      dependencyIds: ["done-p", "pre-y"],
    });

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      counts: testCounts,
      current: [],
      next: [preX, preY],
      inReview: [],
      blocked: [],
      inbox: [goalX, goalY],
      recentlyCompleted: [done],
    };

    const graphs = buildConnectedDagGraphs(status);

    expect(graphs).toHaveLength(2);
    expect(graphs.map((g) => g.title).sort()).toEqual(["目标 X", "目标 Y"]);
    expect([...graphs.find((g) => g.title === "目标 X")!.taskIds].sort()).toEqual(["goal-x", "pre-x"]);
    expect([...graphs.find((g) => g.title === "目标 Y")!.taskIds].sort()).toEqual(["goal-y", "pre-y"]);
    expect(graphs.flatMap((g) => g.taskIds)).not.toContain("done-p");
  });

  it("puts a 13-task connected draft graph with three goals in one group", () => {
    // X←Y 表示 X 依赖 Y
    const deps: Record<string, string[]> = {
      A: [],
      B: [],
      C: ["A"],
      D: ["A"],
      E: ["A", "B", "C"],
      F: ["A", "D"],
      G: ["E"],
      H: ["E"],
      I: ["E"],
      J: ["E", "F"],
      K: ["J"],
      L: ["K", "H"],
      M: ["L"],
    };
    const drafts = Object.entries(deps).map(([name, dependencyIds]) =>
      makeSummary({ id: name.toLowerCase(), title: `任务 ${name}`, status: "inbox", dependencyIds: dependencyIds.map((d) => d.toLowerCase()) }),
    );

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      counts: testCounts,
      current: [],
      next: [],
      inReview: [],
      blocked: [],
      inbox: drafts,
      recentlyCompleted: [],
    };

    const graphs = buildConnectedDagGraphs(status);

    expect(graphs).toHaveLength(1);
    const graph = graphs[0]!;
    expect(graph.taskIds).toHaveLength(13);
    expect(new Set(graph.taskIds).size).toBe(13);
    expect(
      graph.stages.map((stage) => stage.tasks.map((t) => t.title.replace("任务 ", ""))),
    ).toEqual([["A", "B"], ["C", "D"], ["E", "F"], ["G", "H", "I", "J"], ["K"], ["L"], ["M"]]);
    expect(graph.stages[3]?.label).toContain("可以同时做");
    expect(graph.stages[3]?.isParallel).toBe(true);

    // 3 个终点 G、I、M：标题列出前 2 个并注明总数，卡片带终点标识
    expect(graph.title).toBe("任务 G、任务 I 等 3 个目标");
    expect(
      graph.stages.flatMap((s) => s.tasks).filter((t) => t.isGoal).map((t) => t.title.replace("任务 ", "")),
    ).toEqual(["G", "I", "M"]);
    // 多终点组里 M 虽独占最后一步，也不是“最终目标”
    expect(graph.stages.some((stage) => stage.label.includes("最终目标"))).toBe(false);
    expect(graph.stages[6]?.isFinalGoal).toBe(false);

    // 卡片只显示去掉冗余后的直接前置：E 不显示已被 C 间接覆盖的 A
    const prerequisites = Object.fromEntries(
      graph.stages
        .flatMap((s) => s.tasks)
        .map((t) => [t.title.replace("任务 ", ""), t.prerequisites.map((p) => p.title.replace("任务 ", ""))]),
    );
    expect(prerequisites).toEqual({
      A: [],
      B: [],
      C: ["A"],
      D: ["A"],
      E: ["B", "C"],
      F: ["D"],
      G: ["E"],
      H: ["E"],
      I: ["E"],
      J: ["E", "F"],
      K: ["J"],
      L: ["H", "K"],
      M: ["L"],
    });
    expect(graph.stages.flatMap((s) => s.tasks).find((t) => t.title === "任务 E")?.prerequisites.map((p) => p.id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("marks only drafts without incomplete prerequisites as parallel candidates, never ready tasks", () => {
    const done = makeSummary({ id: "t-done", title: "已完成", status: "completed" });
    const freeDraft = makeSummary({ id: "t-free", title: "前置已完成的草稿", status: "inbox", dependencyIds: ["t-done"] });
    const waitingDraft = makeSummary({ id: "t-wait", title: "还有前置的草稿", status: "inbox", dependencyIds: ["t-free"] });
    const readyTask = makeSummary({ id: "t-ready", title: "就绪任务", status: "ready", queuePosition: 1 });
    const goal = makeSummary({
      id: "t-goal",
      title: "终点",
      status: "inbox",
      dependencyIds: ["t-wait", "t-ready"],
    });

    const status: ProjectStatus = {
      project: { id: "proj-1", name: "Test", goal: null },
      counts: testCounts,
      current: [],
      next: [readyTask],
      inReview: [],
      blocked: [],
      inbox: [freeDraft, waitingDraft, goal],
      recentlyCompleted: [done],
    };

    const graphs = buildConnectedDagGraphs(status);

    expect(graphs).toHaveLength(1);
    const tasks = new Map(graphs[0]!.stages.flatMap((s) => s.tasks).map((t) => [t.id, t]));
    expect(tasks.get("t-free")?.isParallelCandidate).toBe(true);
    expect(tasks.get("t-free")?.prerequisites).toEqual([]);
    expect(tasks.get("t-wait")?.isParallelCandidate).toBe(false);
    expect(tasks.get("t-goal")?.isParallelCandidate).toBe(false);
    expect(tasks.get("t-ready")?.isRunnable).toBe(true);
    expect(tasks.get("t-ready")?.isParallelCandidate).toBe(false);
  });

  it("regression: groups the 5-node asymmetric AI review DAG under its final goal", () => {
    // 1. 核心审核模型 (completed root, forks into HTTP/UI and MCP)
    const coreModel = makeSummary({
      id: "946dd1d9-01fc-4ac2-a56e-9b6493ba7ec8",
      title: "建立 AI 审核会话、风险分级与审核决策核心模型",
      status: "completed",
    });

    // 2. HTTP 与 UI (ready, depends on coreModel)
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

    // 只有最终目标 endToEnd 成组；已完成的核心模型不进入拓扑，孤立任务不成组
    expect(graphs).toHaveLength(1);
    const graph = graphs[0]!;
    expect(graph.title).toBe("验证 AI 审核与风险策略的端到端闭环");
    expect(graph.taskIds).toHaveLength(4);
    expect(new Set(graph.taskIds).size).toBe(4);
    expect(graph.taskIds).toContain("46d81d34-9b67-4161-adb5-35d9a452d2b4");
    expect(graph.taskIds).toContain("e7714038-094a-47b8-bfe5-012f0a49c52a");
    expect(graph.taskIds).toContain("f3b55a8c-3fd0-48b1-aeeb-7165028571c5");
    expect(graph.taskIds).toContain("c04642b7-bdeb-4bae-9f7e-e57aac026804");
    expect(graph.taskIds).not.toContain("946dd1d9-01fc-4ac2-a56e-9b6493ba7ec8");
    expect(graph.taskIds).not.toContain("isolated-1");

    // 3 个阶段：并行分支 -> 中间任务 -> 汇合验证目标
    expect(graph.stages).toHaveLength(3);

    const stage0 = graph.stages[0]!;
    expect(stage0.tasks.map((t) => t.id).sort()).toEqual([
      "46d81d34-9b67-4161-adb5-35d9a452d2b4",
      "e7714038-094a-47b8-bfe5-012f0a49c52a",
    ]);
    expect(stage0.isParallel).toBe(true);
    expect(stage0.tasks.every((t) => t.isParallelStageTask)).toBe(true);
    // Both are runnable since root coreModel is completed
    expect(stage0.tasks.every((t) => t.isRunnable)).toBe(true);

    const stage1 = graph.stages[1]!;
    expect(stage1.tasks).toHaveLength(1);
    expect(stage1.tasks[0]?.id).toBe("f3b55a8c-3fd0-48b1-aeeb-7165028571c5");
    expect(stage1.isParallel).toBe(false);
    expect(stage1.tasks[0]?.isParallelStageTask).toBe(false);

    const stage2 = graph.stages[2]!;
    expect(stage2.tasks).toHaveLength(1);
    expect(stage2.tasks[0]?.id).toBe("c04642b7-bdeb-4bae-9f7e-e57aac026804");
    expect(stage2.isParallel).toBe(false);
    expect(stage2.label).toContain("最终目标");

    // 已完成任务不出现在边里；端到端的冗余直接依赖 (coreModel -> endToEnd) 自然消失
    expect(graph.rawEdges).not.toContainEqual({
      from: "946dd1d9-01fc-4ac2-a56e-9b6493ba7ec8",
      to: "c04642b7-bdeb-4bae-9f7e-e57aac026804",
    });

    // 组内没有冗余边，传递归约不改变边集
    expect(graph.edges).toEqual(graph.rawEdges);
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
