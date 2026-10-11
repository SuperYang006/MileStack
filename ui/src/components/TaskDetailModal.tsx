import React, { useState, useEffect } from "react";
import { X, GitCommit, CheckCircle2, Clock, Timer, Edit3 } from "lucide-react";
import type { TaskDetails, TaskEvent } from "../types";
import { CopyTaskIdButton } from "./CopyTaskIdButton";

function formatDuration(ms: number): string {
  if (ms < 0) return "0秒";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}秒`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return `${totalMinutes}分${remainingSeconds > 0 ? `${remainingSeconds}秒` : ""}`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return `${totalHours}小时${remainingMinutes > 0 ? `${remainingMinutes}分` : ""}`;
  }
  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return `${days}天${remainingHours > 0 ? `${remainingHours}小时` : ""}`;
}

interface RunExecution {
  runId: string;
  actorLabel?: string | null;
  startedAt: Date;
  endedAt?: Date;
  status: "running" | "in_review" | "completed" | "released" | "incomplete";
  durationMs: number | null;
}

function computeRunExecutions(
  events: TaskEvent[],
  activeRunId: string | null,
  taskStatus: string,
  nowMs: number,
): RunExecution[] {
  const runEventsMap = new Map<string, TaskEvent[]>();
  const runOrder: string[] = [];

  for (const event of events) {
    if (!event.runId) continue;
    if (!runEventsMap.has(event.runId)) {
      runEventsMap.set(event.runId, []);
      runOrder.push(event.runId);
    }
    runEventsMap.get(event.runId)!.push(event);
  }

  const runs: RunExecution[] = [];

  for (const runId of runOrder) {
    const runEvts = runEventsMap.get(runId)!;
    const startedEvent = runEvts.find((e) => e.type === "started");
    if (!startedEvent) {
      runs.push({
        runId,
        actorLabel: runEvts[0]?.actorLabel ?? null,
        startedAt: new Date(NaN),
        status: "incomplete",
        durationMs: null,
      });
      continue;
    }

    const startMs = new Date(startedEvent.createdAt).getTime();
    if (isNaN(startMs)) {
      runs.push({
        runId,
        actorLabel: startedEvent.actorLabel,
        startedAt: new Date(NaN),
        status: "incomplete",
        durationMs: null,
      });
      continue;
    }

    const completedEvent = runEvts.find((e) => e.type === "completed");
    const releasedEvent = runEvts.find((e) => e.type === "released");
    const submittedEvent = runEvts.find((e) => e.type === "submitted_for_review");
    const terminalEvent = completedEvent || releasedEvent || submittedEvent;

    if (terminalEvent) {
      const endMs = new Date(terminalEvent.createdAt).getTime();
      const isValidEnd = !isNaN(endMs) && endMs >= startMs;
      runs.push({
        runId,
        actorLabel: terminalEvent.actorLabel || startedEvent.actorLabel,
        startedAt: new Date(startMs),
        endedAt: isValidEnd ? new Date(endMs) : undefined,
        status:
          terminalEvent.type === "completed"
            ? "completed"
            : terminalEvent.type === "submitted_for_review"
            ? "in_review"
            : "released",
        durationMs: isValidEnd ? Math.max(0, endMs - startMs) : null,
      });
    } else if (activeRunId === runId && (taskStatus === "running" || taskStatus === "blocked")) {
      const elapsed = Math.max(0, nowMs - startMs);
      runs.push({
        runId,
        actorLabel: startedEvent.actorLabel,
        startedAt: new Date(startMs),
        status: "running",
        durationMs: elapsed,
      });
    } else {
      runs.push({
        runId,
        actorLabel: startedEvent.actorLabel,
        startedAt: new Date(startMs),
        status: "incomplete",
        durationMs: null,
      });
    }
  }

  return runs;
}

interface TaskDetailModalProps {
  details: TaskDetails | null;
  isOpen: boolean;
  onClose: () => void;
  isLoading?: boolean;
  onEditInboxTask?: (task: TaskDetails) => void;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  details,
  isOpen,
  onClose,
  isLoading = false,
  onEditInboxTask,
}) => {
  const [now, setNow] = useState(() => Date.now());

  const isRunning =
    isOpen &&
    Boolean(
      details?.task.activeRunId &&
        (details.task.status === "running" || details.task.status === "blocked"),
    );

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const latestClaim = details
    ? [...details.events].reverse().find((event) => event.type === "started")
    : undefined;
  const latestClaimLabel = latestClaim
    ? latestClaim.actorLabel ?? "agent"
    : "未领取";

  const runs = details
    ? computeRunExecutions(
        details.events,
        details.task.activeRunId,
        details.task.status,
        now,
      )
    : [];

  const activeRun = details?.task.activeRunId
    ? runs.find((r) => r.runId === details.task.activeRunId && r.status === "running")
    : undefined;

  const primaryRun =
    activeRun ||
    [...runs].reverse().find((r) => r.status === "completed" || r.status === "in_review") ||
    runs[runs.length - 1];
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-zinc-950 rounded-lg border border-zinc-800 max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 font-semibold flex items-center space-x-1.5">
              <span>{details?.task.id ?? "LOADING..."}</span>
              {details?.task && <CopyTaskIdButton taskId={details.task.id} />}
            </span>
            <span
              className={`font-mono text-[11px] px-2 py-0.5 rounded uppercase font-medium ${
                details?.task.status === "completed"
                  ? "text-emerald-400 bg-emerald-950/60 border border-emerald-900/60"
                  : details?.task.status === "running"
                  ? "text-cyan-400 bg-cyan-950/60 border border-cyan-900/60"
                  : details?.task.status === "blocked"
                  ? "text-rose-400 bg-rose-950/60 border border-rose-900/60"
                  : details?.task.status === "in_review"
                  ? "text-violet-400 bg-violet-950/60 border border-violet-900/60"
                  : "text-zinc-400 bg-zinc-900 border border-zinc-800"
              }`}
            >
              {details?.task.status}
            </span>

            {details?.task.status === "inbox" && onEditInboxTask && (
              <button
                onClick={() => onEditInboxTask(details)}
                className="inline-flex items-center space-x-1 px-2 py-0.5 text-[11px] font-mono text-amber-300 bg-amber-950/50 hover:bg-amber-950/80 border border-amber-900/60 rounded transition-colors"
                title="编辑此 Inbox 任务"
              >
                <Edit3 className="w-3 h-3" />
                <span>编辑草稿</span>
              </button>
            )}
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

              {/* Execution Duration & Metadata */}
              <div className="bg-zinc-900/60 p-3 rounded border border-zinc-850 space-y-2.5">
                {primaryRun && primaryRun.durationMs !== null && (
                  <div className="flex items-center justify-between p-2.5 rounded bg-zinc-950/80 border border-zinc-800">
                    <div className="flex items-center space-x-2.5">
                      {primaryRun.status === "running" ? (
                        <Timer className="w-4 h-4 text-cyan-400 animate-pulse shrink-0" />
                      ) : (
                        <Clock className="w-4 h-4 text-emerald-400 shrink-0" />
                      )}
                      <div>
                        <div className="flex items-center space-x-1.5">
                          <span className="font-semibold text-zinc-200">
                            {primaryRun.status === "running"
                              ? "当前执行自然耗时"
                              : primaryRun.status === "completed"
                              ? "最终完成自然耗时"
                              : primaryRun.status === "in_review"
                              ? "提交审核前自然耗时"
                              : "上次释放前耗时"}
                          </span>
                          {primaryRun.status === "running" && (
                            <span className="text-[10px] text-cyan-400 font-normal">
                              [实时计时]
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          自然流逝时间，包含阻塞与等待
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 pl-2">
                      <div className="font-mono text-xs font-bold text-cyan-300">
                        {formatDuration(primaryRun.durationMs)}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono">
                        Run: {primaryRun.runId.slice(0, 8)}
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-zinc-500">创建者:</span>{" "}
                    <span className="text-zinc-300">{details.task.createdBy}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">最近领取者:</span>{" "}
                    <span className="text-cyan-300">{latestClaimLabel}</span>
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

                {runs.length > 1 && (
                  <div className="pt-2 border-t border-zinc-800 space-y-1.5">
                    <div className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider flex items-center justify-between">
                      <span>各次执行记录 ({runs.length}次领取)</span>
                      <span className="text-zinc-600 font-normal lowercase">按 runId 独立配对</span>
                    </div>
                    <div className="space-y-1">
                      {runs.map((r, i) => (
                        <div
                          key={r.runId}
                          className="flex items-center justify-between text-[11px] bg-zinc-950/60 px-2 py-1 rounded border border-zinc-850"
                        >
                          <div className="flex items-center space-x-1.5 min-w-0">
                            <span className="text-zinc-500">#{i + 1}</span>
                            <span className="font-mono text-zinc-400 truncate">
                              {r.runId.slice(0, 8)}...
                            </span>
                            <span
                              className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                                r.status === "completed"
                                  ? "text-emerald-400 bg-emerald-950/60"
                                  : r.status === "in_review"
                                  ? "text-violet-400 bg-violet-950/60"
                                  : r.status === "running"
                                  ? "text-cyan-400 bg-cyan-950/60"
                                  : r.status === "released"
                                  ? "text-amber-400 bg-amber-950/60"
                                  : "text-zinc-500 bg-zinc-900"
                              }`}
                            >
                              {r.status === "completed"
                                ? "已完成"
                                : r.status === "in_review"
                                ? "待审核"
                                : r.status === "running"
                                ? "执行中"
                                : r.status === "released"
                                ? "已释放"
                                : "未结束"}
                            </span>
                            {r.actorLabel && (
                              <span className="text-zinc-500 text-[10px]">· {r.actorLabel}</span>
                            )}
                          </div>
                          <span className="font-mono text-zinc-200 shrink-0">
                            {r.durationMs !== null ? formatDuration(r.durationMs) : "数据缺失"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
