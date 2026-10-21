import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { TaskIdBadge } from "./CopyTaskIdButton";

interface DeleteTaskConfirmModalProps {
  isOpen: boolean;
  taskId: string;
  taskTitle: string;
  /** Which queue the pending task comes from, shown as terminal metadata. */
  taskSourceLabel?: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

const CLOSE_ANIMATION_MS = 140;

/** Shared dark terminal-style confirmation for irreversible task deletions.
 *  The dialog stays open with an error until the caller's delete request
 *  settles; a successful request closes it from the parent. */
export const DeleteTaskConfirmModal: React.FC<DeleteTaskConfirmModalProps> = ({
  isOpen,
  taskId,
  taskTitle,
  taskSourceLabel = "任务",
  onClose,
  onConfirm,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  useEffect(() => {
    clearCloseTimer();
    deletingRef.current = false;
    closingRef.current = false;
    setIsClosing(false);
    setIsDeleting(false);
    setError(null);
    return clearCloseTimer;
  }, [isOpen, taskId]);

  const requestClose = () => {
    if (deletingRef.current || closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      closingRef.current = false;
      setIsClosing(false);
      onClose();
    }, CLOSE_ANIMATION_MS);
  };

  // Capture phase so Escape closes this confirmation before any lower overlay.
  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    };
    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (isDeleting || deletingRef.current || closingRef.current) return;

    deletingRef.current = true;
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm();
      deletingRef.current = false;
      setIsDeleting(false);
      requestClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败，请稍后重试");
    } finally {
      deletingRef.current = false;
      setIsDeleting(false);
    }
  };

  const handleBackdropClick = () => {
    requestClose();
  };

  const controlsDisabled = isDeleting || isClosing;

  return (
    <div
      className={`fixed inset-0 z-[70] overflow-y-auto bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 transition-opacity duration-150 ease-out motion-reduce:transition-none ${
        isClosing ? "opacity-0" : "opacity-100"
      }`}
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={`w-full max-w-md overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 font-sans text-sm shadow-2xl transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${
          isClosing ? "scale-95 opacity-0" : "scale-100 opacity-100"
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-task-confirm-title"
        aria-describedby="delete-task-confirm-warning"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div className="flex min-w-0 items-center space-x-2.5 text-zinc-400">
            <Trash2 className="h-4 w-4 shrink-0" />
            <h2
              id="delete-task-confirm-heading"
              className="truncate text-[11px] font-semibold uppercase tracking-[0.16em]"
            >
              删除任务
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={controlsDisabled}
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300 disabled:opacity-50"
            title="关闭 (Esc)"
            aria-label="关闭删除确认"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-5">
          <div className="space-y-2">
            <h3
              id="delete-task-confirm-title"
              className="break-words text-lg font-semibold leading-snug text-zinc-100"
            >
              {taskTitle}
            </h3>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] text-zinc-500">
              <span className="rounded border border-zinc-800 bg-zinc-900/70 px-1.5 py-0.5">
                {taskSourceLabel}
              </span>
              <TaskIdBadge taskId={taskId} variant="muted" className="max-w-full" />
            </div>
          </div>

          <div
            id="delete-task-confirm-warning"
            className="flex items-start space-x-2.5 rounded-lg border border-rose-900/60 bg-rose-950/30 p-3.5"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <div className="space-y-1">
              <div className="text-xs font-semibold text-rose-300">此操作不可撤销</div>
              <p className="text-[11px] leading-relaxed text-rose-200/80">
                删除后该任务的记录与事件历史将被永久移除，无法恢复。请确认后继续。
              </p>
            </div>
          </div>

          {error && (
            <div className="rounded border border-rose-800 bg-rose-950/50 p-2.5 text-[11px] leading-relaxed text-rose-300">
              删除失败：{error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-5 py-3">
          <span className="hidden text-[10px] text-zinc-500 sm:inline">
            Esc 取消 · 点击遮罩关闭
          </span>
          <div className="ml-auto flex items-center space-x-2">
            <button
              type="button"
              onClick={requestClose}
              disabled={controlsDisabled}
              autoFocus
              className="rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={controlsDisabled}
              className="inline-flex items-center space-x-1.5 rounded border border-rose-600/70 bg-rose-700/80 px-3.5 py-1.5 font-semibold text-rose-50 transition-colors hover:bg-rose-600/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDeleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              <span>{isDeleting ? "正在删除..." : "确认删除"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
