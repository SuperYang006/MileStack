import React from "react";
import { ChevronDown, ChevronRight, ArrowUpRight, RotateCcw, Archive } from "lucide-react";
import { EmptyState } from "./EmptyState";
import type { TaskSummary } from "../types";
import { TaskIdBadge } from "./CopyTaskIdButton";

interface RecentTasksProps {
  tasks: TaskSummary[];
  totalCount: number;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  isLoading: boolean;
  isError: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onSelectTask: (taskId: string) => void;
  onReopenTask: (taskId: string, reason: string) => void;
}

export const RecentTasks: React.FC<RecentTasksProps> = ({
  tasks,
  totalCount,
  isExpanded,
  onToggleExpanded,
  isLoading,
  isError,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onSelectTask,
  onReopenTask,
}) => {
  return (
    <section className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 overflow-hidden">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="w-full px-4 py-2 bg-zinc-900/50 hover:bg-zinc-900 flex items-center justify-between text-left transition-colors"
      >
        <div className="flex items-center space-x-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-400 uppercase">
            已完成归档 ({totalCount})
          </h2>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
        )}
      </button>

      {isExpanded && (
        <div className="p-3">
          {isLoading ? (
            <div className="py-6 text-center text-[11px] font-mono text-zinc-600">
              正在加载已完成归档...
            </div>
          ) : isError ? (
            <div className="py-6 text-center text-[11px] font-mono text-rose-400">
              已完成归档加载失败，请稍后重试
            </div>
          ) : tasks.length === 0 ? (
            <EmptyState
              icon={Archive}
              title="暂无已完成归档记录"
              description="当任务通过审核验收后，将沉淀于此"
              tag="暂无归档"
              variant="emerald"
              compact
            />
          ) : (
            <div
              className="max-h-80 overflow-y-auto pr-1"
              onScroll={(event) => {
                const target = event.currentTarget;
                const distanceToBottom =
                  target.scrollHeight - target.scrollTop - target.clientHeight;
                if (distanceToBottom <= 48 && hasMore && !isLoadingMore) {
                  onLoadMore();
                }
              }}
            >
              <div className="divide-y divide-zinc-800/40">
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
                          {new Date(task.completedAt).toLocaleString([], {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                      <button
                        type="button"
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
                        type="button"
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
              {(hasMore || isLoadingMore) && (
                <div className="py-3 text-center text-[10px] font-mono text-zinc-600">
                  {isLoadingMore ? "正在加载更多归档..." : "继续向下滚动加载更多"}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
