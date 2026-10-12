import React, { useState, useEffect } from "react";
import { X, GitCommit, CheckCircle2, Clock, Timer, Edit3, GitFork, ArrowRight, Zap, ShieldAlert, ShieldCheck, Terminal, Bot, Check, MessageSquare } from "lucide-react";
import { EmptyState } from "./EmptyState";
import type { TaskDetails, TaskEvent, TaskSummary } from "../types";
import { TaskIdBadge } from "./CopyTaskIdButton";
import { buildDownstreamMap } from "../utils/dependencyGraph";
import {
  computeRunExecutions,
  formatDuration,
  type RunExecution,
} from "../utils/runExecutions";

interface TaskDetailModalProps {
  details: TaskDetails | null;
  isOpen: boolean;
  onClose: () => void;
  isLoading?: boolean;
  isError?: boolean;
  onEditInboxTask?: (task: TaskDetails) => void;
  allTasks?: Map<string, TaskSummary>;
  onSelectTask?: (taskId: string) => void;
  onApprove?: (taskId: string) => void;
  onWaiveApproval?: (taskId: string, reason: string) => void;
  onRequestChanges?: (taskId: string, feedback: string) => void;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  details,
  isOpen,
  onClose,
  isLoading = false,
  isError = false,
  onEditInboxTask,
  allTasks = new Map(),
  onSelectTask,
  onApprove,
  onWaiveApproval,
  onRequestChanges,
}) => {
  const [now, setNow] = useState(() => Date.now());

  const runs = details
    ? computeRunExecutions(
        details.events,
        details.task.activeRunId,
        details.task.status,
        now,
        details.reviews,
        details.task.activeReviewRunId,
      )
    : [];

  const executionRuns = runs.filter((r) => r.kind !== "review");

  const isRunning =
    isOpen &&
    Boolean(
      (details?.task.activeRunId &&
        (details.task.status === "running" || details.task.status === "blocked")) ||
      (details?.task.activeReviewRunId && details.task.status === "in_review") ||
      runs.some((r) => r.status === "running" || r.status === "reviewing"),
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

  const activeRun = details?.task.activeRunId
    ? executionRuns.find((r) => r.runId === details.task.activeRunId && r.status === "running")
    : undefined;

  const primaryRun =
    activeRun ||
    [...executionRuns].reverse().find((r) => r.status === "completed" || r.status === "in_review") ||
    executionRuns[executionRuns.length - 1] ||
    runs[runs.length - 1];
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-zinc-950 rounded-lg border border-zinc-800 max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            {details?.task ? (
              <TaskIdBadge
                taskId={details.task.id}
                variant="zinc"
                className="text-xs px-2 py-0.5 font-semibold"
              />
            ) : (
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-500">
                LOADING...
              </span>
            )}
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

            {details?.task.riskLevel && (
              <span
                className={`font-mono text-[11px] px-2 py-0.5 rounded uppercase font-medium ${
                  details.task.riskLevel === "low"
                    ? "text-emerald-400 bg-emerald-950/60 border border-emerald-900/60"
                    : details.task.riskLevel === "high"
                    ? "text-rose-400 bg-rose-950/60 border border-rose-900/60 font-bold"
                    : "text-amber-400 bg-amber-950/60 border border-amber-900/60"
                }`}
                title={`风险等级: ${details.task.riskLevel} (${details.task.riskConfirmed ? "已确认" : "未确认"})`}
              >
                {details.task.riskLevel === "low" ? "低风险 (LOW)" : details.task.riskLevel === "high" ? "高风险 (HIGH)" : "中风险 (MED)"}
                {details.task.riskConfirmed ? " ✓" : " (待确认)"}
              </span>
            )}

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
          {isLoading ? (
            <div className="py-12 text-center text-zinc-500 flex flex-col items-center justify-center space-y-2">
              <Clock className="w-5 h-5 text-zinc-500 animate-spin" />
              <span>正在获取任务完整记录...</span>
            </div>
          ) : isError || !details ? (
            <div className="py-12 text-center text-rose-400 flex flex-col items-center justify-center space-y-2">
              <ShieldAlert className="w-5 h-5 text-rose-400" />
              <span>获取任务详情失败，请检查服务连接并重试</span>
            </div>
          ) : (
            <>
              {/* Title & Objective */}
              <div>
                <h2 className="text-sm font-bold text-zinc-100">{details.task.title}</h2>
                {details.task.objective ? (
                  <p className="mt-2 text-zinc-400 bg-zinc-900/70 p-3 rounded border border-zinc-850 leading-relaxed">
                    {details.task.objective}
                  </p>
                ) : (
                  <p className="mt-2 text-zinc-500 italic bg-zinc-900/30 p-2.5 rounded border border-zinc-850/80 leading-relaxed text-[11px]">
                    未提供详细目标说明
                  </p>
                )}
              </div>

              {/* Low-risk auto-completion Callout */}
              {details.task.status === "completed" && details.task.riskLevel === "low" && (
                <div className="p-3 rounded bg-emerald-950/40 border border-emerald-800/80 text-emerald-200 text-xs flex items-start space-x-2.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-bold text-emerald-300">
                      低风险自动完成（系统免检签发）
                    </div>
                    <div className="text-[11px] text-emerald-400/90 leading-relaxed">
                      依据系统风险策略，该任务经确认为低风险，且提交后由 AI 审核代理完整执行验证并通过，系统已自动批准完成并归档。
                    </div>
                  </div>
                </div>
              )}

              {/* In-Review Decision Controls */}
              {details.task.status === "in_review" && (() => {
                const latestRev = details.reviews?.at(-1);
                const isPassed = latestRev?.status === "passed";
                const canWaiveApproval =
                  latestRev?.status === "pending" ||
                  latestRev?.status === "in_progress";
                return (
                  <div className="p-3 rounded bg-violet-950/40 border border-violet-800/60 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                        <span className="font-bold text-violet-200">
                          待开发者审核与终审决策
                        </span>
                      </div>
                      <span className="text-[10px] text-violet-400 font-mono">
                        {latestRev ? `当前状态: ${latestRev.status}` : "等待领取"}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400 leading-relaxed">
                      {isPassed
                        ? "AI 审核已通过并提供完整验证证据。请核对提交产物与验证结果后执行最终批准或填写反馈退回。"
                        : "AI 审核尚未出具通过结论。可等待 AI 结论、填写反馈退回，或在核对提交产物后填写原因直接验收。"}
                    </div>
                    <div className="flex items-center space-x-2 pt-1">
                      {onApprove && (
                        <button
                          onClick={() => onApprove(details.task.id)}
                          disabled={!isPassed}
                          className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-semibold transition-colors ${
                            isPassed
                              ? "bg-emerald-600 hover:bg-emerald-500 text-zinc-950 cursor-pointer shadow-xs"
                              : "bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-50"
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>批准并通过任务</span>
                        </button>
                      )}
                      {canWaiveApproval && onWaiveApproval && (
                        <button
                          onClick={() => {
                            const reason = window.prompt(
                              "请输入直接验收该任务的原因：",
                              "",
                            );
                            if (reason?.trim())
                              onWaiveApproval(details.task.id, reason.trim());
                          }}
                          className="inline-flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-semibold bg-violet-900/60 hover:bg-violet-800/80 border border-violet-700 text-violet-100 transition-colors"
                          title="跳过 AI 审核结论直接验收，验收原因记入任务事件"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>直接验收</span>
                        </button>
                      )}
                      {onRequestChanges && (
                        <button
                          onClick={() => {
                            const fb = window.prompt("请输入退回返工的修改意见：", "");
                            if (fb?.trim()) onRequestChanges(details.task.id, fb.trim());
                          }}
                          className="inline-flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-semibold bg-amber-950/60 hover:bg-amber-900/80 border border-amber-800 text-amber-200 transition-colors"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>退回返工</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Acceptance Criteria */}
              <div>
                <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" />
                  <span>验收条件</span>
                </h3>
                {details.task.acceptanceCriteria && details.task.acceptanceCriteria.length > 0 ? (
                  <div className="space-y-1 bg-zinc-900/40 p-2.5 rounded border border-zinc-850">
                    {details.task.acceptanceCriteria.map((item, idx) => (
                      <div key={idx} className="flex items-start space-x-2 text-zinc-300">
                        <span className="text-cyan-400 select-none">[x]</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-zinc-900/30 p-2.5 rounded border border-zinc-850 text-zinc-500 italic text-[11px]">
                    未指定具体验收条件
                  </div>
                )}
              </div>

              {/* Dependencies & Flow Section */}
              <div>
                <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
                  <GitFork className="w-3.5 h-3.5 text-zinc-400" />
                  <span>任务依赖与拓扑关系</span>
                </h3>
                <div className="bg-zinc-900/40 p-3 rounded border border-zinc-850 space-y-3 font-mono text-xs">
                  {/* Direct Dependencies */}
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                      <span>前置直接依赖 ({details.task.dependencyIds.length})</span>
                      {details.task.dependencyIds.length > 0 && (() => {
                        const waitingCount = details.task.dependencyIds.filter(
                          (id) => allTasks.get(id)?.status !== "completed",
                        ).length;
                        return (
                          <span className={waitingCount === 0 ? "text-emerald-400" : "text-amber-400"}>
                            {waitingCount === 0 ? "全部已满足" : `等待 ${waitingCount} 个未完成`}
                          </span>
                        );
                      })()}
                    </div>
                    {details.task.dependencyIds.length === 0 ? (
                      <p className="text-zinc-500 text-[11px]">无前置依赖，可直接推进</p>
                    ) : (
                      <div className="space-y-1.5">
                        {details.task.dependencyIds.map((depId) => {
                          const dep = allTasks.get(depId);
                          const isDone = dep?.status === "completed";
                          return (
                            <div
                              key={depId}
                              onClick={() => onSelectTask?.(depId)}
                              className={`flex items-center justify-between p-2 rounded border cursor-pointer transition-colors ${
                                isDone
                                  ? "bg-emerald-950/20 border-emerald-900/40 hover:border-emerald-700"
                                  : "bg-zinc-950/80 border-zinc-800 hover:border-zinc-700"
                              }`}
                            >
                              <div className="flex items-center space-x-2 truncate">
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${
                                    isDone ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                                  }`}
                                />
                                <TaskIdBadge taskId={depId} variant="muted" />
                                <span className="text-zinc-200 truncate text-xs">
                                  {dep?.title ?? `任务 ${depId.slice(0, 8)}`}
                                </span>
                              </div>
                              <div className="shrink-0 flex items-center space-x-1.5">
                                <span
                                  className={`px-1.5 py-0.2 rounded text-[10px] ${
                                    isDone
                                      ? "text-emerald-300 bg-emerald-950/60 border border-emerald-800/60"
                                      : "text-amber-300 bg-amber-950/60 border border-amber-800/60"
                                  }`}
                                >
                                  {isDone ? "已完成" : dep?.status ? `进行中: ${dep.status}` : "等待中"}
                                </span>
                                <ArrowRight className="w-3 h-3 text-zinc-600" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Downstream Unblocks */}
                  {(() => {
                    const dMap = buildDownstreamMap(allTasks);
                    const downstreamIds = dMap.get(details.task.id) || [];
                    if (downstreamIds.length === 0) return null;
                    return (
                      <div className="pt-2 border-t border-zinc-850/80">
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">
                          <span>完成后将推进/解锁的下游任务 ({downstreamIds.length})</span>
                        </div>
                        <div className="space-y-1.5">
                          {downstreamIds.map((childId) => {
                            const child = allTasks.get(childId);
                            return (
                              <div
                                key={childId}
                                onClick={() => onSelectTask?.(childId)}
                                className="flex items-center justify-between p-2 rounded bg-zinc-950/80 border border-zinc-800 hover:border-zinc-700 cursor-pointer transition-colors"
                              >
                                <div className="flex items-center space-x-2 truncate">
                                  <TaskIdBadge taskId={childId} variant="muted" />
                                  <span className="text-zinc-200 truncate text-xs">
                                    {child?.title ?? `任务 ${childId.slice(0, 8)}`}
                                  </span>
                                </div>
                                <div className="shrink-0 flex items-center space-x-1.5 text-zinc-400 text-[10px]">
                                  <span>状态: {child?.status ?? "未知"}</span>
                                  <ArrowRight className="w-3 h-3 text-zinc-600" />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

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
                  <div>
                    <span className="text-zinc-500">风险等级:</span>{" "}
                    <span className="text-zinc-300 uppercase font-semibold">
                      {details.task.riskLevel || "medium"}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">风险确认状态:</span>{" "}
                    <span className="text-zinc-300">
                      {details.task.riskConfirmed ? `已确认 (${details.task.riskConfirmedBy || "开发者"})` : "待确认"}
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
                                  : r.status === "review_passed"
                                  ? "text-emerald-400 bg-emerald-950/60"
                                  : r.status === "changes_requested"
                                  ? "text-rose-400 bg-rose-950/60"
                                  : r.status === "reviewing"
                                  ? "text-cyan-400 bg-cyan-950/60"
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
                                : r.status === "review_passed"
                                ? "审核通过"
                                : r.status === "changes_requested"
                                ? "已退回"
                                : r.status === "waived"
                                ? "开发者直接验收"
                                : r.status === "reviewing"
                                ? "审核中"
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

              {/* AI Reviews & Verification Evidence */}
              <div>
                <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
                  <Bot className="w-3.5 h-3.5 text-violet-400" />
                  <span>AI 审核记录与证据 ({details.reviews?.length || 0})</span>
                </h3>

                {!details.reviews || details.reviews.length === 0 ? (
                  <div className="bg-zinc-900/30 p-3 rounded border border-zinc-850 text-zinc-500 text-[11px]">
                    该任务尚未产生 AI 审核会话记录
                  </div>
                ) : (
                  <div className="space-y-3">
                    {details.reviews.map((rev) => (
                      <div
                        key={rev.id}
                        className="bg-zinc-900/70 border border-zinc-800 rounded p-3 space-y-2.5 font-mono text-xs"
                      >
                        {/* Review Header */}
                        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-zinc-200">
                              第 {rev.reviewRound} 轮审核
                            </span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] ${
                                rev.status === "passed"
                                  ? "bg-emerald-950/80 border border-emerald-800 text-emerald-300 font-bold"
                                  : rev.status === "in_progress"
                                  ? "bg-cyan-950/80 border border-cyan-800 text-cyan-300"
                                  : rev.status === "changes_requested"
                                  ? "bg-rose-950/80 border border-rose-800 text-rose-300"
                                  : rev.status === "waived"
                                  ? "bg-violet-950/80 border border-violet-800 text-violet-300 font-bold"
                                  : "bg-zinc-800 border border-zinc-700 text-zinc-400"
                              }`}
                            >
                              {rev.status === "passed"
                                ? "审核通过 (PASSED)"
                                : rev.status === "in_progress"
                                ? "审核中 (IN_PROGRESS)"
                                : rev.status === "changes_requested"
                                ? "要求修改 (CHANGES_REQUESTED)"
                                : rev.status === "waived"
                                ? "开发者直接验收 (WAIVED)"
                                : "未领取 (PENDING)"}
                            </span>
                            {rev.reviewerActorLabel && (
                              <span className="text-[10px] text-violet-300 bg-violet-950/40 px-1.5 py-0.2 rounded border border-violet-900/50">
                                审核代理: {rev.reviewerActorLabel}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-zinc-500">
                            {new Date(rev.createdAt).toLocaleString()}
                          </span>
                        </div>

                        {/* Git Commit & Worktree Artifact */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] bg-zinc-950/50 p-2 rounded border border-zinc-850">
                          <div className="flex items-center space-x-1.5 truncate">
                            <GitCommit className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                            <span className="text-zinc-500">Commit SHA:</span>
                            <span className="text-cyan-400 select-all font-mono truncate" title={rev.commitSha}>
                              {rev.commitSha}
                            </span>
                          </div>
                          {(rev.branch || rev.worktree) && (
                            <div className="flex items-center space-x-1.5 truncate">
                              <span className="text-zinc-500">Branch/Worktree:</span>
                              <span className="text-zinc-300 truncate">
                                {rev.branch || rev.worktree}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Summary */}
                        {rev.summary && (
                          <div className="text-[11px] bg-zinc-950/30 p-2 rounded border border-zinc-850 leading-relaxed text-zinc-300">
                            <span className="text-zinc-500 font-semibold block mb-0.5">审核摘要：</span>
                            {rev.summary}
                          </div>
                        )}

                        {/* Verification Evidence */}
                        {rev.verificationEvidence && rev.verificationEvidence.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-[10px] font-semibold text-zinc-400 flex items-center space-x-1">
                              <Terminal className="w-3 h-3 text-emerald-400" />
                              <span>验证命令与执行结果 ({rev.verificationEvidence.length})：</span>
                            </div>
                            <div className="space-y-1 bg-zinc-950/80 p-2 rounded border border-zinc-850 font-mono text-[11px]">
                              {rev.verificationEvidence.map((ev, i) => (
                                <div key={i} className="space-y-0.5 border-b border-zinc-900 last:border-b-0 pb-1 last:pb-0">
                                  <div className="text-cyan-300 flex items-center space-x-1">
                                    <span className="text-zinc-600 select-none">$</span>
                                    <span>{ev.command}</span>
                                  </div>
                                  <div className="text-zinc-400 text-[10px] pl-3 whitespace-pre-wrap">
                                    {ev.result}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Findings */}
                        {rev.findings && rev.findings.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-[10px] font-semibold text-amber-400 flex items-center space-x-1">
                              <ShieldAlert className="w-3 h-3 text-amber-400" />
                              <span>发现的问题与改进建议 ({rev.findings.length})：</span>
                            </div>
                            <div className="space-y-1">
                              {rev.findings.map((f, i) => (
                                <div
                                  key={i}
                                  className="p-2 rounded bg-amber-950/20 border border-amber-900/40 text-[11px] space-y-1"
                                >
                                  <div className="flex items-center space-x-1.5">
                                    <span
                                      className={`px-1 py-0.2 rounded text-[9px] uppercase font-bold ${
                                        f.severity === "high"
                                          ? "bg-rose-950 border border-rose-800 text-rose-300"
                                          : f.severity === "low"
                                          ? "bg-emerald-950 border border-emerald-800 text-emerald-300"
                                          : "bg-amber-950 border border-amber-800 text-amber-300"
                                      }`}
                                    >
                                      {f.severity}
                                    </span>
                                    <span className="text-zinc-200 font-medium">{f.issue}</span>
                                  </div>
                                  <div className="text-zinc-400 text-[10px] pl-2">
                                    建议：{f.suggestion}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
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
                  <EmptyState
                    icon={GitCommit}
                    title="暂无事件流水记录"
                    description="任务被认领或推进后，将在此自动追加记录"
                    tag="暂无流水"
                    compact
                  />
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
