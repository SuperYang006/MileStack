import React, { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

export interface OperationError {
  /** Increments per failure so repeating the same operation rearms the timer. */
  id: number;
  operation: string;
  message: string;
}

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
}) => {
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [error, onDismiss, autoDismissMs]);

  if (!error) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-4 z-[80] flex justify-center px-4 pointer-events-none"
      role="alert"
      aria-live="assertive"
    >
      <div className="pointer-events-auto flex w-full max-w-xl items-start gap-2 rounded-md border border-rose-800/70 bg-rose-950/95 px-3 py-2 text-[11px] text-rose-100 shadow-lg">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
        <div className="min-w-0 flex-1">
          <span className="font-bold text-rose-200">{error.operation}失败</span>
          <span className="px-1 text-rose-400">·</span>
          <span className="break-words">{error.message}</span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="p-0.5 rounded text-rose-300 hover:text-rose-100 hover:bg-rose-900/60 transition-colors"
          title="关闭提示"
          aria-label="关闭提示"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
