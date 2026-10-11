import React, { useState } from "react";
import { X, Copy, Check, Terminal } from "lucide-react";
import { formatKnownTaskBriefInstructions } from "../../../src/core/agent-instructions.js";
import type { TaskSummary, ProjectSummary } from "../types";

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

  if (!isOpen || !task) return null;

  const waitingDeps = task.waitingFor.map((w) => `- ${w.title} (${w.status})`).join("\n");

  const briefingText = `# MileStack 任务简报

## 1. 项目概览
- **项目名称**: ${project.name}
 - **项目目标**: ${project.goal || "纵览项目全局，推进每个里程碑。"}

## 2. 目标任务
- **Task ID**: \`${task.id}\`
- **任务标题**: ${task.title}
- **当前状态**: \`${task.status}\` (队列序号: #${task.queuePosition || 1})
- **可执行性**: ${task.runnable ? "就绪可立即执行 (无未完成前置依赖)" : "等待前置依赖"}
${
  task.waitingFor.length > 0
    ? `\n### 尚未完成的前置依赖:\n${waitingDeps}\n`
    : ""
}
## 3. AI 协作执行协议
${formatKnownTaskBriefInstructions(task.id)}
3. 执行过程中若有阶段进展，调用 \`update_task\` 汇报阶段产物与下一步骤；
4. 若遭遇阻塞，调用 \`update_task\` 填写 blocker 和 requiredAction；
5. 验收条件满足且验证完成后调用 \`submit_for_review\` 提交审核摘要；任务进入 in_review，等待开发者批准后才会完成。
`;

  const handleCopy = async () => {
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
          <div className="text-[11px] text-zinc-500 mb-2">
            可直接将以下简报复制粘贴给 AI 编程助手会话：
          </div>
          <pre className="p-3.5 bg-zinc-900/90 border border-zinc-850 text-zinc-200 rounded text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed selection:bg-cyan-500/30">
            {briefingText}
          </pre>
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
              className={`inline-flex items-center space-x-1.5 px-3 py-1 text-xs font-semibold rounded transition-colors ${
                copied
                  ? "bg-emerald-500 text-zinc-950"
                  : "bg-zinc-100 hover:bg-white text-zinc-950 shadow-xs"
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
