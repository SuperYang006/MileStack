import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  MessageSquare,
  ArrowUpRight,
  CheckCircle2,
  ShieldAlert,
  GitCommit,
  Bot,
  Clock,
  Target,
  ListChecks,
  Terminal,
  GitBranch,
} from "lucide-react";
import type { TaskSummary, TaskDetails } from "../types";
import { TaskIdBadge } from "./CopyTaskIdButton";
import { apiClient } from "../api/client";

interface ReviewTasksProps {
  tasks: TaskSummary[];
  onApprove: (taskId: string) => void;
  onRequestChanges: (taskId: string, feedback: string) => void;
  onSelectTask: (taskId: string) => void;
}

const ReviewTaskItem: React.FC<{
  task: TaskSummary;
  onApprove: (taskId: string) => void;
  onRequestChanges: (taskId: string, feedback: string) => void;
  onSelectTask: (taskId: string) => void;
}> = ({ task, onApprove, onRequestChanges, onSelectTask }) => {
  const { data: details, isLoading, isError } = useQuery<TaskDetails>({
    queryKey: ["taskDetails", task.id],
    queryFn: () => apiClient.getTaskDetails(task.id),
    refetchInterval: 5000,
  });

  const latestReview = details?.reviews?.at(-1);
  const reviewStatus = latestReview?.status ?? "pending";
  const reviewerLabel = latestReview?.reviewerActorLabel;

  // Review states:
  // 1. pending: 未领取 (等待 AI 审核)
  // 2. in_progress: AI 审核中
  // 3. passed: AI 已通过 · 等待开发者人工批准
  // 4. changes_requested: AI 退回返工
  const isPassed = reviewStatus === "passed";
  const isInProgress = reviewStatus === "in_progress";
  const isPending = !latestReview || reviewStatus === "pending";

  const getStatusBadge = () => {
    if (isPending) {
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-900 border border-zinc-750 text-zinc-400">
          <Clock className="w-2.5 h-2.5 text-zinc-400" />
          <span>未领取 · 等待 AI 审核</span>
        </span>
      );
    }
    if (isInProgress) {
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-950/60 border border-cyan-800 text-cyan-300">
          <Bot className="w-2.5 h-2.5 text-cyan-400 animate-pulse" />
          <span>AI 审核中</span>
        </span>
      );
    }
    if (isPassed) {
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950/60 border border-emerald-800 text-emerald-300 font-bold">
          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
          <span>AI 已通过 · 待人工批准</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-950/60 border border-amber-800 text-amber-300">
        <ShieldAlert className="w-2.5 h-2.5 text-amber-400" />
        <span>要求修改</span>
      </span>
    );
  };

  const riskBadge = (
    <span
      className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-mono shrink-0 ${
        task.riskLevel === "low"
          ? "bg-emerald-950/60 border border-emerald-850 text-emerald-300"
          : task.riskLevel === "high"
          ? "bg-rose-950/60 border border-rose-850 text-rose-300 font-bold"
          : "bg-amber-950/60 border border-amber-850 text-amber-300"
      }`}
      title={`风险等级: ${task.riskLevel || "medium"}`}
    >
      {task.riskLevel === "low" ? "低风险" : task.riskLevel === "high" ? "高风险" : "中风险"}
    </span>
  );

  const objective = details?.task.objective;
  const acceptanceCriteria = details?.task.acceptanceCriteria;

  return (
    <div className="p-3.5 rounded-lg bg-zinc-950/80 border border-zinc-800 hover:border-violet-900/60 transition-colors space-y-3 font-mono">
      {/* Top Header Bar */}
      <div className="flex items-start justify-between gap-3 lg:grid lg:grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] lg:items-start lg:gap-x-3">
        <div className="flex flex-1 min-w-0 items-start gap-2 cursor-pointer lg:contents" onClick={() => onSelectTask(task.id)}>
          <TaskIdBadge taskId={task.id} variant="muted" className="lg:w-full" />
          <div className="min-w-0 flex-1">
            <h3 className="min-w-0 text-xs font-medium text-zinc-100 line-clamp-2 break-words hover:text-violet-300 transition-colors">
              {task.title}
            </h3>

            <div className="mt-1.5 flex items-center flex-wrap gap-2 text-[11px]">
              {riskBadge}
              {getStatusBadge()}

              {reviewerLabel && (
                <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-300">
                  <Bot className="w-2.5 h-2.5 text-violet-400" />
                  <span>审核代理: {reviewerLabel}</span>
                </span>
              )}

              {latestReview?.commitSha && (
                <span className="inline-flex items-center space-x-1 text-[10px] text-zinc-400 bg-zinc-900/80 px-1.5 py-0.5 rounded border border-zinc-850">
                  <GitCommit className="w-2.5 h-2.5 text-zinc-500" />
                  <span className="select-all" title={latestReview.commitSha}>
                    {latestReview.commitSha.slice(0, 8)}
                  </span>
                </span>
              )}

              {(latestReview?.branch || latestReview?.worktree) && (
                <span className="inline-flex items-center space-x-1 text-[10px] text-zinc-500">
                  <GitBranch className="w-2.5 h-2.5 text-zinc-600" />
                  <span>{latestReview.branch || latestReview.worktree}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-1.5 shrink-0 pt-0.5 lg:col-start-3 lg:row-start-1">
          <button
            onClick={() => {
              if (!isPassed) {
                alert("当前 AI 审核尚未通过，仅通过后可由开发者执行最终批准。");
                return;
              }
              onApprove(task.id);
            }}
            disabled={!isPassed}
            className={`inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] rounded border transition-colors ${
              isPassed
                ? "text-emerald-300 hover:text-emerald-200 bg-emerald-950/60 hover:bg-emerald-900/80 border-emerald-700/80 cursor-pointer shadow-xs font-bold"
                : "text-zinc-600 bg-zinc-900/40 border-zinc-850 cursor-not-allowed opacity-50"
            }`}
            title={isPassed ? "开发者批准并归档完成" : "需等待 AI 审核通过后方可执行最终批准"}
          >
            <Check className="w-3 h-3" />
            <span>批准</span>
          </button>

          <button
            onClick={() => {
              const feedback = window.prompt("请输入退回返工的审核反馈意见：", "");
              if (feedback?.trim()) onRequestChanges(task.id, feedback.trim());
            }}
            className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] text-amber-300 hover:text-amber-200 bg-amber-950/40 hover:bg-amber-950/80 border border-amber-900/60 rounded transition-colors"
            title="填写审核反馈并退回返工"
          >
            <MessageSquare className="w-3 h-3" />
            <span>退回返工</span>
          </button>

          <button
            onClick={() => onSelectTask(task.id)}
            className="p-1 text-zinc-500 hover:text-zinc-300 rounded transition-colors"
            title="查看任务详情与完整证据"
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Layer 1: Task Definition (Objective & Acceptance Criteria) */}
      <div className="p-2.5 rounded bg-zinc-900/40 border border-zinc-850/80 space-y-2 text-xs">
        <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center justify-between">
          <span className="flex items-center space-x-1">
            <Target className="w-3 h-3 text-cyan-400" />
            <span>原始任务定义 (Task Definition)</span>
          </span>
          <span className="text-[9px] text-zinc-600 font-normal lowercase">源自任务详情契约</span>
        </div>
        {isLoading ? (
          <div className="py-2 text-[11px] text-zinc-500 animate-pulse flex items-center space-x-2">
            <Clock className="w-3.5 h-3.5 text-zinc-500 animate-spin" />
            <span>正在加载任务权威定义...</span>
          </div>
        ) : isError || !details ? (
          <div className="py-2 text-[11px] text-rose-400 flex items-center space-x-2">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>获取任务详情失败，请检查服务连接</span>
          </div>
        ) : (
          <>
            {/* Objective */}
            <div className="text-[11px] leading-relaxed">
              <span className="text-zinc-500 font-semibold mr-1.5">核心目标:</span>
              {objective ? (
                <span className="text-zinc-300">{objective}</span>
              ) : (
                <span className="text-zinc-600 italic">未提供详细目标说明</span>
              )}
            </div>

            {/* Acceptance Criteria */}
            <div className="space-y-1">
              <div className="text-[11px] text-zinc-500 font-semibold flex items-center space-x-1">
                <ListChecks className="w-3 h-3 text-zinc-500" />
                <span>验收条件:</span>
              </div>
              {acceptanceCriteria && acceptanceCriteria.length > 0 ? (
                <div className="space-y-0.5 pl-2 border-l border-zinc-800 text-[11px]">
                  {acceptanceCriteria.map((criterion, idx) => (
                    <div key={idx} className="flex items-start space-x-1.5 text-zinc-300">
                      <span className="text-cyan-500/80 select-none shrink-0">•</span>
                      <span>{criterion}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pl-2 text-[11px] text-zinc-600 italic">未指定具体验收条件</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Layer 2: Fixed Artifact & Review Summary */}
      <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-850 space-y-2 text-xs">
        <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center justify-between">
          <span className="flex items-center space-x-1">
            <GitCommit className="w-3 h-3 text-violet-400" />
            <span>固定提交制品与审核结论</span>
          </span>
          {latestReview && (
            <span className="text-[10px] text-zinc-500">
              第 {latestReview.reviewRound} 轮审核 · {new Date(latestReview.createdAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {latestReview?.summary ? (
          <div className="text-[11px] leading-relaxed text-zinc-300 bg-zinc-950/50 p-2 rounded border border-zinc-850">
            <span className="text-zinc-500 font-semibold mr-1">审核摘要：</span>
            {latestReview.summary}
          </div>
        ) : (
          <div className="text-[11px] text-zinc-600 italic">
            {isPending ? "等待 AI 审核代理领取并出具审核结论" : "暂无审核摘要"}
          </div>
        )}

        {/* Verification Evidence List */}
        {latestReview?.verificationEvidence && latestReview.verificationEvidence.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-zinc-850/60">
            <div className="text-[10px] font-semibold text-emerald-400/90 flex items-center space-x-1">
              <Terminal className="w-3 h-3 text-emerald-400" />
              <span>验证证据 ({latestReview.verificationEvidence.length} 项)：</span>
            </div>
            <div className="space-y-1 bg-zinc-950/80 p-2 rounded border border-zinc-850/90 text-[11px]">
              {latestReview.verificationEvidence.map((ev, i) => (
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

        {/* Findings List */}
        {latestReview?.findings && latestReview.findings.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-zinc-850/60">
            <div className="text-[10px] font-semibold text-amber-400 flex items-center space-x-1">
              <ShieldAlert className="w-3 h-3 text-amber-400" />
              <span>审核发现与建议 ({latestReview.findings.length} 项)：</span>
            </div>
            <div className="space-y-1">
              {latestReview.findings.map((f, i) => (
                <div key={i} className="p-2 rounded bg-amber-950/20 border border-amber-900/40 text-[11px] space-y-0.5">
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
                  <div className="text-zinc-400 text-[10px] pl-2">建议：{f.suggestion}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const ReviewTasks: React.FC<ReviewTasksProps> = ({
  tasks,
  onApprove,
  onRequestChanges,
  onSelectTask,
}) => {
  if (tasks.length === 0) {
    return (
      <section className="rounded-lg border border-violet-900/50 bg-violet-950/15 backdrop-blur-xs overflow-hidden shrink-0">
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-violet-400" />
            <h2 className="text-xs font-mono font-bold tracking-wider text-violet-200 uppercase">
              待审核队列 (0)
            </h2>
            <span className="text-[11px] font-mono text-violet-400/80">
              · 暂无待审核任务
            </span>
          </div>
          <span className="text-[11px] font-mono text-violet-300/70 hidden sm:inline">
            所有阶段性输出已完成验收
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-violet-900/50 bg-violet-950/15 backdrop-blur-xs overflow-hidden shrink-0">
      <div className="px-4 py-2.5 border-b border-violet-900/40 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-violet-400" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-violet-200 uppercase">
            待审核队列 ({tasks.length})
          </h2>
        </div>
        <span className="text-[11px] font-mono text-violet-300/70">
          任务定义验证、AI 审核证据与开发者终审
        </span>
      </div>

      <div className="p-3 space-y-2.5">
        {tasks.map((task) => (
          <ReviewTaskItem
            key={task.id}
            task={task}
            onApprove={onApprove}
            onRequestChanges={onRequestChanges}
            onSelectTask={onSelectTask}
          />
        ))}
      </div>
    </section>
  );
};
