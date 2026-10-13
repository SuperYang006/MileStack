import React from "react";
import {
  Check,
  MessageSquare,
  ArrowUpRight,
  CheckCircle2,
  ShieldAlert,
  Bot,
  Clock,
  ShieldCheck,
} from "lucide-react";
import type { TaskSummary } from "../types";
import { TaskIdBadge } from "./CopyTaskIdButton";

interface ReviewTasksProps {
  tasks: TaskSummary[];
  onApprove: (taskId: string) => void;
  onWaiveApproval: (taskId: string, reason: string) => void;
  onRequestChanges: (taskId: string, feedback: string) => void;
  onSelectTask: (taskId: string) => void;
}

const ReviewTaskItem: React.FC<{
  task: TaskSummary;
  onApprove: (taskId: string) => void;
  onWaiveApproval: (taskId: string, reason: string) => void;
  onRequestChanges: (taskId: string, feedback: string) => void;
  onSelectTask: (taskId: string) => void;
}> = ({ task, onApprove, onWaiveApproval, onRequestChanges, onSelectTask }) => {
  const digest = task.latestReview;
  const reviewStatus = digest?.status ?? "pending";

  // Review states:
  // 1. pending: 未领取 (等待 AI 审核)
  // 2. in_progress: AI 审核中
  // 3. passed: AI 已通过 · 等待开发者人工批准
  // 4. changes_requested: AI 退回返工
  const isPassed = reviewStatus === "passed";
  const isPending = !digest || reviewStatus === "pending";
  const canWaiveApproval = reviewStatus === "pending" || reviewStatus === "in_progress";

  const getStatusBadge = () => {
    if (isPending) {
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-900 border border-zinc-750 text-zinc-400">
          <Clock className="w-2.5 h-2.5 text-zinc-400" />
          <span>未领取 · 等待 AI 审核</span>
        </span>
      );
    }
    if (reviewStatus === "in_progress") {
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

  const findingsCount = digest?.findingsCount ?? 0;
  const reviewMeta = digest
    ? [
        { text: `第 ${digest.reviewRound} 轮`, alert: false },
        { text: `验收 ${digest.acceptanceCriteriaCount}`, alert: false },
        { text: `证据 ${digest.verificationEvidenceCount}`, alert: false },
        { text: `发现 ${findingsCount}`, alert: findingsCount > 0 },
      ]
    : [];

  return (
    <div className="p-3.5 rounded-lg bg-zinc-950/80 border border-zinc-800 hover:border-violet-900/60 transition-colors space-y-2 font-mono">
      {/* Layer 1: identity, review state, risk, and review actions. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 lg:grid lg:grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] lg:gap-y-0">
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelectTask(task.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectTask(task.id);
            }
          }}
          className="flex w-full min-w-0 items-start gap-2 cursor-pointer lg:contents"
          title="查看任务详情与事件记录"
        >
          <span className="w-[7rem] min-w-0 shrink-0">
            <TaskIdBadge taskId={task.id} variant="muted" className="w-full" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h3 className="min-w-0 text-xs font-medium text-zinc-100 line-clamp-2 break-words hover:text-violet-300 transition-colors">
              {task.title}
            </h3>

            <div className="flex flex-wrap items-center gap-1.5">
              {getStatusBadge()}
              {riskBadge}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0 lg:col-start-3 lg:row-start-1">
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

          {canWaiveApproval && (
            <button
              onClick={() => {
                const reason = window.prompt(
                  "请输入直接验收该任务的原因（审核尚未通过，验收原因将记入任务事件）：",
                  "",
                );
                if (reason?.trim()) onWaiveApproval(task.id, reason.trim());
              }}
              className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] text-violet-300 hover:text-violet-200 bg-violet-950/40 hover:bg-violet-900/80 border border-violet-800/70 rounded transition-colors"
              title="跳过 AI 审核结论直接验收，并记录验收原因"
            >
              <ShieldCheck className="w-3 h-3" />
              <span>直接验收</span>
            </button>
          )}

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
        </div>
      </div>

      {/* Layer 2: review summary only. Full text stays in the task detail modal. */}
      {digest?.summary ? (
        <div className="text-[11px] leading-relaxed text-zinc-300 bg-zinc-950/50 p-2 rounded border border-zinc-850 line-clamp-2">
          <span className="text-zinc-500 font-semibold mr-1">审核摘要：</span>
          {digest.summary}
        </div>
      ) : (
        <div className="text-[11px] text-zinc-600 italic">
          {isPending ? "等待 AI 审核代理领取并出具审核结论" : "暂无审核摘要"}
        </div>
      )}

      {/* Layer 3: low-weight review metadata on the left, detail entry on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        <span className="min-w-0 truncate">
          {reviewMeta.map((item, index) => (
            <React.Fragment key={item.text}>
              {index > 0 && <span className="px-1">·</span>}
              <span className={item.alert ? "text-amber-400/90" : undefined}>{item.text}</span>
            </React.Fragment>
          ))}
        </span>

        <button
          onClick={() => onSelectTask(task.id)}
          className="inline-flex shrink-0 items-center gap-1 text-zinc-500 hover:text-zinc-300 transition-colors"
          title="查看任务详情与完整证据"
        >
          <span>查看详情</span>
          <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

export const ReviewTasks: React.FC<ReviewTasksProps> = ({
  tasks,
  onApprove,
  onWaiveApproval,
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
    <section className="rounded-lg border border-violet-900/50 bg-violet-950/15 backdrop-blur-xs overflow-hidden lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
      <div className="px-4 py-2.5 border-b border-violet-900/40 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-violet-400" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-violet-200 uppercase">
            待审核队列 ({tasks.length})
          </h2>
        </div>
        <span className="text-[11px] font-mono text-violet-300/70 hidden sm:inline">
          任务定义验证、AI 审核证据与开发者终审
        </span>
      </div>

      <div className="p-3 space-y-2.5 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
        {tasks.map((task) => (
          <ReviewTaskItem
            key={task.id}
            task={task}
            onApprove={onApprove}
            onWaiveApproval={onWaiveApproval}
            onRequestChanges={onRequestChanges}
            onSelectTask={onSelectTask}
          />
        ))}
      </div>
    </section>
  );
};