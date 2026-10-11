import React from "react";
import { Terminal, Plus, RefreshCw, Radio } from "lucide-react";
import type { ProjectSummary } from "../types";

interface HeaderProps {
  project: ProjectSummary;
  isBackendConnected: boolean;
  onRefresh: () => void;
  onOpenCreateModal: () => void;
  isRefreshing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  project,
  isBackendConnected,
  onRefresh,
  onOpenCreateModal,
  isRefreshing = false,
}) => {
  return (
    <header className="bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/80 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5">
        <div className="flex items-center justify-between gap-4">
          {/* Logo & Terminal Identity */}
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-8 h-8 rounded-md bg-zinc-900 border border-zinc-700/80 flex items-center justify-center text-cyan-400 font-mono shadow-inner">
              <Terminal className="w-4 h-4" />
            </div>

            <div className="flex items-baseline space-x-2.5 min-w-0 truncate">
              <span className="font-mono text-sm font-bold tracking-tight text-zinc-100">
                {project.name.toLowerCase() || "milestack"}
              </span>
              <span className="font-mono text-xs text-zinc-500">::</span>
              <span className="font-mono text-xs text-zinc-400 truncate">
                {project.goal || "shared truth engine for dev & agent"}
              </span>
            </div>
          </div>

          {/* Right Controls & Status Pill */}
          <div className="flex items-center space-x-2.5 shrink-0">
            {/* Connection Status indicator */}
            <div className="flex items-center space-x-2 px-2.5 py-1 rounded-md bg-zinc-900/90 border border-zinc-800 text-[11px] font-mono text-zinc-400">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isBackendConnected
                    ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                    : "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                }`}
              />
              <span className="text-zinc-300">
                {isBackendConnected ? "服务在线" : "本地演示"}
              </span>
            </div>

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

            {/* Create Task button */}
            <button
              onClick={onOpenCreateModal}
              className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-mono font-semibold transition-colors shadow-xs"
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
