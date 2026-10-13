import React, { useEffect, useRef } from "react";
import { ArrowUpRight, RotateCcw, Archive, X } from "lucide-react";
import { EmptyState } from "./EmptyState";
import type { TaskSummary } from "../types";
import { TaskIdBadge } from "./CopyTaskIdButton";

interface RecentTasksProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: TaskSummary[];
  totalCount: number;
  isLoading: boolean;
  isError: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onSelectTask: (taskId: string) => void;
  onReopenTask: (taskId: string, reason: string) => void;
}

export const RecentTasks: React.FC<RecentTasksProps> = ({
  isOpen,
  onClose,
  tasks,
  totalCount,
  isLoading,
  isError,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onSelectTask,
  onReopenTask,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10 pointer-events-none">
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="已完成归档"
          className="w-screen max-w-md sm:max-w-lg lg:max-w-xl bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col pointer-events-auto"
        >
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-zinc-800/80 bg-zinc-900/60 flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              <div className="flex items-baseline space-x-2">
                <h2 className="text-sm font-mono font-bold tracking-wider text-zinc-100 uppercase">
                  已完成归档
                </h2>
                <span className="text-xs font-mono text-zinc-500">
                  ({totalCount})
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <span className="hidden sm:inline text-[11px] font-mono text-zinc-500">
                按 ESC 关闭
              </span>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-md transition-colors"
                title="关闭抽屉 (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Scrollable list */}
          <div
            ref={listRef}
            className="flex-1 min-h-0 p-4 overflow-y-auto"
            onScroll={(event) => {
              const target = event.currentTarget;
              const distanceToBottom =
                target.scrollHeight - target.scrollTop - target.clientHeight;
              if (distanceToBottom <= 48 && hasMore && !isLoadingMore) {
                onLoadMore();
              }
            }}
          >
            {isLoading ? (
              <div className="py-12 text-center text-xs font-mono text-zinc-500">
                正在加载已完成归档...
              </div>
            ) : isError ? (
              <div className="py-12 text-center text-xs font-mono text-rose-400">
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
              <div className="divide-y divide-zinc-800/60">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3 text-xs font-mono"
                  >
                    <div
                      className="flex-1 min-w-0 cursor-pointer group space-y-1.5"
                      onClick={() => onSelectTask(task.id)}
                    >
                      <div className="flex items-center space-x-2">
                        <TaskIdBadge taskId={task.id} variant="muted" />
                        {task.completedAt && (
                          <span className="text-zinc-500 text-[10px]">
                            {new Date(task.completedAt).toLocaleString([], {
                              year: "numeric",
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                      </div>
                      <p className="text-zinc-300 line-clamp-2 break-words group-hover:text-emerald-400 transition-colors leading-relaxed">
                        {task.title}
                      </p>
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0 pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          const reason = window.prompt("请输入重新打开的返工原因：", "");
                          if (reason?.trim()) onReopenTask(task.id, reason.trim());
                        }}
                        className="inline-flex items-center space-x-1 px-2 py-0.5 text-[11px] font-mono text-amber-400 hover:text-amber-300 bg-amber-950/30 hover:bg-amber-950/60 border border-amber-900/50 rounded transition-colors"
                        title="重新打开为 Ready 任务"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>返工</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectTask(task.id)}
                        className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 rounded transition-colors"
                        title="查看详情"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(hasMore || isLoadingMore) && !isLoading && (
              <div className="py-4 text-center text-[11px] font-mono text-zinc-500">
                {isLoadingMore ? "正在加载更多归档..." : "继续向下滚动加载更多"}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
