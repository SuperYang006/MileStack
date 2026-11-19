import React from "react";
import type { LucideIcon } from "lucide-react";

export type QueueStatusTone = "indigo" | "cyan" | "violet" | "zinc" | "rose";

interface QueueStatusBarAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

interface QueueStatusBarProps {
  tone: QueueStatusTone;
  title: string;
  count: number;
  status: string;
  action?: QueueStatusBarAction;
}

const toneStyles: Record<
  QueueStatusTone,
  { section: string; dot: string; title: string }
> = {
  indigo: {
    section: "border-zinc-800 bg-zinc-900/50",
    dot: "bg-indigo-400",
    title: "text-zinc-200",
  },
  cyan: {
    section: "border-zinc-800 bg-zinc-900/50",
    dot: "bg-cyan-400",
    title: "text-zinc-200",
  },
  violet: {
    section: "border-violet-900/50 bg-violet-950/15",
    dot: "bg-violet-400",
    title: "text-violet-200",
  },
  zinc: {
    section: "border-zinc-800 bg-zinc-900/50",
    dot: "bg-zinc-500",
    title: "text-zinc-300",
  },
  rose: {
    section: "border-zinc-800 bg-zinc-900/50",
    dot: "bg-rose-400",
    title: "text-zinc-200",
  },
};

/** An empty queue collapses to this single row so a populated queue keeps the
 *  remaining dashboard height instead of being squeezed by empty placeholders. */
export const QueueStatusBar: React.FC<QueueStatusBarProps> = ({
  tone,
  title,
  count,
  status,
  action,
}) => {
  const styles = toneStyles[tone];

  return (
    <section
      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 font-mono ${styles.section}`}
    >
      <span className={`w-2 h-2 shrink-0 rounded-full ${styles.dot}`} />
      <h2
        className={`shrink-0 text-xs font-bold tracking-wider uppercase ${styles.title}`}
      >
        {title} ({count})
      </h2>
      <span className="min-w-0 truncate text-[11px] text-zinc-500">{status}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="ml-auto inline-flex shrink-0 items-center space-x-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
        >
          {action.icon && <action.icon className="w-3 h-3" />}
          <span>{action.label}</span>
        </button>
      )}
    </section>
  );
};
