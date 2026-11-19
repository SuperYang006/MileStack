import React, { useLayoutEffect, useRef, useState, useEffect } from "react";
import { X, Edit3, Terminal, CheckCircle2, Link2, AlertCircle } from "lucide-react";
import type {
  AcceptanceCriterion,
  TaskSummary,
  EditInboxTaskPayload,
  TaskDetails,
  TaskStatus,
  RiskLevel,
} from "../types";
import { CopyTaskIdButton } from "./CopyTaskIdButton";
import { apiClient } from "../api/client";
import {
  acceptanceCriteriaPreSubmissionReminder,
  reconcileCriteriaLines,
} from "../utils/acceptanceCriteria";
import {
  filterDependencyCandidates,
  parseDependencyIds,
  shortTaskId,
} from "../utils/dependencyPicker";

const MIN_TEXTAREA_ROWS = 3;
const MAX_TEXTAREA_ROWS = 12;
const MAX_DEPENDENCY_CANDIDATES = 8;

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: "草稿",
  ready: "就绪",
  running: "执行中",
  blocked: "阻塞",
  in_review: "待审核",
  completed: "已完成",
};

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
  const [dependencyIds, setDependencyIds] = useState<string[]>([]);
  const [dependencyQuery, setDependencyQuery] = useState("");
  const [isDependencyPickerOpen, setIsDependencyPickerOpen] = useState(false);
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("medium");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectiveRef = useRef<HTMLTextAreaElement>(null);
  const criteriaRef = useRef<HTMLTextAreaElement>(null);
  const dependencyInputRef = useRef<HTMLInputElement>(null);

  const taskId = task ? ("task" in task ? task.task.id : task.id) : "";

  const tasksById = new Map(availableTasks.map((availableTask) => [availableTask.id, availableTask]));
  const dependencyCandidates = filterDependencyCandidates(availableTasks, {
    currentTaskId: taskId,
    selectedIds: dependencyIds,
    query: dependencyQuery,
    limit: MAX_DEPENDENCY_CANDIDATES,
  });

  const addDependencyIds = (ids: string[]) => {
    setDependencyIds((current) => {
      const next = [...current];
      for (const id of ids) {
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
    setDependencyQuery("");
    setIsDependencyPickerOpen(false);
  };

  const removeDependencyId = (id: string) => {
    setDependencyIds((current) => current.filter((currentId) => currentId !== id));
  };

  const handleDependencyPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedIds = parseDependencyIds(event.clipboardData.getData("text"));
    if (pastedIds.length === 0 || pastedIds.some((id) => /\s/.test(id))) return;
    event.preventDefault();
    addDependencyIds(pastedIds);
  };

  const handleDependencyKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const [firstCandidate] = dependencyCandidates;
      if (dependencyQuery.trim().length > 0 && firstCandidate) {
        addDependencyIds([firstCandidate.id]);
        return;
      }
      const typedIds = parseDependencyIds(dependencyQuery);
      if (typedIds.length > 0 && typedIds.every((id) => !/\s/.test(id))) {
        addDependencyIds(typedIds);
      }
      return;
    }
    if (
      event.key === "Backspace" &&
      dependencyQuery.length === 0 &&
      dependencyIds.length > 0
    ) {
      const lastId = dependencyIds[dependencyIds.length - 1];
      if (lastId) removeDependencyId(lastId);
      return;
    }
    if (event.key === "Escape") {
      setIsDependencyPickerOpen(false);
    }
  };

  useEffect(() => {
    if (!task || !isOpen) return;
    const currentTaskId = "task" in task ? task.task.id : task.id;
    setError(null);
    setDependencyQuery("");
    setIsDependencyPickerOpen(false);
    if ("task" in task) {
      setTitle(task.task.title || "");
      setObjective(task.task.objective || "");
      setInitialCriteria(task.task.acceptanceCriteria ?? []);
      setCriteriaText(
        task.task.acceptanceCriteria?.map((criterion) => criterion.text).join("\n") || "",
      );
      setDependencyIds(task.task.dependencyIds ?? []);
      setRiskLevel(task.task.riskLevel || "medium");
    } else {
      setTitle(task.title || "");
      setRiskLevel(task.riskLevel || "medium");
      setDependencyIds(task.dependencyIds ?? []);
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
            setDependencyIds(details.task.dependencyIds ?? []);
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
              编辑草稿
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
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-cyan-500 transition-colors"
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
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-cyan-500 transition-colors resize-none leading-relaxed"
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
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-cyan-500 transition-colors resize-none leading-relaxed font-mono"
              />
              <p className="mt-1 text-[10px] text-zinc-500 leading-relaxed">
                {acceptanceCriteriaPreSubmissionReminder}
              </p>
            </div>

            {/* Dependencies */}
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1 flex items-center justify-between">
                <span>
                  前置依赖任务
                  {dependencyIds.length > 0 && (
                    <span className="ml-1 text-zinc-500 font-normal">
                      (已选 {dependencyIds.length})
                    </span>
                  )}
                </span>
                <Link2 className="w-3.5 h-3.5 text-zinc-500" />
              </label>
              <div className="rounded bg-zinc-900 border border-zinc-800 p-2 space-y-2">
                {dependencyIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {dependencyIds.map((dependencyId) => {
                      const dependencyTask = tasksById.get(dependencyId);
                      return (
                        <span
                          key={dependencyId}
                          className="inline-flex max-w-full items-center gap-1 rounded border border-zinc-700 bg-zinc-800/80 px-1.5 py-0.5 text-[11px]"
                          title={dependencyTask ? `${dependencyTask.id} ${dependencyTask.title}` : dependencyId}
                        >
                          <span className="font-mono text-cyan-300">
                            #{shortTaskId(dependencyId)}
                          </span>
                          <span className="truncate text-zinc-200 max-w-48">
                            {dependencyTask?.title ?? "未知任务"}
                          </span>
                          <span className="shrink-0 text-zinc-500">
                            {dependencyTask
                              ? TASK_STATUS_LABELS[dependencyTask.status]
                              : "未找到"}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeDependencyId(dependencyId)}
                            aria-label={`移除依赖 ${dependencyTask?.title ?? dependencyId}`}
                            className="shrink-0 rounded p-0.5 text-zinc-500 hover:text-rose-300 hover:bg-zinc-700/60 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}

                <div
                  className="relative"
                  onBlur={(event) => {
                    if (
                      event.relatedTarget instanceof Node &&
                      event.currentTarget.contains(event.relatedTarget)
                    ) {
                      return;
                    }
                    setIsDependencyPickerOpen(false);
                  }}
                >
                  <input
                    ref={dependencyInputRef}
                    type="text"
                    role="combobox"
                    aria-expanded={isDependencyPickerOpen}
                    aria-controls="dependency-picker-options"
                    aria-autocomplete="list"
                    value={dependencyQuery}
                    onChange={(event) => {
                      setDependencyQuery(event.target.value);
                      setIsDependencyPickerOpen(true);
                    }}
                    onFocus={() => setIsDependencyPickerOpen(true)}
                    onPaste={handleDependencyPaste}
                    onKeyDown={handleDependencyKeyDown}
                    placeholder="搜索标题或 8 位短 ID，或粘贴完整任务 ID"
                    className="w-full px-3 py-2 bg-zinc-950/60 border border-zinc-800 rounded text-zinc-100 placeholder-zinc-600 focus:outline-hidden focus:border-cyan-500 transition-colors"
                  />
                  {isDependencyPickerOpen && (
                    <div
                      id="dependency-picker-options"
                      role="listbox"
                      className="absolute top-full left-0 right-0 z-10 mt-1 max-h-56 overflow-y-auto rounded border border-zinc-700 bg-zinc-950 shadow-xl"
                    >
                      {dependencyCandidates.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] text-zinc-500">
                          {dependencyQuery.trim().length > 0
                            ? "没有匹配的任务；按回车仍可将输入作为任务 ID 添加。"
                            : "没有可添加的任务"}
                        </p>
                      ) : (
                        dependencyCandidates.map((candidate) => (
                          <button
                            key={candidate.id}
                            type="button"
                            role="option"
                            aria-selected={false}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              addDependencyIds([candidate.id]);
                              dependencyInputRef.current?.focus();
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-zinc-800/80 transition-colors"
                          >
                            <span className="shrink-0 font-mono text-cyan-300">
                              #{shortTaskId(candidate.id)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-zinc-200">
                              {candidate.title}
                            </span>
                            <span className="shrink-0 text-zinc-500">
                              {TASK_STATUS_LABELS[candidate.status]}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-1 text-[10px] text-zinc-500 leading-relaxed">
                点击列表项添加依赖；也可粘贴逗号或换行分隔的任务 ID。保存时仍由服务端校验。
              </p>
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
                      : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
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
                      : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
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
                      : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
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
                className="px-3 py-1.5 text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded transition-colors"
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
