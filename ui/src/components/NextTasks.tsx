import React from "react";
import {
  ChevronUp,
  ChevronDown,
  Copy,
  ArrowUpRight,
  Zap,
} from "lucide-react";
import type { TaskSummary } from "../types";
import { CopyTaskIdButton } from "./CopyTaskIdButton";

interface NextTasksProps {
  tasks: TaskSummary[];
  onReorder: (taskId: string, direction: "up" | "down") => void;
  onSelectTask: (taskId: string) => void;
  onOpenBriefing: (task: TaskSummary) => void;
}

export const NextTasks: React.FC<NextTasksProps> = ({
  tasks,
  onReorder,
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
            <span>// 可并行推进: {runnableCount} 个就绪</span>
          </div>
        )}
      </div>

      <div className="p-3">
        {tasks.length === 0 ? (
          <div className="py-6 text-center text-zinc-600 font-mono text-xs">
            // 就绪队列为空，可在待整理收件箱中确认任务
          </div>
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

                      <span className="font-mono text-[11px] text-zinc-500 inline-flex items-center space-x-1">
                        <span>{task.id}</span>
                        <CopyTaskIdButton taskId={task.id} />
                      </span>

                      <h3 className="text-xs font-mono font-medium text-zinc-200 truncate group-hover:text-indigo-300 transition-colors">
                        {task.title}
                      </h3>
                    </div>

                    {/* Waiting dependencies */}
                    {task.waitingFor.length > 0 && (
                      <div className="mt-1.5 pl-3.5 flex items-center flex-wrap gap-1 text-[11px] font-mono text-zinc-400">
                        <span className="text-zinc-600 select-none">┌拓扑:</span>
                        {task.waitingFor.map((w) => (
                          <React.Fragment key={w.id}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectTask(w.id);
                              }}
                              className="px-1 py-0.5 rounded bg-zinc-900 border border-amber-900/50 text-amber-300 hover:text-amber-200 hover:border-amber-700/80 transition-colors text-[10px]"
                              title={`前置依赖: ${w.title} (${w.status}) - 点击查看`}
                            >
                              [{w.id}] {w.status === "completed" ? "✓完成" : "未完成"}
                            </button>
                            <span className="text-zinc-600 select-none">──&gt;</span>
                          </React.Fragment>
                        ))}
                        <span className="px-1 py-0.5 rounded bg-zinc-900/80 border border-zinc-800 text-zinc-400 text-[10px]">
                          [{task.id}] 等待中
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center space-x-1.5 shrink-0">
                    <button
                      className="inline-flex items-center space-x-1 px-2 py-0.5 text-[11px] font-mono text-zinc-400 hover:text-cyan-300 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded transition-colors"
                      title="生成并复制 AI 任务简报"
                    >
                      <Copy className="w-3 h-3" />
                      <span>复制简报</span>
                    </button>

                    <button
                      onClick={() => onSelectTask(task.id)}
                      className="p-1 text-zinc-500 hover:text-zinc-300 rounded transition-colors"
                      title="查看详情"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
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
