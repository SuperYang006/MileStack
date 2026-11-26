import React, { useEffect } from "react";
import { AlertTriangle, GitBranch, X } from "lucide-react";

export interface OperationError {
  /** Increments per failure so repeating the same operation rearms the timer. */
  id: number;
  operation: string;
  message: string;
}

export interface BatchIntegrationSummary {
  /** Increments per batch run so repeated summaries rearm auto-dismiss. */
  id: number;
  title: string;
  detail: string;
}

interface FloatingBannerProps {
  noticeId: number | null;
  tone: "error" | "warning";
  title: string;
  message: string;
  onDismiss: () => void;
  autoDismissMs: number;
}

const bannerToneStyles = {
  error: {
    container: "border-rose-800/70 bg-rose-950/95 text-rose-100",
    title: "text-rose-200",
    separator: "text-rose-400",
    button: "text-rose-300 hover:text-rose-100 hover:bg-rose-900/60",
  },
  warning: {
    container: "border-amber-800/70 bg-amber-950/95 text-amber-100",
    title: "text-amber-200",
    separator: "text-amber-400",
    button: "text-amber-300 hover:text-amber-100 hover:bg-amber-900/60",
  },
} as const;

const FloatingNoticeBanner: React.FC<FloatingBannerProps> = ({
  noticeId,
  tone,
  title,
  message,
  onDismiss,
  autoDismissMs,
}) => {
  useEffect(() => {
    if (noticeId === null) return;
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [noticeId, onDismiss, autoDismissMs]);

  if (noticeId === null) return null;

  const styles = bannerToneStyles[tone];
  const isError = tone === "error";

  return (
    <div
      className="fixed inset-x-0 bottom-4 z-[80] flex justify-center px-4 pointer-events-none"
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      <div
        className={`pointer-events-auto flex w-full max-w-xl items-start gap-2 rounded-md border px-3 py-2 text-[11px] shadow-lg ${styles.container}`}
      >
        {isError ? (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
        ) : (
          <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
        )}
        <div className="min-w-0 flex-1">
          <span className={`font-bold ${styles.title}`}>{title}</span>
          <span className={`px-1 ${styles.separator}`}>·</span>
          <span className="break-words">{message}</span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className={`p-0.5 rounded transition-colors ${styles.button}`}
          title="关闭提示"
          aria-label="关闭提示"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

interface OperationErrorNoticeProps {
  error: OperationError | null;
  onDismiss: () => void;
  autoDismissMs?: number;
}

/** A page-level notice for a failed task action. It stays above open modals so
 *  a failure triggered from a dialog cannot disappear behind it. */
export const OperationErrorNotice: React.FC<OperationErrorNoticeProps> = ({
  error,
  onDismiss,
  autoDismissMs = 8000,
}) => (
  <FloatingNoticeBanner
    noticeId={error ? error.id : null}
    tone="error"
    title={error ? `${error.operation}失败` : ""}
    message={error ? error.message : ""}
    onDismiss={onDismiss}
    autoDismissMs={autoDismissMs}
  />
);

interface BatchIntegrationNoticeProps {
  summary: BatchIntegrationSummary | null;
  onDismiss: () => void;
  autoDismissMs?: number;
}

/** Non-blocking summary shown when batch local integration leaves unarchived or failed items. */
export const BatchIntegrationNotice: React.FC<BatchIntegrationNoticeProps> = ({
  summary,
  onDismiss,
  autoDismissMs = 10_000,
}) => (
  <FloatingNoticeBanner
    noticeId={summary ? summary.id : null}
    tone="warning"
    title={summary ? summary.title : ""}
    message={summary ? summary.detail : ""}
    onDismiss={onDismiss}
    autoDismissMs={autoDismissMs}
  />
);
