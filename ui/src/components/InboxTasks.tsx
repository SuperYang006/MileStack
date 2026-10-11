import React from "react";
import { Check, Trash2, Edit3 } from "lucide-react";
import type { TaskSummary } from "../types";
import { TaskIdBadge } from "./CopyTaskIdButton";

interface InboxTasksProps {
  tasks: TaskSummary[];
  onConfirmTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onSelectTask: (taskId: string) => void;
  onEditTask?: (task: TaskSummary) => void;
}

export const InboxTasks: React.FC<InboxTasksProps> = ({
  tasks,
  onConfirmTask,
  onDeleteTask,
  onSelectTask,
  onEditTask,
}) => {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 backdrop-blur-xs overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-800/80 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-zinc-500" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-300 uppercase">
            待整理收件箱 ({tasks.length})
          </h2>
        </div>
        <span className="text-[11px] font-mono text-zinc-500">
          待分流归类
        </span>
      </div>

      <div className="p-3">
        {tasks.length === 0 ? (
          <div className="py-6 text-center text-zinc-600 font-mono text-xs">
            // 收件箱已清空，无待处理任务
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-3 group"
              >
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => onSelectTask(task.id)}
                >
                  <div className="flex items-center space-x-2">
                    <TaskIdBadge taskId={task.id} variant="muted" />
                    <h3 className="text-xs font-mono text-zinc-300 group-hover:text-amber-300 transition-colors truncate">
                      {task.title}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  <button
                    onClick={() => onConfirmTask(task.id)}
                    className="inline-flex items-center space-x-1 px-2 py-0.5 text-[11px] font-mono text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 hover:bg-emerald-950/80 border border-emerald-900/60 rounded transition-colors"
                    title="确认为就绪任务，排入执行队列"
                  >
                    <Check className="w-3 h-3" />
                    <span>确认排队</span>
                  </button>

                  {onEditTask && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditTask(task);
                      }}
                      className="p-1 text-zinc-500 hover:text-amber-300 rounded transition-all opacity-0 group-hover:opacity-100"
                      title="编辑任务草稿"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`确认删除 Inbox 任务“${task.title}”？`)) {
                        onDeleteTask(task.id);
                      }
                    }}
                    className="p-1 text-zinc-500 hover:text-rose-400 rounded transition-all opacity-0 group-hover:opacity-100"
                    title="删除任务"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
