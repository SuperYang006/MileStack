import type { ProjectStatus, TaskStatus, TaskSummary } from "../types.js";

export interface DependencyItem {
  id: string;
  title: string;
  status: TaskStatus;
  isCompleted: boolean;
}

export interface DownstreamItem {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface TaskDependencyDetail {
  id: string;
  title: string;
  status: TaskStatus;
  /** 所有直接前置依赖，无论完成与否 */
  dependencies: DependencyItem[];
  /** 尚未完成的阻断性前置依赖 */
  waitingFor: DependencyItem[];
  /** 直接依赖本任务的下游任务（本任务完成后将推进或解锁它们） */
  unblocks: DownstreamItem[];
  /** 是否所有依赖均已达成 */
  areAllDependenciesMet: boolean;
  /** 是否当前直接可执行（必须为 ready 且依赖全部达成） */
  isRunnable: boolean;
  /** 如果在收件箱中，且依赖全满足或无依赖，标记为可并行排队候选 */
  isInboxParallelCandidate: boolean;
}

export interface DagStageTask {
  id: string;
  title: string;
  status: TaskStatus;
  isRunnable: boolean;
  stageIndex: number;
  /** 该任务直接依赖的本拓扑内的前置任务 ID */
  upstreamIds: string[];
  /** 直接依赖该任务的本拓扑内的下游任务 ID */
  downstreamIds: string[];
  /** 所有未完成依赖（包括拓扑外）的数量 */
  waitingCount: number;
  /** 在当前阶段中是否为并行分支任务（同 stage 包含多个任务） */
  isParallelStageTask: boolean;
  /** 是否为终点任务：没有未完成的下游任务 */
  isGoal: boolean;
  /** 卡片上显示的直接前置：组内、去掉冗余（已被其他前置间接覆盖）后的依赖，按分步先后再按标题排序 */
  prerequisites: Array<{ id: string; title: string }>;
  /** 草稿任务的前置全部已完成，排入就绪队列后可并行执行（与收件箱的“可并行候选”同义） */
  isParallelCandidate: boolean;
  /** 最晚可排在第几步而不推迟组内任何终点，比当前所在步晚的步数；0 表示在关键路径上，不可延后 */
  deferrableSteps: number;
}

export interface DagStage {
  stageIndex: number;
  label: string;
  tasks: DagStageTask[];
  /** 该阶段是否包含多个并行分支任务 */
  isParallel: boolean;
  /** 是否为组内唯一终点所在的最后一步（标为“最终目标”） */
  isFinalGoal: boolean;
}

/** 概览进度条的分段与需关注项使用的状态，按显示先后排列 */
export const GOAL_PATH_SEGMENT_STATUSES = ["running", "in_review", "blocked", "ready", "inbox"] as const;
export type GoalPathSegmentStatus = (typeof GOAL_PATH_SEGMENT_STATUSES)[number];

export interface GoalPathAttentionItem {
  kind: "running" | "in_review" | "blocked" | "runnable";
  count: number;
}

export interface GoalPathOverview {
  /** 进度条分段：按执行中、待审核、阻塞、就绪、草稿排列，只含数量大于 0 的状态 */
  segments: Array<{ status: GoalPathSegmentStatus; count: number }>;
  /** 需关注项：依次为执行中、待审核、阻塞、可推进，只含数量大于 0 的项 */
  attention: GoalPathAttentionItem[];
  /** 剩余任务全部是草稿 */
  isAllDraft: boolean;
  remainingTasks: number;
  remainingSteps: number;
}

export interface ConnectedDagGraph {
  id: string;
  /** 组名：一个终点时为该终点的标题，两个及以上时为“<首个终点标题> 等 N 个目标” */
  title: string;
  /** 组内所有终点标题，按分步先后排列 */
  goalTitles: string[];
  overview: GoalPathOverview;
  /** 拓扑包含的所有唯一 taskId 集合 */
  taskIds: string[];
  /** 按拓扑序分层的执行阶段列表 */
  stages: DagStage[];
  /** 经过传递归约 (Transitive Reduction) 后的核心连接边 */
  edges: Array<{ from: string; to: string }>;
  /** 原始显式依赖边 */
  rawEdges: Array<{ from: string; to: string }>;
}

/**
 * 汇总项目所有板块任务形成 ID 映射表
 */
export function buildTaskIndex(
  status: ProjectStatus,
  additionalTasks: TaskSummary[] = [],
): Map<string, TaskSummary> {
  const map = new Map<string, TaskSummary>();
  const all = [
    ...status.current,
    ...status.next,
    ...status.inReview,
    ...status.blocked,
    ...status.inbox,
    ...status.recentlyCompleted,
    ...additionalTasks,
  ];
  for (const t of all) {
    map.set(t.id, t);
  }
  return map;
}

/**
 * 计算反向依赖映射：taskId -> 依赖它的所有下游任务 ID 列表
 */
export function buildDownstreamMap(allTasks: Map<string, TaskSummary>): Map<string, string[]> {
  const downstreamMap = new Map<string, string[]>();
  for (const [taskId, task] of allTasks.entries()) {
    for (const depId of task.dependencyIds) {
      const list = downstreamMap.get(depId) || [];
      list.push(taskId);
      downstreamMap.set(depId, list);
    }
  }
  return downstreamMap;
}

/**
 * 计算单个任务完整的依赖与解锁信息
 */
export function computeTaskDependencyDetail(
  task: TaskSummary,
  allTasks: Map<string, TaskSummary>,
  downstreamMap?: Map<string, string[]>,
): TaskDependencyDetail {
  const dMap = downstreamMap || buildDownstreamMap(allTasks);

  const dependencies: DependencyItem[] = [];
  const waitingFor: DependencyItem[] = [];

  for (const depId of task.dependencyIds) {
    const dep = allTasks.get(depId);
    if (dep) {
      const isCompleted = dep.status === "completed";
      const item: DependencyItem = {
        id: dep.id,
        title: dep.title,
        status: dep.status,
        isCompleted,
      };
      dependencies.push(item);
      if (!isCompleted) {
        waitingFor.push(item);
      }
    } else {
      // 外部或不可见依赖
      const item: DependencyItem = {
        id: depId,
        title: `任务 ${depId.slice(0, 8)}`,
        status: "blocked",
        isCompleted: false,
      };
      dependencies.push(item);
      waitingFor.push(item);
    }
  }

  const areAllDependenciesMet = waitingFor.length === 0;
  const isRunnable = task.status === "ready" && areAllDependenciesMet;
  const isInboxParallelCandidate = task.status === "inbox" && areAllDependenciesMet;

  // 下游被解锁任务
  const downstreamIds = dMap.get(task.id) || [];
  const unblocks: DownstreamItem[] = [];
  for (const childId of downstreamIds) {
    const child = allTasks.get(childId);
    if (child) {
      unblocks.push({
        id: child.id,
        title: child.title,
        status: child.status,
      });
    }
  }

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dependencies,
    waitingFor,
    unblocks,
    areAllDependenciesMet,
    isRunnable,
    isInboxParallelCandidate,
  };
}

