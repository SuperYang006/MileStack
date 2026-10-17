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
  GitBranch,
  RefreshCw,
} from "lucide-react";
import type { FindingClosureInput, TaskSummary } from "../types";
import { apiClient } from "../api/client";
import { TaskIdBadge } from "./CopyTaskIdButton";
import { EmptyState } from "./EmptyState";
import {
  FeedbackModal,
  useFeedbackDialog,
  type FeedbackClosureOption,
} from "./FeedbackModal";
import { findingsAwaitingClosure } from "../utils/reviewRecords";

interface ReviewTasksProps {
  tasks: TaskSummary[];
  onApprove: (taskId: string) => void;
  onWaiveApproval: (taskId: string, reason: string) => void;
  onRequestChanges: (
    taskId: string,
    feedback: string,
    findingClosures?: FindingClosureInput[],
  ) => void;
  onCheckIntegration: (taskId: string, reviewId: string) => void;
  checkingTaskId?: string | null;
  onSelectTask: (taskId: string) => void;
}

const ReviewTaskItem: React.FC<{
  task: TaskSummary;
  onApprove: (taskId: string) => void;
  onOpenWaive: (task: TaskSummary) => void;
  onOpenRequestChanges: (task: TaskSummary) => void;
  onCheckIntegration: (taskId: string, reviewId: string) => void;
  isCheckingIntegration: boolean;
  onSelectTask: (taskId: string) => void;
}> = ({ task, onApprove, onOpenWaive, onOpenRequestChanges, onCheckIntegration, isCheckingIntegration, onSelectTask }) => {
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
  const isAutoAccepted = task.riskLevel === "low" && task.riskConfirmed === true;
  const isAccepted = reviewStatus === "waived" || (isPassed && (isAutoAccepted || Boolean(digest?.approvedAt)));
  const needsDeveloperApproval = isPassed && !isAccepted;
  const canCheckIntegration = Boolean(
    digest && isAccepted && digest.integrationRequired && digest.integrationStatus !== "integrated",
  );

  // The review state is passive information, so it renders as plain text instead of a
  // bordered pill; the action buttons carry the visual weight on their own row.
  const getStatusLabel = () => {
    if (isPending) {
      return (
        <span className="inline-flex items-center space-x-1 text-[10px] font-mono text-zinc-400">
          <span className="text-zinc-600">·</span>
          <Clock className="w-2.5 h-2.5 text-zinc-500" />
          <span>未领取 · 等待 AI 审核</span>
        </span>
      );
    }
    if (reviewStatus === "in_progress") {
      return (
        <span className="inline-flex items-center space-x-1 text-[10px] font-mono text-cyan-300">
          <span className="text-zinc-600">·</span>
          <Bot className="w-2.5 h-2.5 text-cyan-400 animate-pulse" />
          <span>AI 审核中</span>
        </span>
      );
    }
    if (isPassed) {
      if (needsDeveloperApproval) {
        return (
          <span className="inline-flex items-center space-x-1 text-[10px] font-mono text-emerald-300 font-bold">
            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
            <span>AI 已通过 · 待开发者批准</span>
          </span>
        );
      }
      if (!digest?.integrationRequired) {
        return <span className="text-[10px] font-mono text-cyan-300">无需 Git 集成 · 待完成</span>;
      }
      if (digest?.integrationStatus === "integrated") {
        return <span className="text-[10px] font-mono text-emerald-300">本地集成已确认</span>;
      }
      if (digest?.integrationStatus === "unavailable") {
        return <span className="text-[10px] font-mono text-amber-300">已验收 · 无法检查</span>;
      }
      return (
        <span className="inline-flex items-center space-x-1 text-[10px] font-mono text-cyan-300 font-bold">
          <GitBranch className="w-2.5 h-2.5" />
          <span>已验收 · 待本地集成</span>
        </span>
      );
    }
    if (reviewStatus === "waived") {
      if (digest?.integrationStatus === "unavailable") {
        return <span className="text-[10px] font-mono text-amber-300">直接验收 · 无法检查</span>;
      }
      return <span className="text-[10px] font-mono text-violet-300">直接验收 · 待本地集成</span>;
    }
    return (
      <span className="inline-flex items-center space-x-1 text-[10px] font-mono text-amber-300">
        <span className="text-zinc-600">·</span>
        <ShieldAlert className="w-2.5 h-2.5 text-amber-400" />
        <span>要求修改</span>
      </span>
    );
  };

  const riskBadge = (
    <span
      className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-mono shrink-0 align-middle ${
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
      {/* Layer 1: identity on its own row, then the passive review state on the left and the
          review actions on the right. The card only reaches about 550px of content width in the
          two-column dashboard, so the action group wraps as a unit and stays right-aligned. */}
      <div className="flex flex-wrap items-start gap-x-2 gap-y-2">
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
          className="flex min-w-0 flex-1 basis-72 items-start gap-2 cursor-pointer"
          title="查看任务详情与事件记录"
        >
          <span className="w-[7rem] min-w-0 shrink-0">
            <TaskIdBadge taskId={task.id} variant="muted" className="w-full" />
          </span>
          <h3 className="min-w-0 flex-1 text-xs font-medium text-zinc-100 line-clamp-2 break-words hover:text-violet-300 transition-colors">
            {task.title}
          </h3>
        </div>

        <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-2">
          {getStatusLabel()}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 ml-auto">
            <button
              onClick={() => {
                if (!needsDeveloperApproval) {
                  alert("当前 AI 审核尚未通过，仅通过后可由开发者执行最终批准。");
                  return;
                }
                onApprove(task.id);
              }}
              disabled={!needsDeveloperApproval}
              className={`inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] rounded border transition-colors ${
                needsDeveloperApproval
                  ? "text-emerald-300 hover:text-emerald-200 bg-emerald-950/60 hover:bg-emerald-900/80 border-emerald-700/80 cursor-pointer shadow-xs font-bold"
                  : "text-zinc-600 bg-zinc-900/40 border-zinc-850 cursor-not-allowed opacity-50"
              }`}
              title={needsDeveloperApproval ? "记录开发者批准并继续检查本地集成" : "当前无需开发者批准"}
            >
              <Check className="w-3 h-3" />
              <span>批准</span>
            </button>

            {canCheckIntegration && digest && (
              <button
                type="button"
                onClick={() => onCheckIntegration(task.id, digest.id)}
                disabled={isCheckingIntegration}
                className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] text-cyan-200 hover:text-cyan-100 bg-cyan-950/50 hover:bg-cyan-900/70 border border-cyan-800/70 rounded transition-colors disabled:opacity-50"
                title="只读检查固定审核提交是否已进入本地目标分支"
              >
                <RefreshCw className={`w-3 h-3 ${isCheckingIntegration ? "animate-spin" : ""}`} />
                <span>{isCheckingIntegration ? "正在检查" : "检查并归档"}</span>
              </button>
            )}

            {canWaiveApproval && (
              <button
                type="button"
                onClick={() => onOpenWaive(task)}
                className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] text-violet-300 hover:text-violet-200 hover:bg-violet-950/50 border border-violet-800/70 rounded transition-colors cursor-pointer"
                title="跳过 AI 审核结论直接验收，并记录验收原因"
              >
                <ShieldCheck className="w-3 h-3" />
                <span>直接验收</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenRequestChanges(task)}
              className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] text-amber-300 hover:text-amber-200 hover:bg-amber-950/50 border border-amber-900/60 rounded transition-colors cursor-pointer"
              title="填写审核反馈并退回返工"
            >
              <MessageSquare className="w-3 h-3" />
              <span>退回返工</span>
            </button>
          </div>
        </div>
      </div>

      {/* Layer 2: risk level and low-weight review metadata on the left, detail entry on the
          right. The review summary is intentionally not shown here; it stays in the task detail modal. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        <span className="min-w-0 truncate">
          {riskBadge}
          {reviewMeta.map((item) => (
            <React.Fragment key={item.text}>
              <span className="px-1">·</span>
              <span className={item.alert ? "text-amber-400/90" : undefined}>{item.text}</span>
            </React.Fragment>
          ))}
          {digest?.integrationRequired && (
            <>
              <span className="px-1">·</span>
              <span>本地 {digest.integrationTargetBranch}</span>
              <span className="px-1">·</span>
              <span className="text-zinc-400">审核提交 {digest.commitSha.slice(0, 8)}</span>
            </>
          )}
          {digest?.integrationMessage && (
            <span className="block w-full text-amber-300/90 truncate" title={digest.integrationMessage}>
              {digest.integrationMessage}
            </span>
          )}
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
  onCheckIntegration,
  checkingTaskId = null,
  onSelectTask,
}) => {
  const { openFeedbackDialog, feedbackDialogProps } = useFeedbackDialog();

  const handleOpenWaive = (task: TaskSummary) => {
    openFeedbackDialog({
      taskId: task.id,
      taskTitle: task.title,
      title: "直接验收任务",
      description: "审核尚未通过，直接验收原因将记入任务事件。请输入验收原因：",
      theme: "violet",
      confirmLabel: "直接验收",
      placeholder: "请输入直接验收的原因与依据...",
      onSubmit: (reason) => onWaiveApproval(task.id, reason),
    });
  };

  const handleOpenRequestChanges = async (task: TaskSummary) => {
    // The closure requirement lives in the service; read the previous round so
    // the dialog can collect one status per finding instead of failing on submit.
    let closures: FeedbackClosureOption[] = [];
    try {
      const details = await apiClient.getTaskDetails(task.id);
      closures = findingsAwaitingClosure(details.reviews).map((finding, index) => ({
        key: String(index),
        label: finding.issue,
      }));
    } catch {
      // Opening the dialog without closure inputs still surfaces the service error.
    }
    openFeedbackDialog({
      taskId: task.id,
      taskTitle: task.title,
      title: "退回返工",
      description: "请输入退回返工的审核反馈意见：",
      theme: "amber",
      confirmLabel: "退回返工",
      placeholder: "请输入审核反馈意见与具体修改建议...",
      closures,
      onSubmit: (feedback, selections) =>
        onRequestChanges(
          task.id,
          feedback,
          selections.length > 0
            ? selections.map((selection) => ({
                findingIndex: Number(selection.key),
                status: selection.status,
              }))
            : undefined,
        ),
    });
  };

  // Empty and populated states share one section skeleton so the two-column grid
  // cell keeps the same flex height split instead of collapsing to a title row.
  const isEmpty = tasks.length === 0;

  return (
    <>
      <section className="rounded-lg border border-violet-900/50 bg-violet-950/15 backdrop-blur-xs overflow-hidden lg:h-full lg:min-h-0 lg:flex lg:flex-col">
      <div className="px-4 py-2.5 border-b border-violet-900/40 flex items-center justify-between gap-2 shrink-0">
        <div className="flex min-w-0 items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-violet-400 shrink-0" />
            <h2 className="text-xs font-mono font-bold tracking-wider text-violet-200 uppercase">
              待审核队列 ({tasks.length})
            </h2>
            {isEmpty && (
              <span className="text-[11px] font-mono text-violet-400/80 truncate">
                · 暂无待审核任务
              </span>
            )}
          </div>
          <span className="hidden sm:inline shrink-0 text-[11px] font-mono text-violet-300/70">
            {isEmpty ? "所有阶段性输出已完成验收" : "任务定义验证、AI 审核证据与开发者终审"}
          </span>
        </div>

        <div className="p-3 space-y-2.5 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
          {isEmpty ? (
            <EmptyState
              icon={ShieldCheck}
              title="暂无待审核任务"
              description="当前没有等待开发者终审的任务。任务提交 AI 审核结论后会出现在此处"
              tag="队列清空"
              variant="violet"
              className="lg:h-full"
            />
          ) : (
            tasks.map((task) => (
              <ReviewTaskItem
                key={task.id}
                task={task}
                onApprove={onApprove}
                onOpenWaive={handleOpenWaive}
      onOpenRequestChanges={handleOpenRequestChanges}
      onCheckIntegration={onCheckIntegration}
      isCheckingIntegration={checkingTaskId === task.id}
      onSelectTask={onSelectTask}
              />
            ))
          )}
        </div>
      </section>

      {/* The section above establishes a backdrop-filter containing block and clips its
          overflow, so this fixed dialog must be mounted as a sibling of the section to
          stay a page-level overlay. */}
      <FeedbackModal {...feedbackDialogProps} />
    </>
  );
};
