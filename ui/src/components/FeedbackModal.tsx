import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, RotateCcw, ShieldCheck, X } from "lucide-react";

import {
  FINDING_CLOSURE_STATUS_OPTIONS,
  type FeedbackClosureOption,
  type FeedbackClosureSelection,
  type FeedbackTheme,
  getFeedbackThemeConfig,
  isValidFeedback,
} from "../utils/feedbackDialog.js";
import type { FindingClosureStatus } from "../types.js";

export type { FeedbackClosureOption, FeedbackClosureSelection, FeedbackTheme };
export { getFeedbackThemeConfig, isValidFeedback };

export interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    value: string,
    closures: FeedbackClosureSelection[],
  ) => void | Promise<void>;
  taskId: string;
  taskTitle: string;
  title?: string;
  description?: string;
  theme?: FeedbackTheme;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  initialValue?: string;
  badgeLabel?: string;
  closures?: FeedbackClosureOption[];
}

export interface FeedbackDialogOptions {
  taskId: string;
  taskTitle: string;
  title?: string;
  description?: string;
  theme?: FeedbackTheme;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  initialValue?: string;
  badgeLabel?: string;
  closures?: FeedbackClosureOption[];
  onSubmit: (
    value: string,
    closures: FeedbackClosureSelection[],
  ) => void | Promise<void>;
}

const ICONS = {
  MessageSquare,
  ShieldCheck,
  RotateCcw,
};

