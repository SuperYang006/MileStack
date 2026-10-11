import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyTaskIdButtonProps {
  taskId: string;
  className?: string;
  title?: string;
}

export const CopyTaskIdButton: React.FC<CopyTaskIdButtonProps> = ({
  taskId,
  className = "",
  title = "点击复制任务 ID",
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(taskId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center justify-center p-1 rounded transition-colors group/copy ${
        copied
          ? "text-emerald-400 bg-emerald-950/60 border border-emerald-800/80"
          : "text-zinc-400 hover:text-cyan-300 bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800/80 hover:border-zinc-700"
      } ${className}`}
      title={copied ? "已复制任务 ID 到剪贴板" : title}
    >
      {copied ? (
        <Check className="w-3 h-3 text-emerald-400" />
      ) : (
        <Copy className="w-3 h-3 transition-transform group-hover/copy:scale-110" />
      )}
    </button>
  );
};
