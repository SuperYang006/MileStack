import React, { useEffect, useState } from "react";
import { GitFork, GitMerge, ArrowDown, ArrowRight, Zap, ChevronDown, ChevronRight, CheckCircle2, Clock } from "lucide-react";
import type { ProjectStatus, TaskStatus, TaskSummary } from "../types";
import {
  buildConnectedDagGraphs,
  computeDependencyChain,
  type ConnectedDagGraph,
  type DagStageTask,
  type GoalPathAttentionItem,
  type GoalPathSegmentStatus,
} from "../utils/dependencyGraph";
import { TaskIdBadge } from "./CopyTaskIdButton";

interface ExecutionFlowViewProps {
  status: ProjectStatus;
  additionalCompletedTasks?: TaskSummary[];
  onSelectTask: (taskId: string) => void;
}

function getStatusBadge(status: TaskStatus) {
  switch (status) {
    case "completed":
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-px rounded text-[10px] font-mono bg-emerald-950/60 text-emerald-300">
          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
          <span>已完成</span>
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-px rounded text-[10px] font-mono bg-cyan-950/60 text-cyan-300">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          <span>执行中</span>
        </span>
      );
    case "in_review":
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-px rounded text-[10px] font-mono bg-violet-950/60 text-violet-300">
          <Clock className="w-2.5 h-2.5 text-violet-400" />
          <span>待审核</span>
        </span>
      );
    case "ready":
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-px rounded text-[10px] font-mono bg-indigo-950/60 text-indigo-300">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          <span>就绪</span>
        </span>
      );
    case "blocked":
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-px rounded text-[10px] font-mono bg-rose-950/60 text-rose-300">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
          <span>阻塞</span>
        </span>
      );
    case "inbox":
    default:
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-px rounded text-[10px] font-mono bg-zinc-900 text-zinc-400">
          <span>草稿</span>
        </span>
      );
  }
}

// 卡片平时无边框：可执行任务靠左侧细色条区分，悬停时才出现 zinc-600 边框。
function getCardStyle(task: DagStageTask) {
  const border = task.isRunnable
    ? "border-transparent border-l-2 border-l-emerald-500 hover:border-y-zinc-600 hover:border-r-zinc-600"
    : "border-transparent hover:border-zinc-600";
  if (task.isRunnable) {
    return `bg-emerald-950/20 ${border}`;
  }
  if (task.status === "completed") {
    return `bg-zinc-900/50 opacity-90 ${border}`;
  }
  if (task.status === "running") {
    return `bg-cyan-950/20 ${border}`;
  }
  if (task.status === "in_review") {
    return `bg-violet-950/20 ${border}`;
  }
  if (task.status === "blocked") {
    return `bg-rose-950/20 ${border}`;
  }
  return `bg-zinc-900/80 ${border}`;
}

// 悬停或键盘聚焦一张卡片时：自己、上游、下游保持正常亮度，其余变暗；上游琥珀色、下游天蓝色圈出
function getHighlightStyle(relation: "self" | "upstream" | "downstream" | "other" | null) {
  switch (relation) {
    case "self":
      return "ring-1 ring-zinc-300";
    case "upstream":
      return "ring-1 ring-amber-400/80";
    case "downstream":
      return "ring-1 ring-sky-400/80";
    case "other":
      return "opacity-30";
    default:
      return "";
  }
}

// 进度条分段颜色与状态徽标的圆点一致
const SEGMENT_COLORS: Record<GoalPathSegmentStatus, string> = {
  running: "bg-cyan-400",
  in_review: "bg-violet-400",
  blocked: "bg-rose-400",
  ready: "bg-indigo-400",
  inbox: "bg-zinc-600",
};

const SEGMENT_LABELS: Record<GoalPathSegmentStatus, string> = {
  running: "执行中",
  in_review: "待审核",
  blocked: "阻塞",
  ready: "就绪",
  inbox: "草稿",
};

const ATTENTION_STYLES: Record<GoalPathAttentionItem["kind"], { label: string; className: string }> = {
  running: { label: "执行中", className: "text-cyan-300" },
  in_review: { label: "待审核", className: "text-violet-300" },
  blocked: { label: "阻塞", className: "text-rose-300" },
  runnable: { label: "可推进", className: "text-emerald-300" },
};

