import React, { useState } from "react";
import { X, Plus, Terminal, ListPlus } from "lucide-react";
import type { CreateTaskPayload } from "../types";

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateTaskPayload) => Promise<void>;
  onBatchSubmit?: (payloads: CreateTaskPayload[]) => Promise<void>;
}

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  onBatchSubmit,
}) => {
  const [tab, setTab] = useState<"single" | "batch">("single");
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [criteriaText, setCriteriaText] = useState("");
  const [status, setStatus] = useState<"inbox" | "ready">("inbox");
  const [batchText, setBatchText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  // Parse batch markdown lines into cleaned titles
  const parsedBatchTasks = batchText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      // strip markdown list markers like '- [ ]', '- [x]', '-', '*', '1.'
      return line.replace(/^([*\-](\s*\[[ xX]\])?|\d+\.)\s*/, "").trim();
    })
    .filter((t) => t.length > 0);

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const acceptanceCriteria = criteriaText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    setIsSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        objective: objective.trim() || undefined,
        acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
        status,
      });
      setTitle("");
      setObjective("");
      setCriteriaText("");
      setStatus("inbox");
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedBatchTasks.length === 0) return;

    const payloads: CreateTaskPayload[] = parsedBatchTasks.map((t) => ({
      title: t,
      status: "inbox", // batch always imports into inbox per spec
    }));

    setIsSubmitting(true);
    try {
      if (onBatchSubmit) {
        await onBatchSubmit(payloads);
      } else {
        for (const p of payloads) {
          await onSubmit(p);
        }
      }
      setBatchText("");
      setTab("single");
      onClose();
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
            <Terminal className="w-4 h-4 text-cyan-400" />
            <h2 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
              录入任务
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-zinc-800/80 bg-zinc-900/40 text-[11px]">
          <button
            type="button"
            onClick={() => setTab("single")}
            className={`flex-1 py-2 text-center transition-colors ${
              tab === "single"
                ? "text-cyan-400 border-b-2 border-cyan-400 bg-zinc-900/60 font-semibold"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            [单条录入]
          </button>
          <button
            type="button"
            onClick={() => setTab("batch")}
            className={`flex-1 py-2 text-center transition-colors flex items-center justify-center space-x-1.5 ${
              tab === "batch"
                ? "text-cyan-400 border-b-2 border-cyan-400 bg-zinc-900/60 font-semibold"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <ListPlus className="w-3.5 h-3.5" />
            <span>[Markdown 批量导入]</span>
          </button>
        </div>

        {/* Single Task Form */}
        {tab === "single" ? (
          <form onSubmit={handleSingleSubmit} className="p-5 space-y-4 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                任务标题 <span className="text-cyan-400">*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：实现 Fastify HTTP API 路由与适配器"
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 placeholder:text-zinc-600 focus:outline-hidden focus:border-cyan-500/80 transition-colors"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                目标说明 (可选)
              </label>
              <textarea
                rows={2}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="详细背景、核心设计约束与实施目标"
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 placeholder:text-zinc-600 focus:outline-hidden focus:border-cyan-500/80 transition-colors"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                验收条件 (每行一条，可选)
              </label>
              <textarea
                rows={3}
                value={criteriaText}
                onChange={(e) => setCriteriaText(e.target.value)}
                placeholder="- 命令执行退出码为 0&#10;- 新增状态流转回归测试并通过"
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 placeholder:text-zinc-600 focus:outline-hidden focus:border-cyan-500/80 transition-colors"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                初始队列
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label
                  className={`flex items-center space-x-2 p-2 rounded border cursor-pointer transition-colors ${
                    status === "inbox"
                      ? "border-amber-600/60 bg-amber-950/30 text-amber-300"
                      : "border-zinc-850 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="status"
                    value="inbox"
                    checked={status === "inbox"}
                    onChange={() => setStatus("inbox")}
                    className="accent-amber-500"
                  />
                  <span className="text-[11px]">收件箱 (Inbox 待整理)</span>
                </label>

                <label
                  className={`flex items-center space-x-2 p-2 rounded border cursor-pointer transition-colors ${
                    status === "ready"
                      ? "border-cyan-600/60 bg-cyan-950/30 text-cyan-300"
                      : "border-zinc-850 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="status"
                    value="ready"
                    checked={status === "ready"}
                    onChange={() => setStatus("ready")}
                    className="accent-cyan-500"
                  />
                  <span className="text-[11px]">就绪队列 (Ready)</span>
                </label>
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-850 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 rounded transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !title.trim()}
                className="inline-flex items-center space-x-1.5 px-3 py-1 text-xs font-semibold text-zinc-950 bg-zinc-100 hover:bg-white rounded transition-colors disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isSubmitting ? "创建中..." : "创建任务"}</span>
              </button>
            </div>
          </form>
        ) : (
          /* Batch Markdown Import Form */
          <form onSubmit={handleBatchSubmit} className="p-5 space-y-4 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                粘贴 Markdown 列表 (自动解析每行)
              </label>
              <textarea
                rows={7}
                required
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                placeholder={`- 实现 Fastify 本地 JSON API 路由\n- 增加 SQLite 迁移断电测试\n* 完善 CLI status 终端着色\n1. 补充 MCP 协议单元测试`}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 placeholder:text-zinc-600 focus:outline-hidden focus:border-cyan-500/80 transition-colors font-mono leading-relaxed"
              />
            </div>

            {/* Preview Box */}
            <div className="p-3 bg-zinc-900/60 rounded border border-zinc-850 text-[11px]">
              <div className="flex items-center justify-between text-zinc-400 mb-1.5">
                <span>解析结果：</span>
                <span className="text-cyan-400 font-bold">
                  {parsedBatchTasks.length} 项有效任务
                </span>
              </div>
              {parsedBatchTasks.length > 0 ? (
                <div className="max-h-28 overflow-y-auto space-y-1 text-zinc-300 pt-1">
                  {parsedBatchTasks.slice(0, 5).map((item, idx) => (
                    <div key={idx} className="truncate text-zinc-300">
                      <span className="text-zinc-600 mr-1.5">{idx + 1}.</span>
                      {item}
                    </div>
                  ))}
                  {parsedBatchTasks.length > 5 && (
                    <div className="text-zinc-500 italic">
                      ... 等共 {parsedBatchTasks.length} 条任务
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-zinc-600 italic">
                  支持 - 或 * 或 1. 列表，每行自动解析为一条待整理收件箱任务
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-zinc-850 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 rounded transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSubmitting || parsedBatchTasks.length === 0}
                className="inline-flex items-center space-x-1.5 px-3 py-1 text-xs font-semibold text-zinc-950 bg-cyan-400 hover:bg-cyan-300 rounded transition-colors disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>
                  {isSubmitting
                    ? "导入中..."
                    : `批量导入 (${parsedBatchTasks.length}) 到收件箱`}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
