import React from "react";
import { Plus, RefreshCw, Archive, ArrowUp, MessageSquare } from "lucide-react";
import { Logo } from "./Logo";
import type { ProjectSummary, RuntimeUpdateInfo } from "../types";
import { isSemverVersion } from "../runtime-version";

interface HeaderProps {
  project: ProjectSummary;
  isBackendConnected: boolean;
  runtimeVersion?: string | null;
  runtimeUpdate?: RuntimeUpdateInfo | null;
  onRefresh: () => void;
  onOpenCreateModal: () => void;
  onOpenPageComments: () => void;
  onOpenArchive?: () => void;
  completedCount?: number;
  isRefreshing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  project,
  isBackendConnected,
  runtimeVersion,
  runtimeUpdate,
  onRefresh,
  onOpenCreateModal,
  onOpenPageComments,
  onOpenArchive,
  completedCount,
  isRefreshing = false,
}) => {
  const updateHintId = React.useId();
  const showRuntimeIdentity = isBackendConnected && isSemverVersion(runtimeVersion);
  const showUpdate =
    showRuntimeIdentity &&
    runtimeUpdate !== null &&
    runtimeUpdate !== undefined &&
    isSemverVersion(runtimeUpdate.latestVersion) &&
    runtimeUpdate.command.trim().length > 0;

  return (
    <header className="bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/80 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Logo & Terminal Identity */}
          <div className="flex min-w-0 flex-1 items-center space-x-3">
            <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center shrink-0 border border-zinc-800 shadow-md transition-transform hover:scale-105">
              <Logo className="w-full h-full" />
            </div>

            <div className="flex min-w-0 flex-1 items-baseline space-x-2.5 truncate">
              <span className="font-mono text-sm font-bold tracking-tight text-zinc-100">
                {project.name.toLowerCase() || "milestack"}
              </span>
              {project.goal && (
                <>
                  <span className="hidden md:inline font-mono text-xs text-zinc-500">::</span>
                  <span className="hidden md:inline font-mono text-xs text-zinc-400 truncate">
                    {project.goal}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Right Controls & Status Pill */}
          <div className="flex max-w-full flex-wrap items-center justify-end gap-2.5 sm:space-x-2.5 ml-auto">
            {/* Product identity of the running process, separate from the managed project.
                Never split, never dropped: narrow screens give up the goal and the
                button labels first, and this group wraps to its own row, then wraps
                its own items, if needed. */}
            {showRuntimeIdentity && (
              <div className="relative flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className="font-mono text-[11px] tracking-tight text-zinc-600 select-none whitespace-nowrap"
                  title={`MileStack 运行版本 v${runtimeVersion}`}
                >
                  MileStack · v{runtimeVersion}
                </span>
                {showUpdate && (
                  <>
                    <span
                      className="inline-flex items-center gap-0.5 font-mono text-[11px] font-medium tracking-tight text-emerald-400 select-none whitespace-nowrap"
                      title={`新版本 ${runtimeUpdate.latestVersion} 可用`}
                      aria-label={`新版本 ${runtimeUpdate.latestVersion} 可用`}
                    >
                      <ArrowUp className="w-3 h-3 shrink-0" aria-hidden="true" />
                      {runtimeUpdate.latestVersion}
                    </span>
                    <span className="group/update-command inline-flex">
                      <code
                        className="rounded border border-amber-900/60 bg-amber-950/40 px-1.5 py-0.5 font-mono text-[11px] text-amber-200/90 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-emerald-400"
                        tabIndex={0}
                        aria-describedby={updateHintId}
                      >
                        {runtimeUpdate.command}
                      </code>
                      <span
                        id={updateHintId}
                        role="tooltip"
                        className="pointer-events-none invisible absolute right-0 top-full z-50 mt-1.5 max-w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs leading-relaxed text-zinc-200 shadow-lg group-hover/update-command:visible group-focus-within/update-command:visible"
                      >
                        请复制到终端进行更新
                      </span>
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Connection status: a quiet breathing dot while the service is
                reachable; the full offline notice keeps the existing pill. */}
            {isBackendConnected ? (
              <span
                className="group/status relative flex items-center justify-center p-1 rounded-md focus-visible:outline-2 focus-visible:outline-emerald-400"
                role="status"
                aria-label="服务在线"
                tabIndex={0}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                <span
                  role="tooltip"
                  className="pointer-events-none invisible absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-200 shadow-lg group-hover/status:visible group-focus-within/status:visible"
                >
                  服务在线
                </span>
              </span>
            ) : (
              <div className="flex items-center space-x-2 px-2.5 py-1 rounded-md bg-zinc-900/90 border border-zinc-800 text-[11px] font-mono text-zinc-400">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]" />
                <span className="text-zinc-300">服务离线</span>
              </div>
            )}

            {/* Page comments bookmark installer, kept secondary to the task controls. */}
            <button
              type="button"
              onClick={onOpenPageComments}
              className="inline-flex items-center space-x-1.5 rounded-md border border-zinc-800/70 bg-zinc-900/60 px-2.5 py-1 font-mono text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              title="安装页面评论书签"
              aria-label="安装页面评论书签"
            >
              <MessageSquare className="w-3.5 h-3.5 text-cyan-400/80" />
              <span className="hidden sm:inline">页面评论</span>
            </button>

            {/* Archive Drawer Trigger */}
            {onOpenArchive && (
              <button
                type="button"
                onClick={onOpenArchive}
                className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono text-zinc-300 transition-colors"
                title="查看已完成归档"
              >
                <Archive className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">归档</span>
                {typeof completedCount === "number" && (
                  <span className="px-1.5 py-px rounded-full text-[10px] bg-zinc-800 border border-zinc-700/60 text-emerald-400 font-medium">
                    {completedCount}
                  </span>
                )}
              </button>
            )}

            {/* Refresh */}
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono text-zinc-300 transition-colors disabled:opacity-40"
              title="刷新状态"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? "animate-spin text-cyan-400" : ""}`} />
              <span className="hidden sm:inline">刷新</span>
            </button>

            {/* Create Task button. An unreachable service cannot accept the write, so the
                entry is disabled instead of failing after the click. */}
            <button
              onClick={onOpenCreateModal}
              disabled={!isBackendConnected}
              title={isBackendConnected ? "新建任务" : "服务离线，无法新建任务"}
              className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-mono font-semibold transition-colors shadow-xs disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新建任务</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
