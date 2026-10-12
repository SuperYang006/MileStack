import React from "react";
import { AlertCircle, ArrowUpRight } from "lucide-react";
import type { TaskSummary } from "../types";
import { TaskIdBadge } from "./CopyTaskIdButton";

interface BlockedTasksProps {
  tasks: TaskSummary[];
  onSelectTask: (taskId: string) => void;
}

export const BlockedTasks: React.FC<BlockedTasksProps> = ({ tasks, onSelectTask }) => {
  if (tasks.length === 0) return null;

  return (
    <section className="rounded-lg border border-rose-900/40 bg-rose-950/20 backdrop-blur-xs overflow-hidden lg:flex lg:max-h-[20vh] lg:min-h-0 lg:shrink-0 lg:flex-col">
      <div className="px-4 py-2.5 border-b border-rose-900/30 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)] animate-pulse" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-rose-300 uppercase">
            阻塞异常 ({tasks.length})
          </h2>
        </div>
        <span className="text-[11px] font-mono text-rose-400/80">
          需人工介入处理
        </span>
      </div>

      <div className="p-3 space-y-2.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="p-3 rounded-md bg-zinc-900/90 border border-rose-900/40 hover:border-rose-700/60 transition-colors cursor-pointer group"
            onClick={() => onSelectTask(task.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2.5 mb-1.5">
                  <TaskIdBadge taskId={task.id} variant="rose" />
                  <h3 className="flex-1 min-w-0 text-xs font-mono font-semibold text-zinc-100 group-hover:text-rose-300 transition-colors line-clamp-2 break-words">
                    {task.title}
                  </h3>
                </div>

                <div className="space-y-1 text-[11px] font-mono mt-2">
                  {task.blocker && (
                    <div className="text-rose-400 flex items-start space-x-1.5">
                      <span className="text-rose-500 shrink-0">阻塞原因:</span>
                      <span className="text-zinc-300">{task.blocker}</span>
                    </div>
                  )}

                  {task.requiredAction && (
                    <div className="text-amber-400 flex items-start space-x-1.5">
                      <span className="text-amber-500 shrink-0">所需行动:</span>
                      <span className="text-zinc-300">{task.requiredAction}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="shrink-0 p-1 text-zinc-500 group-hover:text-zinc-300 transition-colors">
                <ArrowUpRight className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
