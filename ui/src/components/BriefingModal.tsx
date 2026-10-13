import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Copy, Check, Terminal, ShieldAlert, Clock } from "lucide-react";
import { apiClient } from "../api/client";
import type { TaskSummary, ProjectSummary, TaskDetails } from "../types";
import { formatTaskBriefing } from "../utils/taskBriefing";

interface BriefingModalProps {
  task: TaskSummary | null;
  project: ProjectSummary;
  isOpen: boolean;
  onClose: () => void;
}

export const BriefingModal: React.FC<BriefingModalProps> = ({
  task,
  project,
  isOpen,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  const { data: details, isLoading, isError } = useQuery<TaskDetails>({
    queryKey: ["taskDetails", task?.id],
    queryFn: () => (task?.id ? apiClient.getTaskDetails(task.id) : Promise.reject(new Error("No task id"))),
    enabled: isOpen && !!task?.id,
  });

  if (!isOpen || !task) return null;

  const briefingText = details
    ? formatTaskBriefing({ project, task, details })
    : "";

  const handleCopy = async () => {
    if (isLoading || isError || !details) return;
    try {
      await navigator.clipboard.writeText(briefingText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-zinc-950 rounded-lg border border-zinc-800 max-w-xl w-full flex flex-col max-h-[85vh] overflow-hidden shadow-2xl font-mono">
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Terminal className="w-4 h-4 text-cyan-400" />
            <h2 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
              任务简报生成器
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 text-xs">
          {isLoading ? (
            <div className="py-12 text-center text-zinc-500 flex flex-col items-center justify-center space-y-2">
              <Clock className="w-5 h-5 text-zinc-500 animate-spin" />
              <span>正在获取权威任务定义（目标与验收条件）...</span>
            </div>
          ) : isError || !details ? (
            <div className="py-12 text-center text-rose-400 flex flex-col items-center justify-center space-y-2">
              <ShieldAlert className="w-5 h-5 text-rose-400" />
              <span>获取权威任务详情失败，请检查服务连接并重试</span>
            </div>
          ) : (
            <>
              <div className="text-[11px] text-zinc-500 mb-2">
                可直接将以下包含完整任务目标与验收条件的简报复制粘贴给 AI 编程助手：
              </div>
              <pre className="p-3.5 bg-zinc-900/90 border border-zinc-850 text-zinc-200 rounded text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed selection:bg-cyan-500/30">
                {briefingText}
              </pre>
            </>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
          <span className="text-[10px] text-zinc-600">MILESTACK_PROTOCOL_V0</span>
          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 rounded transition-colors"
            >
              关闭
            </button>
            <button
              onClick={handleCopy}
              disabled={isLoading || isError || !details}
              className={`inline-flex items-center space-x-1.5 px-3 py-1 text-xs font-semibold rounded transition-colors ${
                isLoading || isError || !details
                  ? "bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-50"
                  : copied
                  ? "bg-emerald-500 text-zinc-950"
                  : "bg-zinc-100 hover:bg-white text-zinc-950 shadow-xs cursor-pointer"
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>已复制到剪贴板</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>一键复制简报</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
