import React, { useLayoutEffect, useRef, useState, useEffect } from "react";
import { X, Edit3, Terminal, CheckCircle2, Link2, AlertCircle } from "lucide-react";
import type {
  AcceptanceCriterion,
  TaskSummary,
  EditInboxTaskPayload,
  TaskDetails,
  RiskLevel,
} from "../types";
import { CopyTaskIdButton } from "./CopyTaskIdButton";
import { apiClient } from "../api/client";
import { reconcileCriteriaLines } from "../utils/acceptanceCriteria";

const MIN_TEXTAREA_ROWS = 3;
const MAX_TEXTAREA_ROWS = 12;

function resizeLongTextArea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  textarea.style.overflowY = "hidden";

  const styles = window.getComputedStyle(textarea);
  const lineHeight =
    Number.parseFloat(styles.lineHeight) ||
    Number.parseFloat(styles.fontSize) * 1.5 ||
    16;
  const paddingHeight =
    Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
  const borderHeight =
    Number.parseFloat(styles.borderTopWidth) + Number.parseFloat(styles.borderBottomWidth);
  const minHeight = lineHeight * MIN_TEXTAREA_ROWS + paddingHeight + borderHeight;
  const maxHeight = lineHeight * MAX_TEXTAREA_ROWS + paddingHeight + borderHeight;
  const contentHeight = textarea.scrollHeight + borderHeight;
  const nextHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);

  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
}

interface EditInboxModalProps {
  task: TaskSummary | TaskDetails | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (taskId: string, payload: EditInboxTaskPayload) => Promise<void>;
  availableTasks?: TaskSummary[];
}

