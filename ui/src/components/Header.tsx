import React, { useState, useEffect } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Logo } from "./Logo";
import type { ProjectSummary } from "../types";

const TERMINAL_EGG_PHRASES = [
  "keeping context coherent across turns",
  "verifying acceptance criteria, bit by bit",
  "no hallucinations allowed in the loop",
  "local-first source of truth for humans & agents",
  "shipping working software with verifiable evidence",
  "aligning intentions with verifiable outcomes",
];

const TypewriterEgg: React.FC = () => {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [subIdx, setSubIdx] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentPhrase = TERMINAL_EGG_PHRASES[phraseIdx] || "";

    // If typing and reached full text, pause before deleting
    if (!isDeleting && subIdx === currentPhrase.length) {
      const timeout = setTimeout(() => setIsDeleting(true), 3200);
      return () => clearTimeout(timeout);
    }

    // If deleting and reached 0, move to next phrase
    if (isDeleting && subIdx === 0) {
      setIsDeleting(false);
      setPhraseIdx((prev) => (prev + 1) % TERMINAL_EGG_PHRASES.length);
      return;
    }

    // Typing/deleting interval speed
    const speed = isDeleting ? 28 : 55;
    const timeout = setTimeout(() => {
      setSubIdx((prev) => prev + (isDeleting ? -1 : 1));
    }, speed);

    return () => clearTimeout(timeout);
  }, [phraseIdx, subIdx, isDeleting]);

  const currentPhrase = TERMINAL_EGG_PHRASES[phraseIdx] || "";
  const displayed = currentPhrase.slice(0, subIdx);

  return (
    <span className="inline-flex items-center space-x-0.5 font-mono text-xs select-none">
      <span className="text-amber-500/70 mr-1 select-none font-bold">$</span>
      <span className="text-amber-300/90 tracking-wide drop-shadow-[0_0_8px_rgba(245,158,11,0.2)]">
        {displayed}
      </span>
      <span className="inline-block w-1.5 h-3.5 bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)] animate-pulse ml-0.5 opacity-90 rounded-[0.5px]" />
    </span>
  );
};
interface HeaderProps {
  project: ProjectSummary;
  isBackendConnected: boolean;
  onRefresh: () => void;
  onOpenCreateModal: () => void;
  isRefreshing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  project,
  isBackendConnected,
  onRefresh,
  onOpenCreateModal,
  isRefreshing = false,
}) => {
  return (
    <header className="bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/80 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5">
        <div className="flex items-center justify-between gap-4">
          {/* Logo & Terminal Identity */}
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center shrink-0 border border-zinc-800 shadow-md transition-transform hover:scale-105">
              <Logo className="w-full h-full" />
            </div>

            <div className="flex items-baseline space-x-2.5 min-w-0 truncate">
              <span className="font-mono text-sm font-bold tracking-tight text-zinc-100">
                {project.name.toLowerCase() || "milestack"}
              </span>
              <span className="font-mono text-xs text-zinc-500">::</span>
              {project.goal ? (
                <span className="font-mono text-xs text-zinc-400 truncate">
                  {project.goal}
                </span>
              ) : (
                <div className="truncate">
                  <TypewriterEgg />
                </div>
              )}
            </div>
          </div>

          {/* Right Controls & Status Pill */}
          <div className="flex items-center space-x-2.5 shrink-0">
            {/* Connection Status indicator */}
            <div className="flex items-center space-x-2 px-2.5 py-1 rounded-md bg-zinc-900/90 border border-zinc-800 text-[11px] font-mono text-zinc-400">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isBackendConnected
                    ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                    : "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                }`}
              />
              <span className="text-zinc-300">
                {isBackendConnected ? "服务在线" : "本地演示"}
              </span>
            </div>

            {/* Refresh */}
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono text-zinc-300 transition-colors disabled:opacity-40"
              title="刷新状态"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? "animate-spin text-cyan-400" : ""}`} />
              <span className="hidden sm:inline">刷新</span>
            </button>

            {/* Create Task button */}
            <button
              onClick={onOpenCreateModal}
              className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-mono font-semibold transition-colors shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新建任务</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
