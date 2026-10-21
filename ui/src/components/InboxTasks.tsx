import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, Trash2, Edit3, Inbox, Plus, Zap, CheckCircle2, ChevronDown } from "lucide-react";
import type { TaskSummary, RiskLevel } from "../types";
import { TaskIdBadge } from "./CopyTaskIdButton";
import { EmptyState } from "./EmptyState";
import {
  computeTaskDependencyDetail,
  type DependencyItem,
} from "../utils/dependencyGraph";
import {
  computePopoverPosition,
  RISK_OPTIONS,
  type PopoverPosition,
} from "../utils/riskOptions";

interface InboxTasksProps {
  tasks: TaskSummary[];
  allTasks?: Map<string, TaskSummary>;
  onConfirmTask: (taskId: string, riskLevel?: RiskLevel) => void;
  onRequestDelete: (task: TaskSummary) => void;
  onSelectTask: (taskId: string) => void;
  onEditTask?: (task: TaskSummary) => void;
  onCreateTask?: () => void;
}

export const InboxTasks: React.FC<InboxTasksProps> = ({
  tasks,
  allTasks = new Map(),
  onConfirmTask,
  onRequestDelete,
  onSelectTask,
  onEditTask,
  onCreateTask,
}) => {
  const [confirmingTaskId, setConfirmingTaskId] = useState<string | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null);
  const activeContainerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const closePopover = useCallback(() => {
    setConfirmingTaskId(null);
    setPopoverPosition(null);
    triggerRef.current = null;
  }, []);

  const placePopover = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const popover = popoverRef.current;
    const nextPosition = computePopoverPosition(
      {
        top: triggerRect.top,
        bottom: triggerRect.bottom,
        right: triggerRect.right,
      },
      {
        width: popover?.offsetWidth ?? (window.innerWidth >= 640 ? 288 : 256),
        height: popover?.offsetHeight ?? 180,
      },
      { width: window.innerWidth, height: window.innerHeight }
    );

    setPopoverPosition((current) =>
      current &&
      current.top === nextPosition.top &&
      current.left === nextPosition.left &&
      current.placement === nextPosition.placement
        ? current
        : nextPosition
    );
  }, []);

  useEffect(() => {
    if (!confirmingTaskId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closePopover();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const isInsideTrigger = activeContainerRef.current?.contains(target) ?? false;
      const isInsidePopover = popoverRef.current?.contains(target) ?? false;

      if (!isInsideTrigger && !isInsidePopover) {
        closePopover();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClickOutside);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [confirmingTaskId, closePopover]);

  useLayoutEffect(() => {
    if (confirmingTaskId) {
      placePopover();
    }
  }, [confirmingTaskId, placePopover]);

  useEffect(() => {
    if (!confirmingTaskId) return;

    const handleViewportChange = () => placePopover();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [confirmingTaskId, placePopover]);

  useEffect(() => {
    if (confirmingTaskId && activeContainerRef.current) {
      const timer = setTimeout(() => {
        activeContainerRef.current?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
        placePopover();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [confirmingTaskId, placePopover]);

  const handleTogglePopover = (
    taskId: string,
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.stopPropagation();
    if (confirmingTaskId === taskId) {
      closePopover();
      return;
    }

    triggerRef.current = e.currentTarget;
    const triggerRect = e.currentTarget.getBoundingClientRect();
    setPopoverPosition(
      computePopoverPosition(
        {
          top: triggerRect.top,
          bottom: triggerRect.bottom,
          right: triggerRect.right,
        },
        {
          width: window.innerWidth >= 640 ? 288 : 256,
          height: 180,
        },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
    setConfirmingTaskId(taskId);
  };

  const handleSelectRiskAndConfirm = (taskId: string, riskLevel: RiskLevel) => {
    onConfirmTask(taskId, riskLevel);
    closePopover();
  };

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 backdrop-blur-xs overflow-hidden lg:h-full lg:min-h-0 lg:flex lg:flex-col">
      <div className="px-4 py-2.5 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-zinc-500" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-300 uppercase">
            草稿箱 ({tasks.length})
          </h2>
        </div>
        <span className="text-[11px] font-mono text-zinc-500">
          待分流归类
        </span>
      </div>

      <div className="p-3 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
        {tasks.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="草稿箱已清空"
            description="暂无新草稿。Agent 发现的新事项或手动录入的需求将暂存在此"
            tag="草稿箱已清空"
            variant="default"
            className="lg:h-full"
            action={
              onCreateTask
                ? {
                    label: "新建任务",
                    onClick: onCreateTask,
                    icon: Plus,
                  }
                : undefined
            }
          />
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {tasks.map((task) => {
              const detail = computeTaskDependencyDetail(task, allTasks);

              return (
                <div
                  key={task.id}
                  className={`py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3 group lg:grid lg:grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] lg:items-start lg:gap-x-3 ${
                    confirmingTaskId === task.id ? "relative z-30" : ""
                  }`}
                >
                  <div
                    className="flex flex-1 min-w-0 items-start gap-2 cursor-pointer lg:contents"
                    onClick={() => onSelectTask(task.id)}
                  >
                    <TaskIdBadge taskId={task.id} variant="muted" className="lg:w-full" />
                    <div className="min-w-0 flex-1">
                      <h3 className="min-w-0 text-xs font-mono text-zinc-300 line-clamp-2 break-words group-hover:text-amber-300 transition-colors">
                        {task.title}
                      </h3>

                      <div className="mt-1 flex items-center flex-wrap gap-1.5">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-mono shrink-0 ${
                            task.riskLevel === "low"
                              ? "bg-emerald-950/60 border border-emerald-800/60 text-emerald-300"
                              : task.riskLevel === "high"
                              ? "bg-rose-950/60 border border-rose-850 text-rose-300"
                              : "bg-amber-950/60 border border-amber-800/60 text-amber-300"
                          }`}
                          title={`当前风险设定: ${task.riskLevel || "medium"}`}
                        >
                          {task.riskLevel === "low" ? "低风险" : task.riskLevel === "high" ? "高风险" : "中风险"}
                        </span>
                        {/* 只能标记为“可并行候选”，绝不误标为“当前可领取” */}
                        {detail.isInboxParallelCandidate && (
                          <span
                            className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-indigo-950/50 border border-indigo-900/60 text-indigo-300 shrink-0"
                            title="无未完成前置依赖，排入就绪队列后可并行执行"
                          >
                            <Zap className="w-2.5 h-2.5 text-indigo-400" />
                            <span>可并行候选</span>
                          </span>
                        )}
                      </div>

                    {/* 待整理依赖轻量摘要：纯文字与短ID链接，不占用多余高度 */}
                    {detail.dependencies.length > 0 && (
                      <div className="mt-1 flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-mono text-zinc-500">
                        {detail.areAllDependenciesMet ? (
                          <span className="inline-flex items-center space-x-1 text-emerald-400/90 text-[10px]">
                            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                            <span>前置已满足 ({detail.dependencies.length})</span>
                          </span>
                        ) : (
                          <div className="inline-flex items-center space-x-1.5 flex-wrap text-[10px]">
                            <span className="text-amber-400/90 inline-flex items-center space-x-1 shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400/90" />
                              <span>等待 {detail.waitingFor.length} 项前置:</span>
                            </span>
                            <span className="inline-flex items-center space-x-1">
                              {detail.waitingFor.slice(0, 2).map((dep, idx) => (
                                <button
                                  key={dep.id}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectTask(dep.id);
                                  }}
                                  className="text-zinc-400 hover:text-cyan-300 underline underline-offset-2 decoration-zinc-700 hover:decoration-cyan-400 transition-colors"
                                  title={`前置依赖: ${dep.title} (${dep.status}) - 点击查看详情`}
                                >
                                  #{dep.id.slice(0, 8)}
                                  {idx < Math.min(detail.waitingFor.length, 2) - 1 ? "," : ""}
                                </button>
                              ))}
                              {detail.waitingFor.length > 2 && (
                                <span className="text-zinc-500">
                                  等共 {detail.waitingFor.length} 项
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5 shrink-0 pt-0.5 lg:col-start-3">
                    <div
                      ref={confirmingTaskId === task.id ? activeContainerRef : undefined}
                      className="relative inline-block"
                    >
                      <button
                        type="button"
                        onClick={(e) => handleTogglePopover(task.id, e)}
                        className={`inline-flex items-center space-x-1 px-2 py-0.5 text-[11px] font-mono rounded transition-colors ${
                          confirmingTaskId === task.id
                            ? "text-emerald-300 bg-emerald-950 border border-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                            : "text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 hover:bg-emerald-950/80 border border-emerald-900/60"
                        }`}
                        title="选择风险等级并排入执行队列"
                        aria-expanded={confirmingTaskId === task.id}
                        aria-haspopup="true"
                      >
                        <Check className="w-3 h-3" />
                        <span>确认排队</span>
                        <ChevronDown
                          className={`w-3 h-3 transition-transform duration-150 ${
                            confirmingTaskId === task.id
                              ? "rotate-180 text-emerald-300"
                              : "text-emerald-500/70"
                          }`}
                        />
                      </button>

                      {confirmingTaskId === task.id &&
                        popoverPosition &&
                        createPortal(
                          <div
                            ref={popoverRef}
                            style={{
                              top: popoverPosition.top,
                              left: popoverPosition.left,
                            }}
                            className="fixed z-50 w-64 max-w-[calc(100vw-1rem)] sm:w-72 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl p-1.5 backdrop-blur-md font-mono animate-in fade-in-0 zoom-in-95 duration-100 ring-1 ring-white/5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="px-2 py-1.5 mb-1 border-b border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-400">
                              <span className="font-semibold tracking-wider text-zinc-300 uppercase">
                                选择风险并排队
                              </span>
                              <span className="text-[9px] text-zinc-500">点击立即入队</span>
                            </div>

                            <div className="space-y-1">
                              {RISK_OPTIONS.map((opt) => {
                                const isPreset = task.riskLevel === opt.level;
                                const isDefault = !task.riskLevel && opt.level === "medium";

                                return (
                                  <button
                                    key={opt.level}
                                    type="button"
                                    onClick={() => handleSelectRiskAndConfirm(task.id, opt.level)}
                                    className={`w-full text-left px-2 py-1.5 rounded flex items-start space-x-2.5 transition-all group/item border border-transparent ${opt.hoverBgClass} ${opt.hoverBorderClass}`}
                                  >
                                    <span
                                      className={`w-2 h-2 rounded-full mt-1 shrink-0 ${opt.dotColorClass}`}
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between">
                                        <span
                                          className={`text-[11px] font-bold ${opt.textColorClass}`}
                                        >
                                          {opt.label} ({opt.tag})
                                        </span>
                                        {isPreset ? (
                                          <span className="text-[9px] text-zinc-500">
                                            当前设定
                                          </span>
                                        ) : isDefault ? (
                                          <span className="text-[9px] text-amber-500/80">
                                            默认
                                          </span>
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
                        )}
                    </div>
                    {onEditTask && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditTask(task);
                        }}
                        className="p-1 text-zinc-500 hover:text-amber-300 rounded transition-all opacity-0 group-hover:opacity-100"
                        title="编辑任务草稿"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestDelete(task);
                      }}
                      className="p-1 text-zinc-500 hover:text-rose-400 rounded transition-all opacity-0 group-hover:opacity-100"
                      title="删除任务"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
