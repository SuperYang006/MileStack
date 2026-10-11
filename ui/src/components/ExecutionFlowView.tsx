import React, { useState } from "react";
import { GitFork, GitMerge, ArrowRight, ArrowDown, Zap, ChevronDown, ChevronRight, CheckCircle2, Clock } from "lucide-react";
import type { ProjectStatus, TaskStatus } from "../types";
import { buildExecutionFlowGroups, type ExecutionFlowGroup } from "../utils/dependencyGraph";
import { TaskIdBadge } from "./CopyTaskIdButton";

interface ExecutionFlowViewProps {
  status: ProjectStatus;
  onSelectTask: (taskId: string) => void;
}

function getStatusBadge(status: TaskStatus) {
  switch (status) {
    case "completed":
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-950/60 border border-emerald-800/60 text-emerald-300">
          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
          <span>已完成</span>
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-cyan-950/60 border border-cyan-800/60 text-cyan-300">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          <span>执行中</span>
        </span>
      );
    case "in_review":
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-violet-950/60 border border-violet-800/60 text-violet-300">
          <Clock className="w-2.5 h-2.5 text-violet-400" />
          <span>待审核</span>
        </span>
      );
    case "ready":
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-indigo-950/60 border border-indigo-800/60 text-indigo-300">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          <span>就绪</span>
        </span>
      );
    case "blocked":
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-950/60 border border-rose-800/60 text-rose-300">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
          <span>阻塞</span>
        </span>
      );
    case "inbox":
    default:
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-zinc-900 border border-zinc-800 text-zinc-400">
          <span>待整理</span>
        </span>
      );
  }
}

