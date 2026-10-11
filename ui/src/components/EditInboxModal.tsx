import React, { useState, useEffect } from "react";
import { X, Edit3, Terminal, CheckCircle2, Link2, AlertCircle } from "lucide-react";
import type { TaskSummary, EditInboxTaskPayload, TaskDetails } from "../types";
import { CopyTaskIdButton } from "./CopyTaskIdButton";
import { apiClient } from "../api/client";

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
  const [dependencyIdsText, setDependencyIdsText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taskId = task ? ("task" in task ? task.task.id : task.id) : "";

  useEffect(() => {
    if (!task || !isOpen) return;
    const currentTaskId = "task" in task ? task.task.id : task.id;
    setError(null);
    if ("task" in task) {
      setTitle(task.task.title || "");
      setObjective(task.task.objective || "");
      setCriteriaText(task.task.acceptanceCriteria?.join("\n") || "");
      setDependencyIdsText(task.task.dependencyIds?.join(", ") || "");
    } else {
      setTitle(task.title || "");
      setDependencyIdsText(task.dependencyIds?.join(", ") || "");
      let cancelled = false;
      apiClient
        .getTaskDetails(currentTaskId)
        .then((details) => {
          if (!cancelled && details) {
            setTitle(details.task.title || "");
            setObjective(details.task.objective || "");
            setCriteriaText(details.task.acceptanceCriteria?.join("\n") || "");
            setDependencyIdsText(details.task.dependencyIds?.join(", ") || "");
          }
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
  }, [task, isOpen]);

  if (!isOpen || !task) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("任务标题不能为空");
      return;
    }

    const acceptanceCriteria = criteriaText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

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
      <div className="bg-zinc-950 rounded-lg border border-zinc-800 max-w-lg w-full overflow-hidden shadow-2xl font-mono">
        {/* Header */}
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
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
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
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
              rows={3}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
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
              rows={3}
              value={criteriaText}
              onChange={(e) => setCriteriaText(e.target.value)}
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

          {/* Footer Controls */}
          <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
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