export const EditInboxModal: React.FC<EditInboxModalProps> = ({
  task,
  isOpen,
  onClose,
  onSubmit,
  availableTasks = [],
}) => {
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [criteriaText, setCriteriaText] = useState("");
  const [initialCriteria, setInitialCriteria] = useState<AcceptanceCriterion[]>([]);
  const [dependencyIdsText, setDependencyIdsText] = useState("");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("medium");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectiveRef = useRef<HTMLTextAreaElement>(null);
  const criteriaRef = useRef<HTMLTextAreaElement>(null);

  const taskId = task ? ("task" in task ? task.task.id : task.id) : "";

  useEffect(() => {
    if (!task || !isOpen) return;
    const currentTaskId = "task" in task ? task.task.id : task.id;
    setError(null);
    if ("task" in task) {
      setTitle(task.task.title || "");
      setObjective(task.task.objective || "");
      setInitialCriteria(task.task.acceptanceCriteria ?? []);
      setCriteriaText(
        task.task.acceptanceCriteria?.map((criterion) => criterion.text).join("\n") || "",
      );
      setDependencyIdsText(task.task.dependencyIds?.join(", ") || "");
      setRiskLevel(task.task.riskLevel || "medium");
    } else {
      setTitle(task.title || "");
      setRiskLevel(task.riskLevel || "medium");
      setDependencyIdsText(task.dependencyIds?.join(", ") || "");
      let cancelled = false;
      apiClient
        .getTaskDetails(currentTaskId)
        .then((details) => {
          if (!cancelled && details) {
            setTitle(details.task.title || "");
            setObjective(details.task.objective || "");
            setInitialCriteria(details.task.acceptanceCriteria ?? []);
            setCriteriaText(
              details.task.acceptanceCriteria
                ?.map((criterion) => criterion.text)
                .join("\n") || "",
            );
            setDependencyIdsText(details.task.dependencyIds?.join(", ") || "");
            setRiskLevel(details.task.riskLevel || "medium");
          }
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
  }, [task, isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    if (objectiveRef.current) resizeLongTextArea(objectiveRef.current);
    if (criteriaRef.current) resizeLongTextArea(criteriaRef.current);
  }, [isOpen, objective, criteriaText]);

  if (!isOpen || !task) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("任务标题不能为空");
      return;
    }

    const criteriaLines = criteriaText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const acceptanceCriteria = reconcileCriteriaLines(
      initialCriteria,
      criteriaLines,
    );

    const dependencyIds = dependencyIdsText
      .split(/[\n,]/)
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(taskId, {
        title: title.trim(),
        objective: objective.trim() || null,
        acceptanceCriteria,
        dependencyIds,
        riskLevel,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || "保存失败，请检查输入或依赖关系");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-zinc-950 rounded-lg border border-zinc-800 max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl font-mono">
        {/* Header */}
        <div className="shrink-0 px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Edit3 className="w-4 h-4 text-amber-400" />
            <h2 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
              编辑 Inbox 任务草稿
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col text-xs">
          <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
            {error && (
              <div className="p-2.5 rounded bg-rose-950/50 border border-rose-800 text-rose-300 text-[11px] flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Task ID (Read-only + Copy) */}
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1 flex items-center justify-between">
                <span>任务 ID (不可变更)</span>
                <span className="text-zinc-500 font-normal">点击复制</span>
              </label>
              <div className="flex items-center justify-between px-3 py-1.5 rounded bg-zinc-900/80 border border-zinc-800 text-zinc-400">
                <span className="truncate">{taskId}</span>
                <CopyTaskIdButton taskId={taskId} className="ml-2" />
              </div>
            </div>

            {/* Title */}
            <div>
              <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
                任务标题 <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="简要概括任务目标..."
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-750 rounded text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-cyan-500 transition-colors"
              />
            </div>

            {/* Objective */}
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                核心目标 (Objective)
              </label>
              <textarea
                ref={objectiveRef}
                rows={MIN_TEXTAREA_ROWS}
                value={objective}
                onChange={(e) => {
                  setObjective(e.target.value);
                  resizeLongTextArea(e.currentTarget);
                }}
                placeholder="详细描述该任务希望达成的状态或背景..."
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-750 rounded text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-cyan-500 transition-colors resize-none leading-relaxed"
              />
            </div>

            {/* Acceptance Criteria */}
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1 flex items-center justify-between">
                <span>验收条件 (每行一条)</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-zinc-500" />
              </label>
              <textarea
                ref={criteriaRef}
                rows={MIN_TEXTAREA_ROWS}
                value={criteriaText}
                onChange={(e) => {
                  setCriteriaText(e.target.value);
                  resizeLongTextArea(e.currentTarget);
                }}
                placeholder="- 代码通过类型检查与单元测试&#10;- 完成功能验收..."
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-750 rounded text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-cyan-500 transition-colors resize-none leading-relaxed font-mono"
              />
            </div>

            {/* Dependencies */}
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1 flex items-center justify-between">
                <span>前置依赖任务 ID (逗号或换行分隔)</span>
                <Link2 className="w-3.5 h-3.5 text-zinc-500" />
              </label>
              <input
                type="text"
                value={dependencyIdsText}
                onChange={(e) => setDependencyIdsText(e.target.value)}
                placeholder="task-001, task-002..."
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-750 rounded text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-cyan-500 transition-colors"
              />
            </div>

            {/* Risk Level */}
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                风险等级 (当前：{riskLevel.toUpperCase()})
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label
                  className={`flex flex-col p-2 rounded border cursor-pointer transition-colors ${
                    riskLevel === "low"
                      ? "border-emerald-600/70 bg-emerald-950/30 text-emerald-300"
                      : "border-zinc-850 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <div className="flex items-center space-x-1.5 mb-1">
                    <input
                      type="radio"
                      name="inboxRiskLevel"
                      value="low"
                      checked={riskLevel === "low"}
                      onChange={() => setRiskLevel("low")}
                      className="accent-emerald-500"
                    />
                    <span className="font-bold text-[11px]">低风险 (Low)</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 leading-tight">
                    AI 审核通过后自动完成
                  </span>
                </label>

                <label
                  className={`flex flex-col p-2 rounded border cursor-pointer transition-colors ${
                    riskLevel === "medium"
                      ? "border-amber-600/70 bg-amber-950/30 text-amber-300"
                      : "border-zinc-850 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <div className="flex items-center space-x-1.5 mb-1">
                    <input
                      type="radio"
                      name="inboxRiskLevel"
                      value="medium"
                      checked={riskLevel === "medium"}
                      onChange={() => setRiskLevel("medium")}
                      className="accent-amber-500"
                    />
                    <span className="font-bold text-[11px]">中风险 (Medium)</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 leading-tight">
                    默认等级，需开发者终审
                  </span>
                </label>

                <label
                  className={`flex flex-col p-2 rounded border cursor-pointer transition-colors ${
                    riskLevel === "high"
                      ? "border-rose-600/70 bg-rose-950/30 text-rose-300"
                      : "border-zinc-850 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <div className="flex items-center space-x-1.5 mb-1">
                    <input
                      type="radio"
                      name="inboxRiskLevel"
                      value="high"
                      checked={riskLevel === "high"}
                      onChange={() => setRiskLevel("high")}
                      className="accent-rose-500"
                    />
                    <span className="font-bold text-[11px]">高风险 (High)</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 leading-tight">
                    破坏性/敏感变更，需人工终审
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Footer Controls */}
          <div className="shrink-0 px-5 pt-3 pb-5 border-t border-zinc-800 flex items-center justify-between">
            <span className="text-[10px] text-zinc-600">保存不影响队列排位</span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-3 py-1.5 text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 rounded transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded transition-colors shadow-xs disabled:opacity-50"
              >
                {isSubmitting ? "保存中..." : "保存修改"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