const GoalPathOverviewRow: React.FC<{
  graph: ConnectedDagGraph;
  isOpen: boolean;
  onToggle: () => void;
}> = ({ graph, isOpen, onToggle }) => {
  const { overview } = graph;
  const segmentSummary = overview.segments
    .map((segment) => `${SEGMENT_LABELS[segment.status]} ${segment.count}`)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className="w-full px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-left hover:bg-zinc-900/60 transition-colors cursor-pointer"
    >
      <span className="flex items-center space-x-2 min-w-0 flex-1 basis-40" title={graph.goalTitles.join("\n")}>
        <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
        <span className="font-semibold text-zinc-200 truncate text-xs">{graph.title}</span>
      </span>

      <span
        className="flex h-1.5 w-full sm:w-40 shrink-0 gap-px rounded-full overflow-hidden bg-zinc-800"
        title={segmentSummary}
      >
        {overview.segments.map((segment) => (
          <span
            key={segment.status}
            className={SEGMENT_COLORS[segment.status]}
            style={{ flex: `${segment.count} 1 0%` }}
          />
        ))}
      </span>

      {overview.attention.length > 0 || overview.isAllDraft ? (
        <span className="text-[11px] text-zinc-500 sm:w-72 sm:truncate">
          {overview.isAllDraft
            ? "全部是草稿"
            : overview.attention.map((item, index) => (
                <React.Fragment key={item.kind}>
                  {index > 0 && " · "}
                  <span className={ATTENTION_STYLES[item.kind].className}>
                    {ATTENTION_STYLES[item.kind].label} {item.count}
                  </span>
                </React.Fragment>
              ))}
        </span>
      ) : (
        <span className="hidden sm:block sm:w-72" />
      )}

      <span className="flex items-center space-x-2 shrink-0 ml-auto text-[11px] text-zinc-400">
        <span>
          剩 {overview.remainingTasks} 个 · {overview.remainingSteps} 步
        </span>
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
        )}
      </span>
    </button>
  );
};

