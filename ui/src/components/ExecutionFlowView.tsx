import React, { useState } from "react";
import { GitFork, GitMerge, ArrowDown, ArrowRight, Zap, ChevronDown, ChevronRight, CheckCircle2, Clock } from "lucide-react";
import type { ProjectStatus, TaskStatus, TaskSummary } from "../types";
import {
  buildConnectedDagGraphs,
  type ConnectedDagGraph,
  type DagStageTask,
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
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-950/60 text-emerald-300">
          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
          <span>已完成</span>
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-cyan-950/60 text-cyan-300">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          <span>执行中</span>
        </span>
      );
    case "in_review":
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-violet-950/60 text-violet-300">
          <Clock className="w-2.5 h-2.5 text-violet-400" />
          <span>待审核</span>
        </span>
      );
    case "ready":
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-indigo-950/60 text-indigo-300">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          <span>就绪</span>
        </span>
      );
    case "blocked":
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-950/60 text-rose-300">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
          <span>阻塞</span>
        </span>
      );
    case "inbox":
    default:
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-zinc-900 text-zinc-400">
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

export const ExecutionFlowView: React.FC<ExecutionFlowViewProps> = ({
  status,
  additionalCompletedTasks = [],
  onSelectTask,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const graphs = buildConnectedDagGraphs(status, additionalCompletedTasks);

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
            · 每个最终目标，以及还没做完的前置工作
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
        <div className="p-4 space-y-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {graphs.map((graph: ConnectedDagGraph) => (
            <div
              key={graph.id}
              className="p-3.5 rounded-md bg-zinc-950/70 border border-zinc-800 space-y-4 font-mono text-xs"
            >
              {/* 拓扑图头部 */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5">
                <div className="flex items-center space-x-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                  <span className="font-semibold text-zinc-200 truncate text-xs">
                    {graph.title}
                  </span>
                </div>
                <div className="flex items-center space-x-2 shrink-0 text-[10px] text-zinc-500">
                  <span>共 {graph.taskIds.length} 个任务</span>
                  <span>·</span>
                  <span>{graph.stages.length} 步</span>
                </div>
              </div>

              {/* 阶段列表 (移动端纵向流，PC 端横向 Pipeline 泳道) */}
              <div className="flex flex-col md:flex-row md:items-stretch gap-3 md:gap-2.5 overflow-x-auto pb-1">
                {graph.stages.map((stage, stageIdx) => {
                  const isLastStage = stageIdx === graph.stages.length - 1;
                  const isMultiTask = stage.tasks.length > 1;

                  return (
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
                            ) : isLastStage && graph.stages.length > 2 && stage.tasks.length === 1 ? (
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
                            ) : isLastStage && graph.stages.length > 2 && stage.tasks.length === 1 ? (
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
                                stage.isParallel
                                  ? "bg-indigo-400"
                                  : isLastStage && graph.stages.length > 2
                                  ? "bg-amber-400"
                                  : "bg-zinc-500"
                              }`}
                            />
                            <span className="font-semibold text-zinc-300 truncate text-[11px]" title={stage.label}>
                              {stage.label}
                            </span>
                          </div>
                          {stage.isParallel && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-950/70 border border-indigo-800/60 text-indigo-300 shrink-0">
                              并行
                            </span>
                          )}
                        </div>

                        {/* 阶段内任务卡片列表 (PC 端纵向分支排布，移动端适度分列) */}
                        <div className="flex-1 flex flex-col justify-start gap-2">
                          {stage.tasks.map((task) => (
                            <div
                              key={task.id}
                              onClick={() => onSelectTask(task.id)}
                              className={`min-w-0 flex flex-col justify-between p-2.5 rounded border transition-colors cursor-pointer gap-2 ${getCardStyle(
                                task,
                              )}`}
                            >
                              {/* 卡片顶栏: TaskId + 右侧徽标 */}
                              <div className="flex items-center justify-between gap-2 min-w-0">
                                <div className="min-w-0 flex items-center">
                                  <TaskIdBadge taskId={task.id} variant="muted" />
                                </div>
                                <div className="shrink-0 flex items-center space-x-1.5">
                                  {task.isRunnable && (
                                    <span className="inline-flex items-center space-x-0.5 px-1.5 py-0.2 rounded text-[9px] bg-emerald-950/80 border border-emerald-700/60 text-emerald-300">
                                      <Zap className="w-2.5 h-2.5 text-emerald-400" />
                                      <span>{task.isParallelStageTask ? "可并行" : "可推进"}</span>
                                    </span>
                                  )}
                                  {task.waitingCount > 0 && (
                                    <span className="text-[10px] text-zinc-500 hidden sm:inline">
                                      等待 {task.waitingCount} 项
                                    </span>
                                  )}
                                  {getStatusBadge(task.status)}
                                </div>
                              </div>

                              {/* 任务标题 */}
                              <h4
                                className="text-zinc-200 text-xs font-medium line-clamp-2 leading-relaxed"
                                title={task.title}
                              >
                                {task.title}
                              </h4>

                              {/* 共用前置：还被其他目标依赖 */}
                              {task.otherGoalCount > 0 && (
                                <div className="flex items-center space-x-1 text-[10px] text-amber-300/90">
                                  <GitMerge className="w-2.5 h-2.5 text-amber-400/80 shrink-0" />
                                  <span>还被另外 {task.otherGoalCount} 个目标依赖</span>
                                </div>
                              )}

                              {/* 小屏下折行显示的等待项 */}
                              {task.waitingCount > 0 && (
                                <div className="text-[10px] text-zinc-500 font-mono sm:hidden">
                                  等待 {task.waitingCount} 项依赖
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
