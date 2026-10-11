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

export interface ExecutionFlowBranch {
  id: string;
  title: string;
  status: TaskStatus;
  isRunnable: boolean;
}

export interface ExecutionFlowGroup {
  id: string;
  type: "chain" | "fork_merge" | "fork";
  root: {
    id: string;
    title: string;
    status: TaskStatus;
    isCompleted: boolean;
  };
  branches: ExecutionFlowBranch[];
  mergeTarget?: {
    id: string;
    title: string;
    status: TaskStatus;
    waitingCount: number;
  } | undefined;
}

/**
 * 汇总项目所有板块任务形成 ID 映射表
 */
export function buildTaskIndex(status: ProjectStatus): Map<string, TaskSummary> {
  const map = new Map<string, TaskSummary>();
  const all = [
    ...status.current,
    ...status.next,
    ...status.inReview,
    ...status.blocked,
    ...status.inbox,
    ...status.recentlyCompleted,
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
 * 构建紧凑的执行关系视图结构 (前置 -> 并行分支 -> 汇合)
 * 仅聚焦正在活跃（current / inReview / next / 关键 inbox）的依赖关联链路，避免历史已完成大图干扰
 */
export function buildExecutionFlowGroups(status: ProjectStatus): ExecutionFlowGroup[] {
  const allTasks = buildTaskIndex(status);
  const downstreamMap = buildDownstreamMap(allTasks);

  // 活跃任务集合（排除了纯历史已完成且无未完成下游的任务）
  const activeTasks = [...status.current, ...status.inReview, ...status.next, ...status.inbox];
  const activeIds = new Set(activeTasks.map((t) => t.id));

  const groups: ExecutionFlowGroup[] = [];
  const processedRoots = new Set<string>();

  // 1. 寻找有多个活跃下游的前置任务 (Fork / Branching point)
  for (const task of activeTasks) {
    const downstreamIds = downstreamMap.get(task.id) || [];
    const activeDownstreams = downstreamIds
      .map((id) => allTasks.get(id))
      .filter((t): t is TaskSummary => !!t && activeIds.has(t.id));

    if (activeDownstreams.length >= 2) {
      // 存在 2 个以上下游，构成并行分支群组
      processedRoots.add(task.id);

      const branches: ExecutionFlowBranch[] = activeDownstreams.map((down) => {
        const detail = computeTaskDependencyDetail(down, allTasks, downstreamMap);
        return {
          id: down.id,
          title: down.title,
          status: down.status,
          isRunnable: detail.isRunnable,
        };
      });

      // 检查是否有共同的下游汇合任务 (Merge target)
      let mergeTarget: ExecutionFlowGroup["mergeTarget"] = undefined;
      const firstBranch = branches[0];
      const firstBranchDownstreams = firstBranch ? downstreamMap.get(firstBranch.id) || [] : [];
      for (const possibleMergeId of firstBranchDownstreams) {
        if (!activeIds.has(possibleMergeId)) continue;
        const candidate = allTasks.get(possibleMergeId);
        if (!candidate) continue;

        // 检查是否其它分支也指向 candidate
        const allBranchesPointToCandidate = branches.every((b) =>
          candidate.dependencyIds.includes(b.id),
        );

        if (allBranchesPointToCandidate) {
          const detail = computeTaskDependencyDetail(candidate, allTasks, downstreamMap);
          mergeTarget = {
            id: candidate.id,
            title: candidate.title,
            status: candidate.status,
            waitingCount: detail.waitingFor.length,
          };
          break;
        }
      }

      groups.push({
        id: `fork-${task.id}`,
        type: mergeTarget ? "fork_merge" : "fork",
        root: {
          id: task.id,
          title: task.title,
          status: task.status,
          isCompleted: task.status === "completed",
        },
        branches,
        mergeTarget,
      });
    }
  }

  // 2. 检查是否有汇合任务（有多个前置活跃依赖，但在步骤 1 未被捕获）
  for (const task of activeTasks) {
    if (task.dependencyIds.length >= 2) {
      const activeUpstream = task.dependencyIds
        .map((id: string) => allTasks.get(id))
        .filter((t: TaskSummary | undefined): t is TaskSummary => !!t && activeIds.has(t.id));

      if (activeUpstream.length >= 2) {
        // 如果还没有被收入群组
        const alreadyCovered = groups.some(
          (g) => g.mergeTarget?.id === task.id || g.branches.some((b) => b.id === task.id),
        );

        if (!alreadyCovered) {
          const branches: ExecutionFlowBranch[] = activeUpstream.map((up: TaskSummary) => {
            const detail = computeTaskDependencyDetail(up, allTasks, downstreamMap);
            return {
              id: up.id,
              title: up.title,
              status: up.status,
              isRunnable: detail.isRunnable,
            };
          });

          const detail = computeTaskDependencyDetail(task, allTasks, downstreamMap);
          groups.push({
            id: `merge-${task.id}`,
            type: "fork_merge",
            root: {
              id: "multi-roots",
              title: "并行前置输入",
              status: "ready",
              isCompleted: false,
            },
            branches,
            mergeTarget: {
              id: task.id,
              title: task.title,
              status: task.status,
              waitingCount: detail.waitingFor.length,
            },
          });
        }
      }
    }
  }

  // 3. 补充简单的链式依赖 (A -> B)，限当前或就绪活跃任务中重要的依赖链路
  for (const task of activeTasks) {
    if (task.dependencyIds.length === 1 && !groups.some((g) => g.root.id === task.id || g.branches.some((b) => b.id === task.id))) {
      const parentId = task.dependencyIds[0];
      if (!parentId) continue;
      const parent = allTasks.get(parentId);
      if (parent && activeIds.has(parent.id)) {
        const detail = computeTaskDependencyDetail(task, allTasks, downstreamMap);
        groups.push({
          id: `chain-${parent.id}-${task.id}`,
          type: "chain",
          root: {
            id: parent.id,
            title: parent.title,
            status: parent.status,
            isCompleted: parent.status === "completed",
          },
          branches: [
            {
              id: task.id,
              title: task.title,
              status: task.status,
              isRunnable: detail.isRunnable,
            },
          ],
        });
      }
    }
  }

  return groups;
}
