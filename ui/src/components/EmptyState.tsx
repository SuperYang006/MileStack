import React from "react";
import type { LucideIcon } from "lucide-react";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  variant?: "primary" | "secondary";
}

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  tag?: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  variant?: "default" | "cyan" | "violet" | "emerald" | "amber" | "indigo";
  compact?: boolean;
  className?: string;
}

const variantStyles = {
  default: {
    iconBg: "bg-zinc-900/80 border-zinc-800 text-zinc-400",
    glow: "group-hover:border-zinc-700",
    tag: "text-zinc-500 bg-zinc-900/60 border-zinc-800/80",
    actionBtn:
      "bg-zinc-900 hover:bg-zinc-850 text-zinc-200 border-zinc-700 hover:border-zinc-600",
  },
  cyan: {
    iconBg: "bg-cyan-950/30 border-cyan-800/40 text-cyan-400",
    glow: "group-hover:border-cyan-700/60",
    tag: "text-cyan-400/90 bg-cyan-950/40 border-cyan-800/50",
    actionBtn:
      "bg-cyan-950/50 hover:bg-cyan-900/60 text-cyan-300 border-cyan-800/60 hover:border-cyan-700",
  },
  violet: {
    iconBg: "bg-violet-950/30 border-violet-800/40 text-violet-400",
    glow: "group-hover:border-violet-700/60",
    tag: "text-violet-400/90 bg-violet-950/40 border-violet-800/50",
    actionBtn:
      "bg-violet-950/50 hover:bg-violet-900/60 text-violet-300 border-violet-800/60 hover:border-violet-700",
  },
  emerald: {
    iconBg: "bg-emerald-950/30 border-emerald-800/40 text-emerald-400",
    glow: "group-hover:border-emerald-700/60",
    tag: "text-emerald-400/90 bg-emerald-950/40 border-emerald-800/50",
    actionBtn:
      "bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border-emerald-800/60 hover:border-emerald-700",
  },
  amber: {
    iconBg: "bg-amber-950/30 border-amber-800/40 text-amber-400",
    glow: "group-hover:border-amber-700/60",
    tag: "text-amber-400/90 bg-amber-950/40 border-amber-800/50",
    actionBtn:
      "bg-amber-950/50 hover:bg-amber-900/60 text-amber-300 border-amber-800/60 hover:border-amber-700",
  },
  indigo: {
    iconBg: "bg-indigo-950/30 border-indigo-800/40 text-indigo-400",
    glow: "group-hover:border-indigo-700/60",
    tag: "text-indigo-400/90 bg-indigo-950/40 border-indigo-800/50",
    actionBtn:
      "bg-indigo-950/50 hover:bg-indigo-900/60 text-indigo-300 border-indigo-800/60 hover:border-indigo-700",
  },
};

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  tag,
  action,
  secondaryAction,
  variant = "default",
  compact = false,
  className = "",
}) => {
  const styles = variantStyles[variant];

  if (compact) {
    return (
      <div
        className={`group flex items-center justify-center gap-2.5 py-4 px-3 rounded border border-dashed border-zinc-800/80 bg-zinc-950/30 font-mono text-xs ${className}`}
      >
        <div
          className={`w-6 h-6 rounded flex items-center justify-center border shrink-0 ${styles.iconBg}`}
        >
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="flex items-center gap-2 text-zinc-400">
          {tag && (
            <span
              className={`text-[10px] uppercase px-1.5 py-0.2 rounded border font-mono ${styles.tag}`}
            >
              {tag}
            </span>
          )}
          <span className="text-zinc-300 font-medium">{title}</span>
          {description && (
            <span className="text-zinc-500 text-[11px] hidden sm:inline">
              · {description}
            </span>
          )}
        </div>
        {action && (
          <button
            onClick={action.onClick}
            className={`ml-2 inline-flex items-center space-x-1 px-2 py-0.5 text-[11px] font-mono rounded border transition-colors cursor-pointer ${styles.actionBtn}`}
          >
            {action.icon && <action.icon className="w-3 h-3" />}
            <span>{action.label}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`group relative flex flex-col items-center justify-center text-center p-6 sm:p-7 rounded-lg border border-dashed border-zinc-800/90 bg-zinc-950/40 backdrop-blur-xs font-mono transition-colors hover:border-zinc-700/80 ${className}`}
    >
      {/* Icon Badge */}
      <div className="relative mb-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center border shadow-xs transition-colors ${styles.iconBg} ${styles.glow}`}
        >
          <Icon className="w-5 h-5" />
        </div>
      </div>

      {/* Optional Terminal Tag / Status Code */}
      {tag && (
        <div className="mb-2">
          <span
            className={`inline-block text-[10px] font-mono uppercase px-2 py-0.5 rounded border tracking-wider ${styles.tag}`}
          >
            {tag}
          </span>
        </div>
      )}

      {/* Title */}
      <h4 className="text-xs font-semibold text-zinc-200 tracking-wide mb-1">
        {title}
      </h4>

      {/* Description */}
      {description && (
        <p className="text-[11px] text-zinc-500 max-w-sm leading-relaxed mb-4">
          {description}
        </p>
      )}

      {/* Actions */}
      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-0.5">
          {action && (
            <button
              onClick={action.onClick}
              className={`inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-mono rounded-md border transition-colors cursor-pointer shadow-xs ${styles.actionBtn}`}
            >
              {action.icon && <action.icon className="w-3.5 h-3.5" />}
              <span>{action.label}</span>
            </button>
          )}

          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 text-xs font-mono text-zinc-400 hover:text-zinc-200 bg-zinc-900/60 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 rounded-md transition-colors cursor-pointer"
            >
              {secondaryAction.icon && <secondaryAction.icon className="w-3.5 h-3.5" />}
              <span>{secondaryAction.label}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