/**
 * 提取就绪队列中的可并行统计信息
 */
export function computeReadyQueueStats(
  nextTasks: TaskSummary[],
  allTasks: Map<string, TaskSummary>,
): {
  runnableTasks: TaskSummary[];
  blockedByDepTasks: TaskSummary[];
  runnableCount: number;
  isParallelizable: boolean;
} {
  const runnableTasks: TaskSummary[] = [];
  const blockedByDepTasks: TaskSummary[] = [];

  for (const t of nextTasks) {
    const detail = computeTaskDependencyDetail(t, allTasks);
    if (detail.isRunnable) {
      runnableTasks.push(t);
    } else {
      blockedByDepTasks.push(t);
    }
  }

  return {
    runnableTasks,
    blockedByDepTasks,
    runnableCount: runnableTasks.length,
    isParallelizable: runnableTasks.length > 1,
  };
}

/**
 * 对有向边进行传递归约 (Transitive Reduction)
 * 如果存在间接路径 u ~> v (长度 >= 2)，则直接边 (u, v) 为冗余边，在显示层忽略
 */
export function computeTransitiveReduction(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
): Array<{ from: string; to: string }> {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    adj.set(id, []);
  }
  for (const edge of edges) {
    adj.get(edge.from)?.push(edge.to);
  }

  const hasIndirectPath = (u: string, target: string): boolean => {
    const children = adj.get(u) || [];
    for (const child of children) {
      if (child === target) continue; // 跳过直接边
      const queue = [child];
      const visited = new Set<string>([child]);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        if (curr === target) return true;
        for (const next of adj.get(curr) || []) {
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }
    }
    return false;
  };

  return edges.filter((edge) => !hasIndirectPath(edge.from, edge.to));
}

