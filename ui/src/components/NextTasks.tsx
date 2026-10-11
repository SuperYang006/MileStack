import React from "react";
import {
  ArrowRight,
  ChevronUp,
  ChevronDown,
  Copy,
  RotateCcw,
  Trash2,
  Zap,
} from "lucide-react";
import { ListOrdered } from "lucide-react";
import { EmptyState } from "./EmptyState";
import type { TaskSummary } from "../types";
import { TaskIdBadge } from "./CopyTaskIdButton";
interface NextTasksProps {
  tasks: TaskSummary[];
  onReorder: (taskId: string, direction: "up" | "down") => void;
  onReturnToInbox: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onSelectTask: (taskId: string) => void;
  onOpenBriefing: (task: TaskSummary) => void;
}

export const NextTasks: React.FC<NextTasksProps> = ({
  tasks,
  onReorder,
  onReturnToInbox,
  onDeleteTask,
  onSelectTask,
  onOpenBriefing,
}) => {
  const runnableCount = tasks.filter((t) => t.runnable).length;
  const isParallelizable = runnableCount > 1;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 backdrop-blur-xs overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-800/80 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-indigo-400" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase">
            就绪队列 ({tasks.length})
          </h2>
        </div>

        {isParallelizable && (
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/50 text-[11px] font-mono text-emerald-300">
            <Zap className="w-3 h-3 text-emerald-400" />
            <span>可并行推进: {runnableCount} 个就绪</span>
          </div>
        )}
      </div>

      <div className="p-3">
        {tasks.length === 0 ? (
          <EmptyState
            icon={ListOrdered}
            title="就绪队列为空"
            description="当前没有排队中的就绪任务。可在待整理收件箱中确认任务，或新增规划"
            tag="队列清空"
            variant="indigo"
          />
        ) : (
          <div className="space-y-2">
            {tasks.map((task, index) => {
              const isFirst = index === 0;
              const isLast = index === tasks.length - 1;
              const posNumber = String(task.queuePosition ?? index + 1).padStart(2, "0");

              return (
                <div
                  key={task.id}
                  className="group flex items-center justify-between p-2.5 rounded-md bg-zinc-950/60 border border-zinc-850 hover:border-zinc-700/80 transition-colors gap-3"
                >
                  {/* Reorder and Index */}
                  <div className="flex items-center space-x-2 shrink-0">
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

                  {/* Task Info */}
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => onSelectTask(task.id)}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      {/* Status indicator dot */}
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          task.runnable
                            ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                            : "bg-amber-400/80"
                        }`}
                        title={task.runnable ? "可执行" : "等待前置依赖"}
                      />

                      <TaskIdBadge taskId={task.id} variant="muted" />

                      <h3 className="text-xs font-mono font-medium text-zinc-200 truncate group-hover:text-indigo-300 transition-colors">
                        {task.title}
                      </h3>
                    </div>

                    {/* Waiting dependencies */}
                    {/* Waiting dependencies */}
                    {task.waitingFor.length > 0 && (
                      <div className="mt-1.5 flex items-center flex-wrap gap-1.5 text-[11px] font-mono">
                        <span className="text-zinc-500 text-[10px] uppercase tracking-wider shrink-0 select-none">
                          前置依赖
                        </span>
                        {task.waitingFor.map((w) => {
                          const isDone = w.status === "completed";
                          return (
                            <React.Fragment key={w.id}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectTask(w.id);
                                }}
                                className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                                  isDone
                                    ? "bg-emerald-950/40 border-emerald-900/60 text-emerald-300 hover:border-emerald-700"
                                    : "bg-amber-950/40 border-amber-900/60 text-amber-300 hover:border-amber-700"
                                }`}
                                title={`前置依赖: ${w.title} (${w.status}) - 点击查看`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    isDone ? "bg-emerald-400" : "bg-amber-400"
                                  }`}
                                />
                                <span>{w.id}</span>
                              </button>
                              <ArrowRight className="w-2.5 h-2.5 text-zinc-600 shrink-0 select-none" />
                            </React.Fragment>
                          );
                        })}
                        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-400 select-none">
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                          <span>本任务等待中</span>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center space-x-1.5 shrink-0">
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
                      title="退回待整理收件箱"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>退回</span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`确认删除 Ready 任务“${task.title}”？`)) {
                          onDeleteTask(task.id);
                        }
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
