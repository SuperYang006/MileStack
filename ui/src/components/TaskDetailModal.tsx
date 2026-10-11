import React from "react";
import { X, GitCommit, CheckCircle2 } from "lucide-react";
import type { TaskDetails } from "../types";

interface TaskDetailModalProps {
  details: TaskDetails | null;
  isOpen: boolean;
  onClose: () => void;
  isLoading?: boolean;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  details,
  isOpen,
  onClose,
  isLoading = false,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-zinc-950 rounded-lg border border-zinc-800 max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 font-semibold">
              {details?.task.id ?? "LOADING..."}
            </span>
            <span
              className={`font-mono text-[11px] px-2 py-0.5 rounded uppercase font-medium ${
                details?.task.status === "completed"
                  ? "text-emerald-400 bg-emerald-950/60 border border-emerald-900/60"
                  : details?.task.status === "in_progress"
                  ? "text-cyan-400 bg-cyan-950/60 border border-cyan-900/60"
                  : details?.task.status === "blocked"
                  ? "text-rose-400 bg-rose-950/60 border border-rose-900/60"
                  : "text-zinc-400 bg-zinc-900 border border-zinc-800"
              }`}
            >
              {details?.task.status}
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5 font-mono text-xs">
          {isLoading || !details ? (
            <div className="py-12 text-center text-zinc-600">// 正在获取任务完整记录...</div>
          ) : (
            <>
              {/* Title & Objective */}
              <div>
                <h2 className="text-sm font-bold text-zinc-100">{details.task.title}</h2>
                {details.task.objective && (
                  <p className="mt-2 text-zinc-400 bg-zinc-900/70 p-3 rounded border border-zinc-850 leading-relaxed">
                    {details.task.objective}
                  </p>
                )}
              </div>

              {/* Acceptance Criteria */}
              {details.task.acceptanceCriteria && details.task.acceptanceCriteria.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" />
                    <span>验收条件</span>
                  </h3>
                  <div className="space-y-1 bg-zinc-900/40 p-2.5 rounded border border-zinc-850">
                    {details.task.acceptanceCriteria.map((item, idx) => (
                      <div key={idx} className="flex items-start space-x-2 text-zinc-300">
                        <span className="text-cyan-400 select-none">[x]</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Execution Metadata */}
              <div className="grid grid-cols-2 gap-2 text-[11px] bg-zinc-900/60 p-2.5 rounded border border-zinc-850">
                <div>
                  <span className="text-zinc-500">创建者:</span>{" "}
                  <span className="text-zinc-300">{details.task.createdBy}</span>
                </div>
                <div>
                  <span className="text-zinc-500">活跃执行 ID:</span>{" "}
                  <span className="text-cyan-400">{details.task.activeRunId || "无"}</span>
                </div>
                <div>
                  <span className="text-zinc-500">创建时间:</span>{" "}
                  <span className="text-zinc-400">
                    {new Date(details.task.createdAt).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">更新时间:</span>{" "}
                  <span className="text-zinc-400">
                    {new Date(details.task.updatedAt).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Event Stream */}
              <div>
                <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
                  <GitCommit className="w-3.5 h-3.5 text-zinc-400" />
                  <span>事件历史流水 ({details.events.length})</span>
                </h3>

                {details.events.length === 0 ? (
                  <p className="text-zinc-600">// 暂无事件记录</p>
                ) : (
                  <div className="relative pl-5 space-y-3 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-px before:bg-zinc-800">
                    {details.events.map((evt) => (
                      <div key={evt.id} className="relative">
                        <div className="absolute -left-5 top-1.5 w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        <div className="bg-zinc-900/80 border border-zinc-850 rounded p-2.5 text-[11px]">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-zinc-200">{evt.summary}</span>
                            <span className="text-zinc-500 text-[10px]">
                              {new Date(evt.createdAt).toLocaleTimeString()}
                            </span>
                          </div>

                          <div className="text-[10px] text-zinc-500 mb-1.5">
                            类型: {evt.type}
                            {evt.actorLabel && ` • 执行者: ${evt.actorLabel}`}
                            {evt.runId && ` • 执行 ID: ${evt.runId}`}
                          </div>

                          {evt.completedWork && evt.completedWork.length > 0 && (
                            <div className="mt-1 text-emerald-400/90 bg-emerald-950/20 p-1.5 rounded border border-emerald-900/30">
                              <span className="font-semibold text-emerald-300">已完成阶段项:</span>
                              <div className="mt-0.5 space-y-0.5">
                                {evt.completedWork.map((w, i) => (
                                  <div key={i}>+ {w}</div>
                                ))}
                              </div>
                            </div>
                          )}

                          {evt.currentStep && (
                            <div className="mt-1 text-zinc-300">
                              <span className="text-zinc-500">&gt; 当前步骤:</span> {evt.currentStep}
                            </div>
                          )}
                          {evt.nextStep && (
                            <div className="mt-0.5 text-zinc-400">
                              <span className="text-zinc-500">&gt;&gt; 下一步骤:</span> {evt.nextStep}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-zinc-800 bg-zinc-900/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1 font-mono text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 rounded transition-colors"
          >
            [关闭 ESC]
          </button>
        </div>
      </div>
    </div>
  );
};
