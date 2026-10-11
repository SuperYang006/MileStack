import React from "react";
import { Check, MessageSquare, ArrowUpRight } from "lucide-react";
import type { TaskSummary } from "../types";
import { CopyTaskIdButton } from "./CopyTaskIdButton";

interface ReviewTasksProps {
  tasks: TaskSummary[];
  onApprove: (taskId: string) => void;
  onRequestChanges: (taskId: string, feedback: string) => void;
  onSelectTask: (taskId: string) => void;
}

export const ReviewTasks: React.FC<ReviewTasksProps> = ({
  tasks,
  onApprove,
  onRequestChanges,
  onSelectTask,
}) => {
  return (
    <section className="rounded-lg border border-violet-900/50 bg-violet-950/15 backdrop-blur-xs overflow-hidden">
      <div className="px-4 py-2.5 border-b border-violet-900/40 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-violet-400" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-violet-200 uppercase">
            待审核 ({tasks.length})
          </h2>
        </div>
        <span className="text-[11px] font-mono text-violet-300/70">等待开发者验收</span>
      </div>

      <div className="p-3">
        {tasks.length === 0 ? (
          <div className="py-5 text-center text-zinc-600 font-mono text-xs">
            // 暂无待审核任务
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between gap-3 p-2.5 rounded-md bg-zinc-950/60 border border-zinc-800"
              >
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => onSelectTask(task.id)}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <span className="font-mono text-[11px] text-zinc-500 inline-flex items-center space-x-1">
                      <span>{task.id}</span>
                      <CopyTaskIdButton taskId={task.id} />
                    </span>
                    <h3 className="text-xs font-mono text-zinc-200 truncate hover:text-violet-300">
                      {task.title}
                    </h3>
                  </div>
                  {task.nextStep && (
                    <div className="mt-1 text-[11px] font-mono text-zinc-500 truncate">
                      下一步：{task.nextStep}
                    </div>
                  )}
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  <button
                    onClick={() => onApprove(task.id)}
                    className="inline-flex items-center space-x-1 px-2 py-0.5 text-[11px] font-mono text-emerald-300 hover:text-emerald-200 bg-emerald-950/40 hover:bg-emerald-950/80 border border-emerald-900/60 rounded transition-colors"
                    title="批准并归档"
                  >
                    <Check className="w-3 h-3" />
                    <span>批准</span>
                  </button>
                  <button
                    onClick={() => {
                      const feedback = window.prompt("请输入退回返工的审核反馈：", "");
                      if (feedback?.trim()) onRequestChanges(task.id, feedback.trim());
                    }}
                    className="inline-flex items-center space-x-1 px-2 py-0.5 text-[11px] font-mono text-amber-300 hover:text-amber-200 bg-amber-950/40 hover:bg-amber-950/80 border border-amber-900/60 rounded transition-colors"
                    title="填写审核反馈并退回返工"
                  >
                    <MessageSquare className="w-3 h-3" />
                    <span>退回返工</span>
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
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
