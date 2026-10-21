import React, { useState } from "react";
import {
  ArrowRight,
  ChevronUp,
  ChevronDown,
  Copy,
  RotateCcw,
  Trash2,
  Zap,
  Play,
  Clock,
  CheckCircle2,
  ListOrdered,
} from "lucide-react";
import type { TaskSummary } from "../types";
import { TaskIdBadge } from "./CopyTaskIdButton";
import { EmptyState } from "./EmptyState";
import {
  computeReadyQueueStats,
  computeTaskDependencyDetail,
  type DependencyItem,
} from "../utils/dependencyGraph";

interface NextTasksProps {
  tasks: TaskSummary[];
  allTasks?: Map<string, TaskSummary>;
  onReorder: (taskId: string, direction: "up" | "down") => void;
  onReturnToInbox: (taskId: string) => void;
  onRequestDelete: (task: TaskSummary) => void;
  onSelectTask: (taskId: string) => void;
  onOpenBriefing: (task: TaskSummary) => void;
}

export const NextTasks: React.FC<NextTasksProps> = ({
  tasks,
  allTasks = new Map(),
  onReorder,
  onReturnToInbox,
  onRequestDelete,
  onSelectTask,
  onOpenBriefing,
}) => {
  const [expandedDepsTaskIds, setExpandedDepsTaskIds] = useState<Record<string, boolean>>({});

  const { runnableCount, isParallelizable } = computeReadyQueueStats(tasks, allTasks);

  const toggleExpandDeps = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedDepsTaskIds((prev) => ({
      ...prev,
      [taskId]: !prev[taskId],
    }));
  };

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 backdrop-blur-xs overflow-hidden lg:h-full lg:min-h-0 lg:flex lg:flex-col">
      <div className="px-4 py-2.5 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-indigo-400" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase">
            就绪队列 ({tasks.length})
          </h2>
        </div>

        {/* 显著显示当前可领取 / 可并行数量 */}
        {isParallelizable ? (
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/50 text-[11px] font-mono text-emerald-300">
            <Zap className="w-3 h-3 text-emerald-400" />
            <span>可并行推进: {runnableCount} 个就绪</span>
          </div>
        ) : runnableCount === 1 ? (
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/50 text-[11px] font-mono text-cyan-300">
            <Play className="w-3 h-3 text-cyan-400" />
            <span>当前可领取: 1 个</span>
          </div>
        ) : tasks.length > 0 ? (
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800/50 text-[11px] font-mono text-amber-300">
            <Clock className="w-3 h-3 text-amber-400" />
            <span>等待前置依赖解锁 ({tasks.length})</span>
          </div>
        ) : null}
      </div>

      <div className="p-3 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
        {tasks.length === 0 ? (
          <EmptyState
            icon={ListOrdered}
            title="就绪队列为空"
            description="当前没有排队中的就绪任务。可在草稿箱中确认任务，或新增规划"
            tag="队列清空"
            variant="indigo"
            className="lg:h-full"
          />
        ) : (
          <div className="space-y-2">
            {tasks.map((task, index) => {
              const isFirst = index === 0;
              const isLast = index === tasks.length - 1;
              const posNumber = String(task.queuePosition ?? index + 1).padStart(2, "0");

              const detail = computeTaskDependencyDetail(task, allTasks);
              const isRunnable = detail.isRunnable;

              const isDepsExpanded = !!expandedDepsTaskIds[task.id];
              const visibleDeps = isDepsExpanded
                ? detail.dependencies
                : detail.dependencies.slice(0, 2);
              const hasHiddenDeps = detail.dependencies.length > 2;

              return (
                <div
                  key={task.id}
                  className="group flex items-start justify-between p-2.5 rounded-md bg-zinc-950/60 border border-zinc-800 hover:border-zinc-600 transition-colors gap-3 lg:grid lg:grid-cols-[2.75rem_minmax(0,7rem)_minmax(0,1fr)_auto] lg:items-start lg:gap-x-3"
                >
                  {/* Reorder and Index */}
                  <div className="flex items-center space-x-2 shrink-0 pt-0.5">
                    <div className="flex flex-col opacity-20 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onReorder(task.id, "up")}
                        disabled={isFirst}
                        className="p-0.5 text-zinc-400 hover:text-zinc-200 disabled:opacity-0 transition-colors"
                        title="上移"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => onReorder(task.id, "down")}
                        disabled={isLast}
                        className="p-0.5 text-zinc-400 hover:text-zinc-200 disabled:opacity-0 transition-colors"
                        title="下移"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>

                    <span className="font-mono text-xs text-zinc-600 group-hover:text-zinc-400 transition-colors w-5 text-right select-none">
                      {posNumber}
                    </span>
                  </div>

                  {/* Task Info & Dependencies */}
                  <div
                    className="flex flex-1 min-w-0 items-start gap-2 cursor-pointer lg:contents"
                    onClick={() => onSelectTask(task.id)}
                  >
                    <TaskIdBadge taskId={task.id} variant="muted" className="lg:w-full" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start space-x-2 min-w-0">
                        {/* Status indicator dot */}
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            isRunnable
                              ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                              : "bg-amber-400/80"
                          }`}
                          title={isRunnable ? "可直接执行" : "等待前置依赖"}
                        />

                        <h3 className="min-w-0 flex-1 text-xs font-mono font-medium text-zinc-200 line-clamp-2 break-words group-hover:text-indigo-300 transition-colors">
                          {task.title}
                        </h3>
                      </div>

                      <div className="mt-1 flex items-center flex-wrap gap-1.5">
                        {/* 可并行 / 可领取徽标 */}
                        {isRunnable && (
                          <span
                            className={`inline-flex items-center space-x-0.5 px-1.5 py-0.2 rounded text-[10px] font-mono shrink-0 ${
                              isParallelizable
                                ? "bg-emerald-950/80 border border-emerald-700/60 text-emerald-300"
                                : "bg-cyan-950/80 border border-cyan-700/60 text-cyan-300"
                            }`}
                          >
                            {isParallelizable ? (
                              <>
                                <Zap className="w-2.5 h-2.5 text-emerald-400" />
                                <span>可并行</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-2.5 h-2.5 text-cyan-400" />
                                <span>可领取</span>
                              </>
                            )}
                          </span>
                        )}
                      </div>

                      {/* 直接依赖展示 */}
                      {detail.dependencies.length > 0 && (
                        <div className="mt-1.5 flex items-center flex-wrap gap-1.5 text-[10px] font-mono">
                          {isRunnable ? (
                            <span className="inline-flex items-center space-x-1 text-emerald-400/90">
                              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                              <span>前置依赖已全部完成 ({detail.dependencies.length})</span>
                            </span>
                          ) : (
                            <>
                              <span className="text-amber-400/90 inline-flex items-center space-x-1 shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400/90 animate-pulse" />
                                <span>等待前置 ({detail.waitingFor.length}):</span>
                              </span>
                              {visibleDeps.map((dep: DependencyItem) => (
                                <button
                                  key={dep.id}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectTask(dep.id);
                                  }}
                                  className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors max-w-[180px] truncate ${
                                    dep.isCompleted
                                      ? "bg-emerald-950/20 border-emerald-900/40 text-emerald-300 hover:border-emerald-700"
                                      : "bg-amber-950/20 border-amber-900/40 text-amber-300 hover:border-amber-700"
                                  }`}
                                  title={`前置依赖: ${dep.title} (${dep.status}) - 点击查看详情`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                      dep.isCompleted ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                                    }`}
                                  />
                                  <span className="shrink-0 text-zinc-400 font-mono">
                                    #{dep.id.slice(0, 8)}
                                  </span>
                                  <span className="truncate">{dep.title}</span>
                                </button>
                              ))}
                              {hasHiddenDeps && (
                                <button
                                  type="button"
                                  onClick={(e) => toggleExpandDeps(task.id, e)}
                                  className="text-zinc-500 hover:text-zinc-300 text-[10px] transition-colors"
                                >
                                  {isDepsExpanded ? "收起" : `等共 ${detail.dependencies.length} 项`}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center space-x-1.5 shrink-0 pt-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenBriefing(task);
                      }}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 text-[11px] font-mono text-zinc-400 hover:text-cyan-300 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 rounded transition-colors"
                      title="生成并复制 AI 任务简报"
                    >
                      <Copy className="w-3 h-3" />
                      <span>简报</span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onReturnToInbox(task.id);
                      }}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 text-[11px] font-mono text-zinc-400 hover:text-amber-300 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 rounded transition-colors"
                      title="退回草稿箱"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>退回</span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestDelete(task);
                      }}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 text-[11px] font-mono text-zinc-400 hover:text-rose-300 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 rounded transition-colors"
                      title="删除任务"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>删除</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
