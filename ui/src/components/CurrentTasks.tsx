import React from "react";
import { LogOut, Activity } from "lucide-react";
import type { TaskSummary } from "../types";
import { TaskIdBadge } from "./CopyTaskIdButton";

interface CurrentTasksProps {
  tasks: TaskSummary[];
  onSelectTask: (taskId: string) => void;
  onReleaseTask: (taskId: string) => void;
}

function formatRelativeTime(dateString: string): { label: string; isFresh: boolean } {
  try {
    const diff = Math.max(0, Date.now() - new Date(dateString).getTime());
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return { label: "刚刚", isFresh: true };
    if (minutes < 60) return { label: `${minutes}分钟前`, isFresh: minutes <= 30 };
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return { label: `${hours}小时前`, isFresh: false };
    const days = Math.floor(hours / 24);
    return { label: `${days}天前`, isFresh: false };
  } catch {
    return { label: "近期", isFresh: true };
  }
}

export const CurrentTasks: React.FC<CurrentTasksProps> = ({
  tasks,
  onSelectTask,
  onReleaseTask,
}) => {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 backdrop-blur-xs overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-800/80 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-pulse" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase">
            正在进行 ({tasks.length})
          </h2>
        </div>
        <div className="flex items-center space-x-2 text-[11px] font-mono text-zinc-500">
          <Activity className="w-3 h-3 text-cyan-400" />
          <span>Agent 协同监听中</span>
        </div>
      </div>

      <div className="p-3">
        {tasks.length === 0 ? (
          <div className="py-6 text-center text-zinc-600 font-mono text-xs">
            暂无执行中任务，Agent 空闲
          </div>
        ) : (
          <div className="space-y-2.5">
            {tasks.map((task) => {
              const timeInfo = formatRelativeTime(task.updatedAt);

              return (
                <div
                  key={task.id}
                  className="p-3.5 rounded-md bg-zinc-950/70 border border-zinc-800 hover:border-zinc-700 transition-colors"
                >
                  {/* Top bar: ID and Heartbeat status */}
                  <div className="flex items-center justify-between gap-2 pb-2">
                    <TaskIdBadge taskId={task.id} variant="cyan" />

                    <div className="flex items-center space-x-1.5 text-[11px] font-mono shrink-0">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          timeInfo.isFresh
                            ? "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.9)] animate-pulse"
                            : "bg-amber-400/80"
                        }`}
                      />
                      <span className={timeInfo.isFresh ? "text-cyan-400/90" : "text-zinc-500"}>
                        {timeInfo.isFresh
                          ? `心跳正常 · ${timeInfo.label}`
                          : `暂未更新 · ${timeInfo.label}`}
                      </span>
                    </div>
                  </div>

                  {/* Middle bar: Title and Action */}
                  <div className="flex items-start justify-between gap-3 pt-0.5">
                    <div
                      className="flex-1 min-w-0 cursor-pointer group/title"
                      onClick={() => onSelectTask(task.id)}
                    >
                      <h3 className="text-xs font-mono font-semibold text-zinc-100 group-hover/title:text-cyan-400 transition-colors leading-relaxed">
                        {task.title}
                      </h3>
                    </div>

                    <div className="flex items-center shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onReleaseTask(task.id);
                        }}
                        className="inline-flex items-center space-x-1 px-2 py-0.5 text-[11px] font-mono text-zinc-400 hover:text-amber-300 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 rounded transition-colors"
                        title="手动释放任务，回退至就绪队列"
                      >
                        <LogOut className="w-3 h-3" />
                        <span>释放</span>
                      </button>
                    </div>
                  </div>

                  {/* Bottom bar: Execution Steps */}
                  {(task.currentStep || task.nextStep) && (
                    <div
                      className="space-y-1.5 text-xs font-mono mt-2.5 pt-2 border-t border-zinc-850/80 cursor-pointer"
                      onClick={() => onSelectTask(task.id)}
                    >
                      {task.currentStep && (
                        <div className="flex items-start space-x-2 text-zinc-300">
                          <span className="text-cyan-400 font-bold shrink-0 select-none">&gt;</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-zinc-500 mr-1.5 select-none">当前步骤:</span>
                            <span className="text-zinc-200">{task.currentStep}</span>
                          </div>
                        </div>
                      )}
                      {task.nextStep && (
                        <div className="flex items-start space-x-2 text-zinc-400">
                          <span className="text-emerald-400 font-bold shrink-0 select-none">&gt;&gt;</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-zinc-500 mr-1.5 select-none">下一步骤:</span>
                            <span className="text-zinc-300">{task.nextStep}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
