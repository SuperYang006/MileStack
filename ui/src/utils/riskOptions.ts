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

export function computePopoverPlacement(
  buttonBottom: number,
  buttonTop: number,
  windowHeight: number,
  popoverHeight = 170
): "up" | "down" {
  const spaceBelow = windowHeight - buttonBottom;
  if (spaceBelow < popoverHeight && buttonTop > popoverHeight) {
    return "up";
  }
  return "down";
}
