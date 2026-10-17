import type { FindingClosureStatus } from "../types.js";
import { findingClosureStatusLabel } from "./reviewRecords.js";

export type FeedbackTheme = "amber" | "violet" | "cyan";

/** A previous-round finding that must be closed when returning for rework. */
export interface FeedbackClosureOption {
  key: string;
  label: string;
}

export interface FeedbackClosureSelection {
  key: string;
  status: FindingClosureStatus;
}

const closureStatusOrder: FindingClosureStatus[] = [
  "fixed",
  "partially_fixed",
  "not_fixed",
  "unverifiable",
  "invalidated",
];

export const FINDING_CLOSURE_STATUS_OPTIONS = closureStatusOrder.map((status) => ({
  value: status,
  label: findingClosureStatusLabel(status),
}));

export interface ThemeConfig {
  badgeLabel: string;
  badgeClass: string;
  borderClass: string;
  focusClass: string;
  confirmButtonClass: string;
  defaultTitle: string;
  defaultConfirmLabel: string;
  iconName: "MessageSquare" | "ShieldCheck" | "RotateCcw";
  iconColor: string;
}

export const THEME_CONFIGS: Record<FeedbackTheme, ThemeConfig> = {
  amber: {
    iconName: "MessageSquare",
    iconColor: "text-amber-400",
    badgeLabel: "退回返工",
    badgeClass: "bg-amber-950/60 text-amber-300 border-amber-800/60",
    borderClass: "border-amber-900/30",
    focusClass: "focus:border-amber-500/70 focus:ring-1 focus:ring-amber-500/40",
    confirmButtonClass: "bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold shadow-xs",
    defaultTitle: "退回返工反馈",
    defaultConfirmLabel: "确认退回",
  },
  violet: {
    iconName: "ShieldCheck",
    iconColor: "text-violet-400",
    badgeLabel: "直接验收",
    badgeClass: "bg-violet-950/60 text-violet-300 border-violet-800/60",
    borderClass: "border-violet-900/30",
    focusClass: "focus:border-violet-500/70 focus:ring-1 focus:ring-violet-500/40",
    confirmButtonClass: "bg-violet-600 hover:bg-violet-500 text-white font-semibold shadow-xs",
    defaultTitle: "直接验收任务",
    defaultConfirmLabel: "直接验收",
  },
  cyan: {
    iconName: "RotateCcw",
    iconColor: "text-cyan-400",
    badgeLabel: "归档返工",
    badgeClass: "bg-cyan-950/60 text-cyan-300 border-cyan-800/60",
    borderClass: "border-cyan-900/30",
    focusClass: "focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/40",
    confirmButtonClass: "bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold shadow-xs",
    defaultTitle: "归档任务返工",
    defaultConfirmLabel: "确认返工",
  },
};

export function getFeedbackThemeConfig(theme: FeedbackTheme): ThemeConfig {
  return THEME_CONFIGS[theme] ?? THEME_CONFIGS.amber;
}

export function isValidFeedback(content: string): boolean {
  return content.trim().length > 0;
}
