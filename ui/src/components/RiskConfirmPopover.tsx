import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RiskLevel } from "../types";
import { computePopoverPosition, RISK_OPTIONS, type PopoverPosition } from "../utils/riskOptions";

interface RiskConfirmPopoverProps {
  /** 触发菜单的按钮，菜单定位在它旁边，点击它不算点击外部 */
  anchor: HTMLElement;
  /** 草稿当前预设的风险等级，用于标出“当前设定”或“默认” */
  riskLevel: RiskLevel | undefined;
  onSelect: (riskLevel: RiskLevel) => void;
  onClose: () => void;
}

/** “选择风险并排队”菜单：草稿箱与目标路径的草稿卡片共用 */
export const RiskConfirmPopover: React.FC<RiskConfirmPopoverProps> = ({
  anchor,
  riskLevel,
  onSelect,
  onClose,
}) => {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const placePopover = useCallback(() => {
    const anchorRect = anchor.getBoundingClientRect();
    const popover = popoverRef.current;
    const nextPosition = computePopoverPosition(
      {
        top: anchorRect.top,
        bottom: anchorRect.bottom,
        right: anchorRect.right,
      },
      {
        width: popover?.offsetWidth ?? (window.innerWidth >= 640 ? 288 : 256),
        height: popover?.offsetHeight ?? 180,
      },
      { width: window.innerWidth, height: window.innerHeight }
    );

    setPosition((current) =>
      current &&
      current.top === nextPosition.top &&
      current.left === nextPosition.left &&
      current.placement === nextPosition.placement
        ? current
        : nextPosition
    );
  }, [anchor]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        // 菜单挂在页面末尾，键盘用户关闭后应回到触发按钮
        anchor.focus();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!anchor.contains(target) && !popoverRef.current?.contains(target)) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClickOutside);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [anchor, onClose]);

  useLayoutEffect(() => {
    placePopover();
  }, [placePopover]);

  useEffect(() => {
    const handleViewportChange = () => placePopover();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [placePopover]);

  useEffect(() => {
    const timer = setTimeout(() => {
      anchor.scrollIntoView({ block: "nearest", behavior: "smooth" });
      placePopover();
    }, 50);
    return () => clearTimeout(timer);
  }, [anchor, placePopover]);

  const isPlaced = position !== null;
  useEffect(() => {
    // 菜单挂在页面末尾，不在触发按钮之后的 Tab 顺序里，打开后把焦点交给第一个选项
    if (isPlaced) popoverRef.current?.querySelector("button")?.focus();
  }, [isPlaced]);

  if (!position) return null;

  return createPortal(
    <div
      ref={popoverRef}
      style={{
        top: position.top,
        left: position.left,
      }}
      className="fixed z-50 w-64 max-w-[calc(100vw-1rem)] sm:w-72 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl p-1.5 backdrop-blur-md font-mono animate-in fade-in-0 zoom-in-95 duration-100 ring-1 ring-white/5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-2 py-1.5 mb-1 border-b border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-400">
        <span className="font-semibold tracking-wider text-zinc-300 uppercase">选择风险并排队</span>
        <span className="text-[9px] text-zinc-500">点击立即入队</span>
      </div>

      <div className="space-y-1">
        {RISK_OPTIONS.map((opt) => {
          const isPreset = riskLevel === opt.level;
          const isDefault = !riskLevel && opt.level === "medium";

          return (
            <button
              key={opt.level}
              type="button"
              onClick={() => onSelect(opt.level)}
              className={`w-full text-left px-2 py-1.5 rounded flex items-start space-x-2.5 transition-all group/item border border-transparent ${opt.hoverBgClass} ${opt.hoverBorderClass}`}
            >
              <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${opt.dotColorClass}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] font-bold ${opt.textColorClass}`}>
                    {opt.label} ({opt.tag})
                  </span>
                  {isPreset ? (
                    <span className="text-[9px] text-zinc-500">当前设定</span>
                  ) : isDefault ? (
                    <span className="text-[9px] text-amber-500/80">默认</span>
                  ) : null}
                </div>
                <p className="text-[10px] text-zinc-400 group-hover/item:text-zinc-300 leading-tight mt-0.5">
                  {opt.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
};
