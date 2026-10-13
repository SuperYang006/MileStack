import React from "react";
import { LogOut, Activity, Bot, ArrowRight, GitFork, WifiOff } from "lucide-react";
import { EmptyState } from "./EmptyState";
import type { TaskSummary } from "../types";
import { TaskIdBadge } from "./CopyTaskIdButton";
import { computeTaskDependencyDetail } from "../utils/dependencyGraph";

interface CurrentTasksProps {
  tasks: TaskSummary[];
  allTasks?: Map<string, TaskSummary>;
  onSelectTask: (taskId: string) => void;
  onReleaseTask: (taskId: string) => void;
  isServiceOffline?: boolean;
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
  allTasks = new Map(),
  onSelectTask,
  onReleaseTask,
  isServiceOffline = false,
}) => {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 backdrop-blur-xs overflow-hidden lg:h-full lg:min-h-0 lg:flex lg:flex-col">
      <div className="px-4 py-2.5 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          {/* While the service is unreachable the panel must not read as a live
              agent bus, so it stops pulsing and says so. */}
          <span
            className={`w-2 h-2 rounded-full ${
              isServiceOffline
                ? "bg-rose-400"
                : "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-pulse"
            }`}
          />
          <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase">
            正在进行 ({tasks.length})
          </h2>
        </div>
        <div className="flex items-center space-x-2 text-[11px] font-mono text-zinc-500">
          <Activity className={`w-3 h-3 ${isServiceOffline ? "text-rose-400" : "text-cyan-400"}`} />
          <span>{isServiceOffline ? "服务不可达" : "Agent 协同监听中"}</span>
        </div>
      </div>

      <div className="p-3 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
        {tasks.length === 0 ? (
          <EmptyState
            icon={isServiceOffline ? WifiOff : Bot}
            title={isServiceOffline ? "服务离线，暂不显示任务数据" : "Agent 待命中，暂无进行中任务"}
            description={
              isServiceOffline
                ? "无法获取进行中任务。请确认 milestack serve 仍在运行后重试"
                : "总线连接正常。一旦就绪队列有可执行任务，Agent 将认领并开始推进"
            }
            tag={isServiceOffline ? "服务不可达" : "待命监听"}
            variant={isServiceOffline ? "default" : "cyan"}
            className="lg:h-full"
          />
        ) : (
          <div className="space-y-2.5">
            {tasks.map((task) => {
              const timeInfo = formatRelativeTime(task.updatedAt);

              return (
                <div
                  key={task.id}
                  className="p-3.5 rounded-md bg-zinc-950/70 border border-zinc-800 hover:border-zinc-700 transition-colors lg:grid lg:grid-cols-[minmax(0,7rem)_minmax(0,1fr)_minmax(0,9rem)_auto] lg:items-start lg:gap-x-3"
                >
                  {/* Top bar: ID and Heartbeat status */}
                  <div className="flex items-center justify-between gap-2 pb-2 lg:contents">
                    <TaskIdBadge taskId={task.id} variant="cyan" className="lg:w-full" />

                    <div className="flex items-center space-x-1.5 text-[11px] font-mono shrink-0 lg:col-start-3 lg:row-start-1 lg:justify-self-end">
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
                  <div className="flex items-start justify-between gap-3 pt-0.5 lg:contents">
                    <div
                      className="flex-1 min-w-0 cursor-pointer group/title lg:col-start-2 lg:row-start-1"
                      onClick={() => onSelectTask(task.id)}
                    >
                      <h3 className="text-xs font-mono font-semibold text-zinc-100 line-clamp-2 break-words group-hover/title:text-cyan-400 transition-colors leading-relaxed">
                        {task.title}
                      </h3>
                    </div>

                    <div className="flex items-center shrink-0 lg:col-start-4 lg:row-start-1">
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
                      className="space-y-1.5 text-xs font-mono mt-2.5 pt-2 border-t border-zinc-850/80 cursor-pointer lg:col-span-4"
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

                  {/* Unblocks Info */}
                  {(() => {
                    const detail = computeTaskDependencyDetail(task, allTasks);
                    if (detail.unblocks.length === 0) return null;
                    return (
                      <div className="mt-2 pt-2 border-t border-zinc-850/60 flex items-center flex-wrap gap-1.5 text-[10px] font-mono lg:col-span-4">
                        <span className="text-zinc-500 shrink-0 flex items-center space-x-1">
                          <GitFork className="w-3 h-3 text-cyan-400" />
                          <span>完成后解锁:</span>
                        </span>
                        {detail.unblocks.slice(0, 2).map((ub) => (
                          <button
                            key={ub.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectTask(ub.id);
                            }}
                            className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-zinc-700 max-w-[180px] truncate transition-colors"
                            title={`下游任务: ${ub.title} - 点击查看`}
                          >
                            <span className="text-zinc-400">#{ub.id.slice(0, 8)}</span>
                            <span className="truncate">{ub.title}</span>
                          </button>
                        ))}
                        {detail.unblocks.length > 2 && (
                          <span className="text-zinc-500">
                            +{detail.unblocks.length - 2} 更多
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