const GoalPathStages: React.FC<{
  graph: ConnectedDagGraph;
  onSelectTask: (taskId: string) => void;
}> = ({ graph, onSelectTask }) => {
  // 当前悬停（鼠标）或聚焦（键盘）的卡片；任务从组内消失后不再生效
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const activeTaskStillShown = activeTaskId !== null && graph.taskIds.includes(activeTaskId);
  useEffect(() => {
    if (activeTaskId !== null && !activeTaskStillShown) {
      setActiveTaskId(null);
    }
  }, [activeTaskId, activeTaskStillShown]);
  const chain = activeTaskStillShown ? computeDependencyChain(activeTaskId, graph.rawEdges) : null;
  const clearActive = (taskId: string) => setActiveTaskId((current) => (current === taskId ? null : current));

  const getRelation = (taskId: string) => {
    if (chain === null) return null;
    if (taskId === activeTaskId) return "self";
    if (chain.upstream.has(taskId)) return "upstream";
    if (chain.downstream.has(taskId)) return "downstream";
    return "other";
  };

  return (
    // 阶段列表 (移动端纵向流，PC 端横向 Pipeline 泳道)
    <div className="flex flex-col md:flex-row md:items-stretch gap-3 md:gap-2.5 overflow-x-auto pb-1">
      {graph.stages.map((stage, stageIdx) => (
        <React.Fragment key={`stage-wrapper-${stage.stageIndex}`}>
          {/* 阶段间的流转指示器 */}
          {stageIdx > 0 && (
            <>
              {/* 移动端垂直流转指示 */}
              <div className="md:hidden py-1">
                {stage.isParallel ? (
                  <div className="flex items-center justify-center gap-2 text-zinc-600 text-[10px]">
                    <div className="h-px bg-zinc-800 flex-1" />
                    <div className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-indigo-300 shrink-0">
                      <GitFork className="w-3 h-3 text-indigo-400" />
                      <span>这里可以同时做 {stage.tasks.length} 件</span>
                    </div>
                    <div className="h-px bg-zinc-800 flex-1" />
                  </div>
                ) : stage.isFinalGoal ? (
                  <div className="flex items-center justify-center gap-2 text-zinc-600 text-[10px]">
                    <div className="h-px bg-zinc-800 flex-1" />
                    <div className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-amber-300 shrink-0">
                      <GitMerge className="w-3 h-3 text-amber-400" />
                      <span>都做完后才能继续</span>
                    </div>
                    <div className="h-px bg-zinc-800 flex-1" />
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-zinc-600 text-[10px]">
                    <div className="h-px bg-zinc-800/80 flex-1" />
                    <ArrowDown className="w-3 h-3 text-zinc-600 shrink-0" />
                    <div className="h-px bg-zinc-800/80 flex-1" />
                  </div>
                )}
              </div>
  
              {/* PC 宽屏横向流转连接器 */}
              <div className="hidden md:flex flex-col items-center justify-center shrink-0 px-0.5 text-zinc-600 self-center">
                {stage.isParallel ? (
                  <div
                    className="flex flex-col items-center space-y-1 p-1.5 rounded bg-zinc-900/80 border border-zinc-800 text-indigo-400"
                    title={`这里可以同时做 ${stage.tasks.length} 件`}
                  >
                    <GitFork className="w-3.5 h-3.5" />
                    <ArrowRight className="w-3 h-3 text-zinc-500" />
                  </div>
                ) : stage.isFinalGoal ? (
                  <div
                    className="flex flex-col items-center space-y-1 p-1.5 rounded bg-zinc-900/80 border border-zinc-800 text-amber-400"
                    title="都做完后才能继续"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    <ArrowRight className="w-3 h-3 text-zinc-500" />
                  </div>
                ) : (
                  <div className="flex items-center justify-center p-1 text-zinc-600">
                    <ArrowRight className="w-4 h-4 text-zinc-600" />
                  </div>
                )}
              </div>
            </>
          )}
  
          {/* 阶段泳道列 (PC 端自适应等宽弹性列) */}
          <div className="flex-1 min-w-[250px] flex flex-col space-y-2 rounded-md bg-zinc-900/20 p-2.5">
            {/* 阶段标题栏 */}
            <div className="flex items-center justify-between text-[11px] text-zinc-400 pb-1.5">
              <div className="flex items-center space-x-1.5 min-w-0">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    stage.isParallel ? "bg-indigo-400" : stage.isFinalGoal ? "bg-amber-400" : "bg-zinc-500"
                  }`}
                />
                <span className="font-semibold text-zinc-300 truncate text-[11px]" title={stage.label}>
                  {stage.label}
                </span>
              </div>
              {stage.isParallel && (
                <span className="text-[9px] px-1.5 py-px rounded bg-indigo-950/70 border border-indigo-800/60 text-indigo-300 shrink-0">
                  并行
                </span>
              )}
            </div>
  
            {/* 阶段内任务卡片列表 (PC 端纵向分支排布，移动端适度分列) */}
            <div className="flex-1 flex flex-col justify-start gap-2">
              {stage.tasks.map((task) => (
                <div
                  key={task.id}
                  tabIndex={0}
                  onClick={() => onSelectTask(task.id)}
                  onKeyDown={(event) => {
                    // 卡片内的复制按钮自己处理 Enter
                    if (event.key === "Enter" && event.target === event.currentTarget) {
                      onSelectTask(task.id);
                    }
                  }}
                  // 触屏的点按也会触发鼠标进入和焦点事件，只响应鼠标和键盘
                  onPointerEnter={(event) => {
                    if (event.pointerType === "mouse") setActiveTaskId(task.id);
                  }}
                  onPointerLeave={() => clearActive(task.id)}
                  onFocus={(event) => {
                    if (event.target === event.currentTarget && event.currentTarget.matches(":focus-visible")) {
                      setActiveTaskId(task.id);
                    }
                  }}
                  onBlur={(event) => {
                    if (event.target === event.currentTarget) clearActive(task.id);
                  }}
                  className={`min-w-0 flex flex-col justify-between p-2.5 rounded border transition cursor-pointer gap-2 outline-none focus-visible:ring-1 focus-visible:ring-zinc-300 ${getCardStyle(
                    task,
                  )} ${getHighlightStyle(getRelation(task.id))}`}
                >
                  {/* 卡片顶栏: 短编号 + 状态徽标，终点为弱化小字 */}
                  <div className="flex items-center gap-2 min-w-0">
                    <TaskIdBadge taskId={task.id} displayLength={8} variant="muted" />
                    {getStatusBadge(task.status)}
                    {task.isGoal && <span className="ml-auto shrink-0 text-[10px] text-zinc-500">终点</span>}
                  </div>
  
                  {/* 任务标题 */}
                  <h4
                    className="text-zinc-50 text-[13px] font-semibold line-clamp-2 leading-snug"
                    title={task.title}
                  >
                    {task.title}
                  </h4>
  
                  {/* 组内直接前置：短码，悬停显示标题 */}
                  {task.prerequisites.length > 0 && (
                    <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-[10px] text-zinc-500">
                      <span className="shrink-0">前置</span>
                      {task.prerequisites.map((dep) => (
                        <span
                          key={dep.id}
                          className="px-1.5 py-px rounded font-mono text-zinc-400 bg-zinc-900/60 border border-zinc-800/70"
                          title={dep.title}
                        >
                          #{dep.id.slice(0, 8)}
                        </span>
                      ))}
                    </div>
                  )}
  
                  {(task.isRunnable ||
                    task.isParallelCandidate ||
                    task.deferrableSteps > 0 ||
                    task.waitingCount > 0) && (
                    <div className="flex items-center flex-wrap gap-1.5 text-[10px] text-zinc-500">
                      {task.isRunnable && (
                        <span className="inline-flex items-center space-x-0.5 px-1.5 py-px rounded text-[9px] bg-emerald-950/80 border border-emerald-700/60 text-emerald-300">
                          <Zap className="w-2.5 h-2.5 text-emerald-400" />
                          <span>{task.isParallelStageTask ? "可并行" : "可推进"}</span>
                        </span>
                      )}
                      {task.isParallelCandidate && (
                        <span
                          className="inline-flex items-center space-x-0.5 px-1.5 py-px rounded text-[9px] bg-indigo-950/50 border border-indigo-900/60 text-indigo-300"
                          title="无未完成前置依赖，排入就绪队列后可并行执行"
                        >
                          <Zap className="w-2.5 h-2.5 text-indigo-400" />
                          <span>可并行候选</span>
                        </span>
                      )}
                      {task.deferrableSteps > 0 && (
                        <span
                          className="px-1.5 py-px rounded bg-zinc-800/60 border border-zinc-700/60 text-zinc-400"
                          title="不在关键路径上，晚点做也不会增加整组完成所需的步数"
                        >
                          可延后 {task.deferrableSteps} 步
                        </span>
                      )}
                      {task.waitingCount > 0 && <span>等待 {task.waitingCount} 项</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};

export const ExecutionFlowView: React.FC<ExecutionFlowViewProps> = ({
  status,
  additionalCompletedTasks = [],
  onSelectTask,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  // 同一时间最多展开一组；轮询刷新后按组 ID 保持展开
  const [openGraphId, setOpenGraphId] = useState<string | null>(null);
  const graphs = buildConnectedDagGraphs(status, additionalCompletedTasks);
  const openGraphStillShown = graphs.some((graph) => graph.id === openGraphId);

  // 展开的组不再显示时，所有组回到收起状态，避免它再次出现时自动展开
  useEffect(() => {
    if (openGraphId !== null && !openGraphStillShown) {
      setOpenGraphId(null);
    }
  }, [openGraphId, openGraphStillShown]);

  if (graphs.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-zinc-800/90 bg-zinc-900/40 backdrop-blur-xs overflow-hidden lg:flex lg:max-h-[30vh] lg:min-h-0 lg:shrink-0 lg:flex-col">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full shrink-0 px-4 py-2.5 bg-zinc-900/60 hover:bg-zinc-900 flex items-center justify-between text-left transition-colors cursor-pointer"
      >
        <div className="flex items-center space-x-2">
          <GitFork className="w-3.5 h-3.5 text-indigo-400" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase">
            目标路径 ({graphs.length})
          </h2>
          <span className="text-[11px] font-mono text-zinc-500 hidden sm:inline">
            · 相互关联的未完成任务，按先后分步
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-[10px] font-mono text-zinc-500">
            {isExpanded ? "收起" : "展开"}
          </span>
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="p-3 space-y-1.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {graphs.map((graph: ConnectedDagGraph) => {
            const isOpen = graph.id === openGraphId;
            return (
              <div key={graph.id} className="rounded-md bg-zinc-950/70 border border-zinc-800 font-mono text-xs">
                <GoalPathOverviewRow
                  graph={graph}
                  isOpen={isOpen}
                  onToggle={() => setOpenGraphId(isOpen ? null : graph.id)}
                />
                {isOpen && (
                  <div className="p-3 pt-2 border-t border-zinc-800/80">
                    <GoalPathStages graph={graph} onSelectTask={onSelectTask} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
