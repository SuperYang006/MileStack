import React, { useState } from "react";
import { ChevronDown, ChevronRight, ArrowUpRight, RotateCcw } from "lucide-react";
import type { TaskSummary } from "../types";
import { TaskIdBadge } from "./CopyTaskIdButton";

interface RecentTasksProps {
  tasks: TaskSummary[];
  onSelectTask: (taskId: string) => void;
  onReopenTask: (taskId: string, reason: string) => void;
}

export const RecentTasks: React.FC<RecentTasksProps> = ({
  tasks,
  onSelectTask,
  onReopenTask,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (tasks.length === 0) return null;

  return (
    <section className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2 bg-zinc-900/50 hover:bg-zinc-900 flex items-center justify-between text-left transition-colors"
      >
        <div className="flex items-center space-x-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-400 uppercase">
            已完成归档 ({tasks.length})
          </h2>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
        )}
      </button>

      {isExpanded && (
        <div className="p-3 divide-y divide-zinc-800/40">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="py-1.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs font-mono"
            >
              <div
                className="flex items-center space-x-2 flex-1 min-w-0 cursor-pointer group"
                onClick={() => onSelectTask(task.id)}
              >
                <TaskIdBadge taskId={task.id} variant="muted" />
                <span className="text-zinc-400 truncate group-hover:text-zinc-200 transition-colors">
                  {task.title}
                </span>
              </div>

              <div className="flex items-center space-x-1.5 shrink-0">
                {task.completedAt && (
                  <span className="text-zinc-600 text-[10px]">
                    {new Date(task.completedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
                <button
                  onClick={() => {
                    const reason = window.prompt("请输入重新打开的返工原因：", "");
                    if (reason?.trim()) onReopenTask(task.id, reason.trim());
                  }}
                  className="inline-flex items-center space-x-1 px-1.5 py-0.5 text-[10px] font-mono text-amber-400 hover:text-amber-300 border border-amber-900/50 rounded"
                  title="重新打开为 Ready 任务"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>返工</span>
                </button>
                <button
                  onClick={() => onSelectTask(task.id)}
                  className="p-0.5 text-zinc-600 hover:text-zinc-400 rounded transition-colors"
                  title="查看详情"
                >
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