export const ExecutionFlowView: React.FC<ExecutionFlowViewProps> = ({ status, onSelectTask }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const groups = buildExecutionFlowGroups(status);

  if (groups.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-zinc-800/90 bg-zinc-900/40 backdrop-blur-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2.5 bg-zinc-900/60 hover:bg-zinc-900 flex items-center justify-between text-left transition-colors cursor-pointer"
      >
        <div className="flex items-center space-x-2">
          <GitFork className="w-3.5 h-3.5 text-indigo-400" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase">
            执行关系拓扑 ({groups.length})
          </h2>
          <span className="text-[11px] font-mono text-zinc-500 hidden sm:inline">
            · 前置任务、并行分支与汇合路径
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-[10px] font-mono text-zinc-500">
            {isExpanded ? "收起拓扑" : "展开拓扑"}
          </span>
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="p-4 space-y-5">
          {groups.map((group) => {
            const isChain = group.type === "chain";

            if (isChain) {
              const target = group.branches[0];
              return (
                <div
                  key={group.id}
                  className="p-3 rounded-md bg-zinc-950/70 border border-zinc-850 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono"
                >
                  {/* Root */}
                  <div
                    onClick={() => onSelectTask(group.root.id)}
                    className="flex-1 min-w-0 flex items-center space-x-2 p-2 rounded bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 cursor-pointer transition-colors"
                  >
                    <TaskIdBadge taskId={group.root.id} variant="muted" />
                    <span className="text-zinc-200 truncate flex-1 font-medium">{group.root.title}</span>
                    {getStatusBadge(group.root.status)}
                  </div>

                  <div className="flex items-center justify-center shrink-0 text-zinc-600 px-1">
                    <ArrowRight className="w-4 h-4 text-zinc-500 hidden sm:block" />
                    <ArrowDown className="w-4 h-4 text-zinc-500 sm:hidden" />
                  </div>

                  {/* Target */}
                  {target && (
                    <div
                      onClick={() => onSelectTask(target.id)}
                      className={`flex-1 min-w-0 flex items-center space-x-2 p-2 rounded border cursor-pointer transition-colors ${
                        target.isRunnable
                          ? "bg-emerald-950/20 border-emerald-800/50 hover:border-emerald-700"
                          : "bg-zinc-900/80 border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      <TaskIdBadge taskId={target.id} variant="muted" />
                      <span className="text-zinc-200 truncate flex-1 font-medium">{target.title}</span>
                      <div className="shrink-0 flex items-center space-x-1.5">
                        {target.isRunnable && (
                          <span className="inline-flex items-center space-x-0.5 px-1.5 py-0.2 rounded text-[9px] bg-emerald-950/80 border border-emerald-700/60 text-emerald-300">
                            <Zap className="w-2.5 h-2.5 text-emerald-400" />
                            <span>可推进</span>
                          </span>
                        )}
                        {getStatusBadge(target.status)}
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // Structured Stage Flow for Fork / Fork-Merge
            return (
              <div
                key={group.id}
                className="p-3.5 rounded-md bg-zinc-950/70 border border-zinc-850 space-y-3 font-mono text-xs"
              >
                {/* Stage 1: Root / Predecessor */}
                <div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-1.5">
                    <span className="flex items-center space-x-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                      <span>前置输入任务</span>
                    </span>
                    <span className="text-[10px]">完成后触发下游分支</span>
                  </div>

                  <div
                    onClick={() => group.root.id !== "multi-roots" && onSelectTask(group.root.id)}
                    className="flex items-center justify-between gap-3 p-2.5 rounded bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center space-x-2 truncate">
                      {group.root.id !== "multi-roots" && (
                        <TaskIdBadge taskId={group.root.id} variant="muted" />
                      )}
                      <span className="text-zinc-200 font-semibold truncate text-xs">
                        {group.root.title}
                      </span>
                    </div>
                    {group.root.id !== "multi-roots" && getStatusBadge(group.root.status)}
                  </div>
                </div>

                {/* Fork Indicator Line */}
                <div className="flex items-center justify-center gap-2 py-0.5 text-zinc-600 text-[10px]">
                  <div className="h-px bg-zinc-800 flex-1" />
                  <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-indigo-300 shrink-0">
                    <GitFork className="w-3 h-3 text-indigo-400" />
                    <span>派生 {group.branches.length} 个并行分支</span>
                  </div>
                  <div className="h-px bg-zinc-800 flex-1" />
                </div>

                {/* Stage 2: Parallel Branches Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {group.branches.map((branch) => (
                    <div
                      key={branch.id}
                      onClick={() => onSelectTask(branch.id)}
                      className={`flex flex-col justify-between p-2.5 rounded border transition-colors cursor-pointer gap-2 ${
                        branch.isRunnable
                          ? "bg-emerald-950/20 border-emerald-800/60 hover:border-emerald-600"
                          : "bg-zinc-900/70 border-zinc-850 hover:border-zinc-750"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <TaskIdBadge taskId={branch.id} variant="muted" />
                        <div className="shrink-0 flex items-center space-x-1">
                          {branch.isRunnable && (
                            <span className="inline-flex items-center space-x-0.5 px-1.5 py-0.2 rounded text-[9px] bg-emerald-950/80 border border-emerald-700/60 text-emerald-300">
                              <Zap className="w-2.5 h-2.5 text-emerald-400" />
                              <span>可并行</span>
                            </span>
                          )}
                          {getStatusBadge(branch.status)}
                        </div>
                      </div>
                      <h4 className="text-zinc-200 text-xs font-medium line-clamp-2 leading-relaxed" title={branch.title}>
                        {branch.title}
                      </h4>
                    </div>
                  ))}
                </div>

                {/* Stage 3: Merge Target (if present) */}
                {group.mergeTarget && (
                  <>
                    {/* Merge Indicator Line */}
                    <div className="flex items-center justify-center gap-2 py-0.5 text-zinc-600 text-[10px]">
                      <div className="h-px bg-zinc-800 flex-1" />
                      <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-amber-300 shrink-0">
                        <GitMerge className="w-3 h-3 text-amber-400" />
                        <span>汇合推进 (需分支全部完成)</span>
                      </div>
                      <div className="h-px bg-zinc-800 flex-1" />
                    </div>

                    <div>
                      <div
                        onClick={() => onSelectTask(group.mergeTarget!.id)}
                        className="flex items-center justify-between gap-3 p-2.5 rounded bg-amber-950/15 border border-amber-900/50 hover:border-amber-700/70 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <TaskIdBadge taskId={group.mergeTarget.id} variant="muted" />
                          <span className="text-zinc-200 font-semibold truncate text-xs">
                            {group.mergeTarget.title}
                          </span>
                        </div>
                        <div className="shrink-0 flex items-center space-x-2">
                          <span className="text-[10px] text-amber-400/90 hidden sm:inline">
                            等待 {group.mergeTarget.waitingCount} 项依赖
                          </span>
                          {getStatusBadge(group.mergeTarget.status)}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