/**
 * 某个任务在给定依赖边内的全部上游（直接和间接前置）与全部下游，不含任务自身
 *
 * edges 取组内的 rawEdges（from 是前置，to 是依赖它的任务），因此结果不会包含组外任务；
 * 菱形依赖中同一任务只出现一次，成环时也不会重复遍历。
 */
export function computeDependencyChain(
  taskId: string,
  edges: Array<{ from: string; to: string }>,
): { upstream: Set<string>; downstream: Set<string> } {
  const collect = (start: string, next: (edge: { from: string; to: string }) => [string, string]) => {
    const reached = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.pop() ?? start;
      for (const edge of edges) {
        const [source, target] = next(edge);
        if (source === current && target !== start && !reached.has(target)) {
          reached.add(target);
          queue.push(target);
        }
      }
    }
    return reached;
  };

  return {
    upstream: collect(taskId, (edge) => [edge.to, edge.from]),
    downstream: collect(taskId, (edge) => [edge.from, edge.to]),
  };
}

function summarizeGoalPath(stages: DagStage[]): GoalPathOverview {
  const tasks = stages.flatMap((stage) => stage.tasks);
  const countByStatus = new Map<TaskStatus, number>();
  for (const task of tasks) {
    countByStatus.set(task.status, (countByStatus.get(task.status) ?? 0) + 1);
  }
  const countOf = (status: TaskStatus) => countByStatus.get(status) ?? 0;

  const segments = GOAL_PATH_SEGMENT_STATUSES.map((status) => ({ status, count: countOf(status) })).filter(
    (segment) => segment.count > 0,
  );
  const attention: GoalPathAttentionItem[] = [
    { kind: "running", count: countOf("running") },
    { kind: "in_review", count: countOf("in_review") },
    { kind: "blocked", count: countOf("blocked") },
    { kind: "runnable", count: tasks.filter((task) => task.isRunnable).length },
  ];

  return {
    segments,
    attention: attention.filter((item) => item.count > 0),
    isAllDraft: tasks.length > 0 && countOf("inbox") === tasks.length,
    remainingTasks: tasks.length,
    remainingSteps: stages.length,
  };
}

/**
 * 把通过未完成依赖相互连通的任务合为一组，构建执行拓扑
 *
 * 核心设计准则：
 * 1. 未完成任务之间只要存在依赖边（不论方向，也不论间接）就属于同一组，
 *    多个终点共用的前置只出现一次；
 * 2. 已完成任务不进入拓扑，也不会把被它关联的两部分连成一组；
 * 3. 终点是组内没有未完成下游的任务，组内有一个终点时标题为该终点的标题，
 *    有多个终点时为“<首个终点标题> 等 N 个目标”；
 * 4. 没有任何未完成前置和下游的孤立任务不成组；
 * 5. 同一 taskId 只出现一次，阶段按最长依赖路径分层。
 */
