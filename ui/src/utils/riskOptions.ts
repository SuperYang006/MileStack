import type { RiskLevel } from "../types.js";

export interface RiskOptionConfig {
  readonly level: RiskLevel;
  readonly label: string;
  readonly tag: string;
  readonly description: string;
  readonly colorName: "emerald" | "amber" | "rose";
  readonly dotColorClass: string;
  readonly textColorClass: string;
  readonly hoverBgClass: string;
  readonly hoverBorderClass: string;
}

export const RISK_OPTIONS: readonly RiskOptionConfig[] = [
  {
    level: "low",
    label: "低风险",
    tag: "Low",
    description: "AI 审核通过后自动完成",
    colorName: "emerald",
    dotColorClass: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]",
    textColorClass: "text-emerald-400 group-hover/item:text-emerald-300",
    hoverBgClass: "hover:bg-emerald-950/40",
    hoverBorderClass: "hover:border-emerald-800/60",
  },
  {
    level: "medium",
    label: "中风险",
    tag: "Medium",
    description: "需人工复核终审 (推荐)",
    colorName: "amber",
    dotColorClass: "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]",
    textColorClass: "text-amber-400 group-hover/item:text-amber-300",
    hoverBgClass: "hover:bg-amber-950/40",
    hoverBorderClass: "hover:border-amber-800/60",
  },
  {
    level: "high",
    label: "高风险",
    tag: "High",
    description: "核心架构或破坏性变更",
    colorName: "rose",
    dotColorClass: "bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.6)]",
    textColorClass: "text-rose-400 group-hover/item:text-rose-300",
    hoverBgClass: "hover:bg-rose-950/40",
    hoverBorderClass: "hover:border-rose-850/60",
  },
] as const;

export function getRiskOption(level?: RiskLevel | null): RiskOptionConfig {
  const found = RISK_OPTIONS.find((opt) => opt.level === level);
  return found ?? (RISK_OPTIONS[1] as RiskOptionConfig);
}

export interface PopoverAnchorRect {
  readonly top: number;
  readonly bottom: number;
  readonly right: number;
}

export interface PopoverSize {
  readonly width: number;
  readonly height: number;
}

export interface PopoverViewport {
  readonly width: number;
  readonly height: number;
}

export interface PopoverPosition {
  readonly top: number;
  readonly left: number;
  readonly placement: "up" | "down";
}

const POPOVER_VIEWPORT_MARGIN = 8;
const POPOVER_ANCHOR_GAP = 6;

/**
 * Positions the risk menu in viewport coordinates so that it is never clipped
 * by ancestor overflow containers. The menu prefers the side below the trigger
 * and flips above when that side cannot fit, then clamps to the viewport as a
 * final guard for windows shorter than the menu itself.
 */
export function computePopoverPosition(
  anchor: PopoverAnchorRect,
  size: PopoverSize,
  viewport: PopoverViewport
): PopoverPosition {
  const spaceBelow = viewport.height - anchor.bottom - POPOVER_ANCHOR_GAP - POPOVER_VIEWPORT_MARGIN;
  const spaceAbove = anchor.top - POPOVER_ANCHOR_GAP - POPOVER_VIEWPORT_MARGIN;

  const placement: "up" | "down" =
    spaceBelow >= size.height
      ? "down"
      : spaceAbove >= size.height
        ? "up"
        : spaceBelow >= spaceAbove
          ? "down"
          : "up";

  const preferredTop =
    placement === "down"
      ? anchor.bottom + POPOVER_ANCHOR_GAP
      : anchor.top - POPOVER_ANCHOR_GAP - size.height;

  const maxTop = Math.max(
    POPOVER_VIEWPORT_MARGIN,
    viewport.height - size.height - POPOVER_VIEWPORT_MARGIN
  );
  const maxLeft = Math.max(
    POPOVER_VIEWPORT_MARGIN,
    viewport.width - size.width - POPOVER_VIEWPORT_MARGIN
  );

  return {
    top: Math.min(Math.max(preferredTop, POPOVER_VIEWPORT_MARGIN), maxTop),
    left: Math.min(Math.max(anchor.right - size.width, POPOVER_VIEWPORT_MARGIN), maxLeft),
    placement,
  };
}
