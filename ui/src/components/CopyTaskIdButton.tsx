import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

export interface TaskIdBadgeProps {
  taskId: string;
  variant?: "muted" | "cyan" | "rose" | "zinc" | "plain";
  showText?: boolean;
  className?: string;
  title?: string;
}

const variantStyles: Record<NonNullable<TaskIdBadgeProps["variant"]>, string> = {
  muted:
    "text-zinc-400 hover:text-zinc-200 bg-zinc-900/60 hover:bg-zinc-800/80 border-zinc-800/70 hover:border-zinc-700",
  cyan:
    "text-cyan-300 hover:text-cyan-200 bg-cyan-950/60 hover:bg-cyan-900/70 border-cyan-800/60 hover:border-cyan-700",
  rose:
    "text-rose-300 hover:text-rose-200 bg-rose-950/70 hover:bg-rose-900/80 border-rose-800/60 hover:border-rose-700",
  zinc:
    "text-zinc-300 hover:text-zinc-100 bg-zinc-900 hover:bg-zinc-850 border-zinc-800 hover:border-zinc-700",
  plain:
    "text-zinc-400 hover:text-zinc-200 bg-transparent hover:bg-zinc-800/50 border-transparent",
};

export const TaskIdBadge: React.FC<TaskIdBadgeProps> = ({
  taskId,
  variant = "muted",
  showText = true,
  className = "",
  title,
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

  const currentVariantClass = variantStyles[variant];

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`group/id inline-flex items-center space-x-1.5 px-1.5 py-0.5 rounded text-[11px] font-mono border transition-all cursor-pointer select-none max-w-full min-w-0 ${
        copied
          ? "text-emerald-300 bg-emerald-950/70 border-emerald-800"
          : currentVariantClass
      } ${className}`}
      title={copied ? "已复制任务 ID 到剪贴板" : title || `点击复制任务 ID: ${taskId}`}
    >
      {showText && <span className="truncate">{taskId}</span>}
      <span className="inline-flex items-center justify-center shrink-0">
        {copied ? (
          <Check className="w-3 h-3 text-emerald-400" />
        ) : (
          <Copy className="w-3 h-3 opacity-40 group-hover/id:opacity-100 transition-opacity" />
        )}
      </span>
    </button>
  );
};

export const CopyTaskIdButton: React.FC<{
  taskId: string;
  className?: string;
  title?: string;
}> = ({ taskId, className = "", title }) => {
  return (
    <TaskIdBadge
      taskId={taskId}
      showText={false}
      variant="plain"
      className={className}
      title={title}
    />
  );
};
