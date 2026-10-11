import React, { useState } from "react";
import { ChevronDown, ChevronRight, ArrowUpRight } from "lucide-react";
import type { TaskSummary } from "../types";

interface RecentTasksProps {
  tasks: TaskSummary[];
  onSelectTask: (taskId: string) => void;
}

export const RecentTasks: React.FC<RecentTasksProps> = ({ tasks, onSelectTask }) => {
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
                <span className="text-zinc-600 text-[11px]">{task.id}</span>
                <span className="text-zinc-400 truncate group-hover:text-zinc-200 transition-colors">
                  {task.title}
                </span>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                {task.completedAt && (
                  <span className="text-zinc-600 text-[10px]">
                    {new Date(task.completedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
                <button
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