export const FeedbackModal: React.FC<FeedbackModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  taskId,
  taskTitle,
  title,
  description,
  theme = "amber",
  placeholder,
  confirmLabel,
  cancelLabel = "取消",
  initialValue = "",
  badgeLabel,
  closures = [],
}) => {
  const [value, setValue] = useState(initialValue);
  const [closureSelections, setClosureSelections] = useState<
    Record<string, FindingClosureStatus | "">
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const themeConfig = getFeedbackThemeConfig(theme);
  const Icon = ICONS[themeConfig.iconName] ?? MessageSquare;
  const effectiveTitle = title || themeConfig.defaultTitle;
  const effectiveConfirmLabel = confirmLabel || themeConfig.defaultConfirmLabel;
  const effectiveBadgeLabel = badgeLabel || themeConfig.badgeLabel;
  const allClosuresChosen = closures.every((closure) =>
    Boolean(closureSelections[closure.key]),
  );
  const isValid = value.trim().length > 0 && allClosuresChosen;

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
      setClosureSelections({});
      setIsSubmitting(false);
      const timer = setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const len = textareaRef.current.value.length;
          textareaRef.current.setSelectionRange(len, len);
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialValue]);

  // Handle global Escape key with capture phase so it takes precedence over lower overlays
  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    const trimmed = value.trim();
    if (!trimmed || !allClosuresChosen || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(
        trimmed,
        closures
          .filter((closure) => closureSelections[closure.key])
          .map((closure) => ({
            key: closure.key,
            status: closureSelections[closure.key] as FindingClosureStatus,
          })),
      );
      onClose();
    } catch {
      // Error handling is managed by the caller/mutation
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (isValid && !isSubmitting) {
        void handleConfirm();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-100">
      {/* The backdrop deliberately does not close the dialog: a page-level overlay is easy to
          hit by accident, and the input is often long. Close with 取消, the header close button, or Esc. */}
      <div
        className={`bg-zinc-950 rounded-lg border border-zinc-800 ${themeConfig.borderClass} max-w-lg w-full flex flex-col overflow-hidden shadow-2xl font-mono text-xs`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-modal-title"
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/30">
          <div className="flex items-center space-x-2.5 min-w-0">
            <Icon className={`w-4 h-4 shrink-0 ${themeConfig.iconColor}`} />
            <h2
              id="feedback-modal-title"
              className="text-xs font-bold text-zinc-100 uppercase tracking-wider truncate"
            >
              {effectiveTitle}
            </h2>
            <span
              className={`px-1.5 py-0.5 text-[10px] rounded border shrink-0 ${themeConfig.badgeClass}`}
            >
              {effectiveBadgeLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors disabled:opacity-50"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 flex flex-col space-y-3.5">
          {/* Target Task Context Box */}
          <div className="p-3 rounded bg-zinc-900/60 border border-zinc-850 space-y-1.5">
            <div className="flex items-center space-x-1.5 text-[11px] text-zinc-500 font-mono">
              <span className="text-zinc-400 font-semibold uppercase">目标任务</span>
              <span className="text-zinc-600">#</span>
              <span className="text-zinc-300 font-mono select-all truncate max-w-sm">
                {taskId}
              </span>
            </div>
            <div className="text-xs text-zinc-200 font-medium line-clamp-2 leading-relaxed">
              {taskTitle}
            </div>
          </div>

          {/* Description / Instructions */}
          {description && (
            <div className="text-xs text-zinc-400 leading-relaxed">
              {description}
            </div>
          )}

          {/* Previous-round findings that must be closed by this return. */}
          {closures.length > 0 && (
            <div className="p-3 rounded bg-amber-950/20 border border-amber-900/40 space-y-2">
              <div className="text-[11px] font-semibold text-amber-300">
                上一轮发现关闭状态（每条必选）
              </div>
              <div className="space-y-1.5">
                {closures.map((closure) => (
                  <div key={closure.key} className="flex items-start space-x-2">
                    <span className="min-w-0 flex-1 text-[11px] text-zinc-300 line-clamp-2 leading-relaxed">
                      {closure.label}
                    </span>
                    <select
                      value={closureSelections[closure.key] ?? ""}
                      onChange={(e) =>
                        setClosureSelections((previous) => ({
                          ...previous,
                          [closure.key]: e.target.value as FindingClosureStatus | "",
                        }))
                      }
                      disabled={isSubmitting}
                      className="shrink-0 bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-1.5 py-1 text-[11px] outline-none focus:border-amber-500/70"
                    >
                      <option value="">请选择</option>
                      {FINDING_CLOSURE_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Multi-line Textarea */}
          <div>
            <textarea
              ref={textareaRef}
              rows={5}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              disabled={isSubmitting}
              placeholder={placeholder || "请输入详细说明（普通回车键换行，Cmd+Enter 快捷提交）..."}
              className={`w-full bg-zinc-900/90 border border-zinc-800 text-zinc-100 placeholder-zinc-600 rounded p-3 font-mono text-xs outline-none leading-relaxed resize-y transition-colors ${themeConfig.focusClass}`}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
          <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline">
            ⌘ / Ctrl + Enter 提交 · Esc 取消
          </span>
          <div className="flex items-center space-x-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 rounded transition-colors disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!isValid || isSubmitting}
              className={`px-3.5 py-1.5 text-xs rounded transition-all ${
                isValid && !isSubmitting
                  ? `${themeConfig.confirmButtonClass} cursor-pointer`
                  : "bg-zinc-800 text-zinc-500 border border-zinc-750 opacity-40 cursor-not-allowed"
              }`}
            >
              {isSubmitting ? "正在处理..." : effectiveConfirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export function useFeedbackDialog() {
  const [dialogOptions, setDialogOptions] = useState<FeedbackDialogOptions | null>(null);

  const openFeedbackDialog = useCallback((options: FeedbackDialogOptions) => {
    setDialogOptions(options);
  }, []);

  const closeFeedbackDialog = useCallback(() => {
    setDialogOptions(null);
  }, []);

  const feedbackDialogProps: FeedbackModalProps = useMemo(
    () => ({
      isOpen: !!dialogOptions,
      onClose: closeFeedbackDialog,
      onSubmit: async (value: string, closures: FeedbackClosureSelection[]) => {
        if (dialogOptions?.onSubmit) {
          await dialogOptions.onSubmit(value, closures);
        }
        closeFeedbackDialog();
      },
      taskId: dialogOptions?.taskId ?? "",
      taskTitle: dialogOptions?.taskTitle ?? "",
      title: dialogOptions?.title,
      description: dialogOptions?.description,
      theme: dialogOptions?.theme ?? "amber",
      placeholder: dialogOptions?.placeholder,
      confirmLabel: dialogOptions?.confirmLabel,
      cancelLabel: dialogOptions?.cancelLabel,
      initialValue: dialogOptions?.initialValue ?? "",
      badgeLabel: dialogOptions?.badgeLabel,
      closures: dialogOptions?.closures ?? [],
    }),
    [dialogOptions, closeFeedbackDialog],
  );

  return {
    openFeedbackDialog,
    closeFeedbackDialog,
    feedbackDialogProps,
    isOpen: !!dialogOptions,
  };
}
