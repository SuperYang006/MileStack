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
  /** 除本组目标外，还有多少个目标（组）也依赖该任务 */
  otherGoalCount: number;
}

export interface DagStage {
  stageIndex: number;
  label: string;
  tasks: DagStageTask[];
  /** 该阶段是否包含多个并行分支任务 */
  isParallel: boolean;
}

export interface ConnectedDagGraph {
  id: string;
  title: string;
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
 * 按最终目标对未完成依赖图分组，构建执行拓扑
 *
 * 核心设计准则：
 * 1. 每个还没有未完成下游的任务各自作为目标成组，分组标题即该目标的任务标题；
 * 2. 组内只包含该目标与能走到它的未完成前置（含间接前置），
 *    直线上的中间任务不另开组，已完成任务不进入拓扑；
 * 3. 多条分支汇合到同一个目标仍是一组，标题用汇合后的目标任务；
 * 4. 只共用一个前置的不同目标拆成多组，共用前置在每组里注明还被其他目标依赖；
 * 5. 同一 taskId 在同一组内只出现一次，阶段分层只反映组内真实依赖。
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
  const isIncomplete = (taskId: string): boolean => incompleteIds.has(taskId);

  // 2. 统计每个任务被多少未完成任务直接依赖，用于识别目标
  const incompleteDownstreamCount = new Map<string, number>();
  for (const t of incompleteTasks) {
    for (const depId of new Set(t.dependencyIds)) {
      incompleteDownstreamCount.set(depId, (incompleteDownstreamCount.get(depId) || 0) + 1);
    }
  }

  // 目标：没有任何未完成下游的任务
  const goals = incompleteTasks.filter((t) => (incompleteDownstreamCount.get(t.id) || 0) === 0);

  // 3. 为每个目标收集能走到它的未完成前置闭包（只沿未完成依赖继续向上）
  const membersByGoal = new Map<string, string[]>();
  const goalIdsByTask = new Map<string, string[]>();
  const addGoalDependency = (taskId: string, goalId: string): void => {
    const list = goalIdsByTask.get(taskId) || [];
    list.push(goalId);
    goalIdsByTask.set(taskId, list);
  };

  for (const goal of goals) {
    const members: string[] = [];
    const visited = new Set<string>([goal.id]);
    const queue = goal.dependencyIds.filter(isIncomplete);
    while (queue.length > 0) {
      const taskId = queue.shift()!;
      if (visited.has(taskId)) continue;
      visited.add(taskId);
      members.push(taskId);
      const task = allTasks.get(taskId);
      if (task !== undefined) {
        for (const depId of task.dependencyIds) {
          if (!visited.has(depId) && isIncomplete(depId)) {
            queue.push(depId);
          }
        }
      }
    }
    membersByGoal.set(goal.id, members);
    addGoalDependency(goal.id, goal.id);
    for (const memberId of members) {
      addGoalDependency(memberId, goal.id);
    }
  }

  // 4. 逐目标构建分组拓扑：只有拥有未完成前置的目标才显示
  const graphs: ConnectedDagGraph[] = [];

  for (const goal of goals) {
    const members = membersByGoal.get(goal.id) || [];
    if (members.length === 0) continue;

    const groupNodeIds = [goal.id, ...members];
    const groupNodeSet = new Set(groupNodeIds);

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
      const otherGoalCount = (goalIdsByTask.get(nodeId) || []).filter(
        (goalId) => goalId !== goal.id,
      ).length;

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
        otherGoalCount,
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

      // 仅当该阶段存在 2 个及以上任务时，这些任务才属于同一目标下的并行前置
      for (const task of tasks) {
        task.isParallelStageTask = isParallel;
      }
      let label = `${idx + 1} 步`;
      if (idx === sortedStageIndexes.length - 1 && tasks.length === 1 && maxStageIndex > 1) {
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
      };
    });

    // 传递归约：去除显示层的冗余边
    const reducedEdges = computeTransitiveReduction(groupNodeIds, rawEdges);

    graphs.push({
      id: `dag-${goal.id}`,
      title: goal.title,
      taskIds: stages.flatMap((stage) => stage.tasks.map((task) => task.id)),
      stages,
      edges: reducedEdges,
      rawEdges,
    });
  }

  return graphs;
}

/**
 * 兼容旧命名的别名函数，直接返回按最终目标分组的执行拓扑集合
 */
export const buildExecutionFlowGroups = buildConnectedDagGraphs;
export type ExecutionFlowGroup = ConnectedDagGraph;
