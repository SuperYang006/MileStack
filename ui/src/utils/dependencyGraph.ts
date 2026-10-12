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
 * 基于全量活跃依赖图构建无重复节点、分层阶段清晰的连通 DAG 拓扑
 *
 * 核心设计准则：
 * 1. 同一连通依赖图只显示为一个拓扑，同一 taskId 在该拓扑中只出现一次；
 * 2. 支持分支深度不一致的非对称 DAG；
 * 3. 只有处于同一执行层级且互不依赖的任务才标记为并行；
 * 4. 忽略传递依赖造成的冗余边；
 * 5. 多个互不相连的子图分别输出独立的连通拓扑，互不混淆。
 */
export function buildConnectedDagGraphs(
  status: ProjectStatus,
  additionalCompletedTasks: TaskSummary[] = [],
): ConnectedDagGraph[] {
  const allTasks = buildTaskIndex(status, additionalCompletedTasks);

  // 1. 提取活跃任务集合
  const activeTasks = [
    ...status.current,
    ...status.inReview,
    ...status.next,
    ...status.inbox,
    ...status.blocked,
  ];

  // 2. 统计每个前置任务在活跃任务中的直接下游数量
  const activeDownstreamCount = new Map<string, number>();
  for (const t of activeTasks) {
    for (const depId of t.dependencyIds) {
      activeDownstreamCount.set(depId, (activeDownstreamCount.get(depId) || 0) + 1);
    }
  }

  // 若已完成任务作为分叉源（在活跃任务中拥有 >= 2 个下游分支），将其作为根输入纳入候选拓扑
  const completedTasks = Array.from(
    new Map(
      [...status.recentlyCompleted, ...additionalCompletedTasks].map((task) => [
        task.id,
        task,
      ]),
    ).values(),
  );
  const forkCompletedRoots = completedTasks.filter((t) => {
    return (activeDownstreamCount.get(t.id) || 0) >= 2;
  });

  const candidateTasks = [...activeTasks, ...forkCompletedRoots];
  const candidateIds = new Set(candidateTasks.map((t) => t.id));

  // 3. 建立候选任务之间的内部依赖邻接
  const internalDependencies = new Map<string, string[]>();
  const internalDownstreams = new Map<string, string[]>();
  const rawEdges: Array<{ from: string; to: string }> = [];

  for (const t of candidateTasks) {
    internalDependencies.set(t.id, []);
    internalDownstreams.set(t.id, []);
  }

  for (const t of candidateTasks) {
    const uniqueDepIds = Array.from(new Set(t.dependencyIds));
    for (const depId of uniqueDepIds) {
      if (candidateIds.has(depId)) {
        internalDependencies.get(t.id)?.push(depId);
        internalDownstreams.get(depId)?.push(t.id);
        rawEdges.push({ from: depId, to: t.id });
      }
    }
  }

  // 4. 找出所有实际参与依赖关系的任务（有内部前置或内部后置）
  const connectedNodeIds = new Set<string>();
  for (const t of candidateTasks) {
    const deps = internalDependencies.get(t.id) || [];
    const downs = internalDownstreams.get(t.id) || [];
    if (deps.length > 0 || downs.length > 0) {
      connectedNodeIds.add(t.id);
    }
  }

  if (connectedNodeIds.size === 0) {
    return [];
  }

  // 计算无向连通分量 (Weakly Connected Components)
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const nodeId of connectedNodeIds) {
    if (visited.has(nodeId)) continue;

    const component: string[] = [];
    const queue = [nodeId];
    visited.add(nodeId);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(curr);

      const neighbors = [
        ...(internalDependencies.get(curr) || []),
        ...(internalDownstreams.get(curr) || []),
      ];

      for (const neighbor of neighbors) {
        if (connectedNodeIds.has(neighbor) && !visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    components.push(component);
  }

  const graphs: ConnectedDagGraph[] = [];

  for (let compIndex = 0; compIndex < components.length; compIndex += 1) {
    const componentNodeIds = components[compIndex];
    if (!componentNodeIds || componentNodeIds.length === 0) continue;

    const componentNodeSet = new Set(componentNodeIds);

    // 提取当前分量内部的边
    const compEdges = rawEdges.filter(
      (e) => componentNodeSet.has(e.from) && componentNodeSet.has(e.to),
    );

    // 计算分量内部的最长路径阶段 (Longest-Path Stage Layering)
    // 阶段 stage[v] = max(stage[u] + 1) for all u -> v
    const inDegrees = new Map<string, number>();
    for (const id of componentNodeIds) {
      inDegrees.set(id, 0);
    }
    for (const edge of compEdges) {
      inDegrees.set(edge.to, (inDegrees.get(edge.to) || 0) + 1);
    }

    const stageMap = new Map<string, number>();
    const topoQueue: string[] = [];

    for (const [id, inDeg] of inDegrees.entries()) {
      if (inDeg === 0) {
        stageMap.set(id, 0);
        topoQueue.push(id);
      }
    }

    // 拓扑排序计算最长路径
    const tempInDegrees = new Map(inDegrees);
    while (topoQueue.length > 0) {
      const u = topoQueue.shift()!;
      const currentStage = stageMap.get(u) || 0;
      const downstreams = (internalDownstreams.get(u) || []).filter((id) =>
        componentNodeSet.has(id),
      );

      for (const v of downstreams) {
        const nextStageCandidate = currentStage + 1;
        const existingStage = stageMap.get(v) || 0;
        if (nextStageCandidate > existingStage) {
          stageMap.set(v, nextStageCandidate);
        }

        const remainingDeg = (tempInDegrees.get(v) || 1) - 1;
        tempInDegrees.set(v, remainingDeg);
        if (remainingDeg === 0) {
          topoQueue.push(v);
        }
      }
    }

    // 容错：若存在环或未访问节点，赋予默认阶段
    for (const id of componentNodeIds) {
      if (!stageMap.has(id)) {
        stageMap.set(id, 0);
      }
    }

    // 按 stageIndex 将任务分组到 stages
    const stagesByIndex = new Map<number, DagStageTask[]>();
    for (const id of componentNodeIds) {
      const task = allTasks.get(id);
      if (!task) continue;

      const stageIndex = stageMap.get(id) || 0;
      const detail = computeTaskDependencyDetail(task, allTasks);

      const upstreamIds = (internalDependencies.get(id) || []).filter((u) =>
        componentNodeSet.has(u),
      );
      const downstreamIds = (internalDownstreams.get(id) || []).filter((d) =>
        componentNodeSet.has(d),
      );

      const stageTask: DagStageTask = {
        id: task.id,
        title: task.title,
        status: task.status,
        isRunnable: detail.isRunnable,
        stageIndex,
        upstreamIds,
        downstreamIds,
        waitingCount: detail.waitingFor.length,
        isParallelStageTask: false, // 稍后在 stage 级别判定
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

      // 仅当该阶段存在 2 个及以上任务时，这些任务才真正属于可并行组
      for (const t of tasks) {
        t.isParallelStageTask = isParallel;
      }
      let label = `阶段 ${idx + 1}`;
      if (idx === 0) {
        label += tasks.length > 1 ? ` · 初始并行输入 (${tasks.length} 项)` : " · 核心输入";
      } else if (idx === sortedStageIndexes.length - 1 && tasks.length === 1 && maxStageIndex > 1) {
        label += " · 汇合验证目标";
      } else if (isParallel) {
        label += ` · 并行分支推进 (${tasks.length} 个任务)`;
      } else {
        label += " · 后续分支推进";
      }

      return {
        stageIndex: stageIdx,
        label,
        tasks,
        isParallel,
      };
    });

    // 传递归约：去除显示层的冗余边
    const reducedEdges = computeTransitiveReduction(componentNodeIds, compEdges);

    // 拓扑图标题
    const rootTasks = stages[0]?.tasks || [];
    let graphTitle = `连通执行拓扑 #${compIndex + 1}`;
    if (rootTasks.length === 1 && rootTasks[0]) {
      graphTitle = `执行拓扑: ${rootTasks[0].title}`;
    } else if (rootTasks.length > 1) {
      graphTitle = `执行拓扑: 多源输入 (${rootTasks.length} 项)`;
    }
    graphs.push({
      id: `dag-${componentNodeIds[0]}`,
      title: graphTitle,
      taskIds: componentNodeIds,
      stages,
      edges: reducedEdges,
      rawEdges: compEdges,
    });
  }

  return graphs;
}

/**
 * 兼容旧命名的别名函数，直接返回连通 DAG 拓扑集合
 */
export const buildExecutionFlowGroups = buildConnectedDagGraphs;
export type ExecutionFlowGroup = ConnectedDagGraph;