export function buildConnectedDagGraphs(
  status: ProjectStatus,
  additionalCompletedTasks: TaskSummary[] = [],
): ConnectedDagGraph[] {
  const allTasks = buildTaskIndex(status, additionalCompletedTasks);

  // 1. 未完成任务集合（保持稳定顺序，忽略重复项）
  const incompleteIds = new Set<string>();
  const incompleteTasks: TaskSummary[] = [];
  for (const t of [
    ...status.current,
    ...status.inReview,
    ...status.next,
    ...status.inbox,
    ...status.blocked,
  ]) {
    if (incompleteIds.has(t.id)) continue;
    incompleteIds.add(t.id);
    incompleteTasks.push(t);
  }

  // 2. 按未完成依赖边求连通分量（并查集，边按无向处理）
  const parent = new Map<string, string>(incompleteTasks.map((t) => [t.id, t.id]));
  const findRoot = (taskId: string): string => {
    let root = taskId;
    while (parent.get(root) !== root) {
      root = parent.get(root) ?? root;
    }
    return root;
  };
  const incompleteDownstreamIds = new Set<string>();
  for (const t of incompleteTasks) {
    for (const depId of t.dependencyIds) {
      if (!incompleteIds.has(depId)) continue;
      incompleteDownstreamIds.add(depId);
      parent.set(findRoot(t.id), findRoot(depId));
    }
  }

  const componentsByRoot = new Map<string, string[]>();
  for (const t of incompleteTasks) {
    const root = findRoot(t.id);
    const members = componentsByRoot.get(root) || [];
    members.push(t.id);
    componentsByRoot.set(root, members);
  }

  // 3. 逐个连通分量构建拓扑：只有拥有两个及以上任务的分量才显示
  const graphs: ConnectedDagGraph[] = [];

  for (const groupNodeIds of componentsByRoot.values()) {
    if (groupNodeIds.length < 2) continue;
    const groupNodeSet = new Set(groupNodeIds);
    // 环内任务互为下游；没有任何终点的分量无法给出目标，不显示
    const goalCount = groupNodeIds.filter((id) => !incompleteDownstreamIds.has(id)).length;
    if (goalCount === 0) continue;

    // 组内直接依赖边
    const rawEdges: Array<{ from: string; to: string }> = [];
    const groupUpstreams = new Map<string, string[]>();
    const groupDownstreams = new Map<string, string[]>();
    for (const nodeId of groupNodeIds) {
      groupUpstreams.set(nodeId, []);
      groupDownstreams.set(nodeId, []);
    }
    for (const nodeId of groupNodeIds) {
      const task = allTasks.get(nodeId);
      if (task === undefined) continue;
      for (const depId of new Set(task.dependencyIds)) {
        if (!groupNodeSet.has(depId)) continue;
        rawEdges.push({ from: depId, to: nodeId });
        groupUpstreams.get(nodeId)?.push(depId);
        groupDownstreams.get(depId)?.push(nodeId);
      }
    }

    // 最长路径阶段分层 (Longest-Path Stage Layering)
    // 阶段 stage[v] = max(stage[u] + 1) for all u -> v
    const inDegrees = new Map<string, number>();
    for (const nodeId of groupNodeIds) {
      inDegrees.set(nodeId, 0);
    }
    for (const edge of rawEdges) {
      inDegrees.set(edge.to, (inDegrees.get(edge.to) || 0) + 1);
    }

    const stageMap = new Map<string, number>();
    const topoQueue: string[] = [];
    for (const [nodeId, inDegree] of inDegrees.entries()) {
      if (inDegree === 0) {
        stageMap.set(nodeId, 0);
        topoQueue.push(nodeId);
      }
    }

    const tempInDegrees = new Map(inDegrees);
    while (topoQueue.length > 0) {
      const nodeId = topoQueue.shift()!;
      const currentStage = stageMap.get(nodeId) || 0;
      for (const downstreamId of groupDownstreams.get(nodeId) || []) {
        const nextStageCandidate = currentStage + 1;
        if (nextStageCandidate > (stageMap.get(downstreamId) || 0)) {
          stageMap.set(downstreamId, nextStageCandidate);
        }
        const remainingDeg = (tempInDegrees.get(downstreamId) || 1) - 1;
        tempInDegrees.set(downstreamId, remainingDeg);
        if (remainingDeg === 0) {
          topoQueue.push(downstreamId);
        }
      }
    }

    // 容错：若存在环或未访问节点，赋予默认阶段
    for (const nodeId of groupNodeIds) {
      if (!stageMap.has(nodeId)) {
        stageMap.set(nodeId, 0);
      }
    }

    // 按 stageIndex 将任务分组到 stages
    const stagesByIndex = new Map<number, DagStageTask[]>();
    for (const nodeId of groupNodeIds) {
      const task = allTasks.get(nodeId);
      if (!task) continue;

      const stageIndex = stageMap.get(nodeId) || 0;
      const detail = computeTaskDependencyDetail(task, allTasks);

      const stageTask: DagStageTask = {
        id: task.id,
        title: task.title,
        status: task.status,
        isRunnable: detail.isRunnable,
        stageIndex,
        upstreamIds: groupUpstreams.get(nodeId) || [],
        downstreamIds: groupDownstreams.get(nodeId) || [],
        waitingCount: detail.waitingFor.length,
        isParallelStageTask: false, // 稍后在 stage 级别判定
        isGoal: !incompleteDownstreamIds.has(nodeId),
        prerequisites: [],
        isParallelCandidate: detail.isInboxParallelCandidate,
        deferrableSteps: 0,
      };

      const list = stagesByIndex.get(stageIndex) || [];
      list.push(stageTask);
      stagesByIndex.set(stageIndex, list);
    }

    const sortedStageIndexes = Array.from(stagesByIndex.keys()).sort((a, b) => a - b);
    const maxStageIndex = sortedStageIndexes[sortedStageIndexes.length - 1] ?? 0;

    const stages: DagStage[] = sortedStageIndexes.map((stageIdx, idx) => {
      const tasks = stagesByIndex.get(stageIdx) || [];
      // 对同阶段任务进行稳定排序：就绪可执行优先，其次按标题字母序
      tasks.sort((a, b) => {
        if (a.isRunnable !== b.isRunnable) {
          return a.isRunnable ? -1 : 1;
        }
        return a.title.localeCompare(b.title);
      });

      const isParallel = tasks.length > 1;
      // 只有组内唯一终点独占最后一步时，才是“最终目标”
      const isFinalGoal =
        goalCount === 1 && idx === sortedStageIndexes.length - 1 && tasks.length === 1 && maxStageIndex > 1;

      // 仅当该阶段存在 2 个及以上任务时，这些任务才属于同一组内的并行任务
      for (const task of tasks) {
        task.isParallelStageTask = isParallel;
      }
      let label = `${idx + 1} 步`;
      if (isFinalGoal) {
        label += " · 最终目标";
      } else if (idx === 0) {
        label += tasks.length > 1 ? " · 先做，可以同时做" : " · 先做";
      } else if (isParallel) {
        label += " · 可以同时做";
      } else {
        label += " · 接着做";
      }

      return {
        stageIndex: stageIdx,
        label,
        tasks,
        isParallel,
        isFinalGoal,
      };
    });

    // 传递归约：去除显示层的冗余边
    const reducedEdges = computeTransitiveReduction(groupNodeIds, rawEdges);

    // 卡片只显示去掉冗余后的直接前置，顺序与分步和同步内排序一致
    const stageTaskById = new Map<string, DagStageTask>();
    for (const task of stages.flatMap((stage) => stage.tasks)) {
      stageTaskById.set(task.id, task);
    }
    for (const edge of reducedEdges) {
      const from = stageTaskById.get(edge.from);
      if (from === undefined) continue;
      stageTaskById.get(edge.to)?.prerequisites.push({ id: from.id, title: from.title });
    }
    for (const task of stageTaskById.values()) {
      task.prerequisites.sort((a, b) => {
        const stageDiff =
          (stageTaskById.get(a.id)?.stageIndex ?? 0) - (stageTaskById.get(b.id)?.stageIndex ?? 0);
        return stageDiff !== 0 ? stageDiff : a.title.localeCompare(b.title);
      });
    }

    // 可延后步数：终点最晚排在最后一步，其余任务最晚比所有下游的最晚步早一步
    const latestStageById = new Map<string, number>();
    for (const task of [...stageTaskById.values()].sort((a, b) => b.stageIndex - a.stageIndex)) {
      const latest = task.isGoal
        ? maxStageIndex
        : Math.min(...task.downstreamIds.map((id) => (latestStageById.get(id) ?? maxStageIndex) - 1));
      latestStageById.set(task.id, latest);
      task.deferrableSteps = Math.max(0, latest - task.stageIndex);
    }

    // 终点按分步先后排列，同一步内沿用上面的排序
    const goals = stages.flatMap((stage) => stage.tasks.filter((task) => task.isGoal));
    const goalTitles = goals.map((task) => task.title);
    const title = goals.length > 1 ? `${goalTitles[0]} 等 ${goals.length} 个目标` : (goalTitles[0] ?? "");

    graphs.push({
      // 组 ID 只取决于终点集合，不随终点的展示顺序变化，界面据此在轮询后保持展开
      id: `dag-${goals
        .map((task) => task.id)
        .sort()
        .join("+")}`,
      title,
      goalTitles,
      overview: summarizeGoalPath(stages),
      taskIds: stages.flatMap((stage) => stage.tasks.map((task) => task.id)),
      stages,
      edges: reducedEdges,
      rawEdges,
    });
  }

  return graphs;
}

/**
 * 兼容旧命名的别名函数，直接返回按连通依赖图分组的执行拓扑集合
 */
export const buildExecutionFlowGroups = buildConnectedDagGraphs;
export type ExecutionFlowGroup = ConnectedDagGraph;
