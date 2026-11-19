import React, { useEffect, useMemo, useState } from "react";
import { Bookmark, Check, Copy, MessageSquare, X } from "lucide-react";

import {
  createPageCommentsBookmarklet,
  createPageCommentsConsoleSnippet,
} from "../utils/pageCommentsBookmarklet.js";

interface PageCommentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Origin that generated the bookmark; defaults to the current dashboard. */
  serviceOrigin?: string;
}

/** Install entry for the standalone page-comment bookmarklet served by `milestack serve`. */
export const PageCommentsModal: React.FC<PageCommentsModalProps> = ({
  isOpen,
  onClose,
  serviceOrigin,
}) => {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const origin =
    serviceOrigin ?? (typeof window === "undefined" ? "" : window.location.origin);
  const bookmarklet = useMemo(() => createPageCommentsBookmarklet(origin), [origin]);
  const consoleSnippet = useMemo(
    () => createPageCommentsConsoleSnippet(origin),
    [origin],
  );

  useEffect(() => {
    if (!isOpen) return;
    setCopied(false);
    setCopyFailed(false);
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, true);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const bookmarkRef = React.useCallback(
    (node: HTMLAnchorElement | null) => {
      // React blocks javascript: URLs passed through the href prop, so the
      // draggable bookmarklet is written directly to the DOM attribute.
      if (node) node.setAttribute("href", bookmarklet);
    },
    [bookmarklet],
  );

  if (!isOpen) return null;

  const copySnippet = async () => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(consoleSnippet);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 font-mono text-xs shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="page-comments-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/30 px-5 py-3">
          <div className="flex min-w-0 items-center space-x-2.5">
            <MessageSquare className="h-4 w-4 shrink-0 text-cyan-400" />
            <h2
              id="page-comments-title"
              className="truncate text-xs font-bold uppercase tracking-wider text-zinc-100"
            >
              页面评论
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
            title="关闭 (Esc)"
            aria-label="关闭页面评论说明"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 leading-relaxed text-zinc-300">
          <p className="text-zinc-400">
            在 localhost 开发页面上点选元素写评论，再把“复制全部”的文本交给编程 Agent
            整理成任务。首次使用先安装下面的书签。
          </p>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <a
                ref={bookmarkRef}
                draggable
                onClick={(event) => event.preventDefault()}
                className="inline-flex cursor-grab items-center space-x-1.5 rounded border border-cyan-700/60 bg-cyan-950/40 px-3 py-1.5 font-mono text-xs font-semibold text-cyan-200 transition-colors hover:border-cyan-500/70 hover:bg-cyan-900/40 active:cursor-grabbing"
                title="拖到浏览器书签栏"
                aria-label="页面评论书签，拖到浏览器书签栏"
              >
                <Bookmark className="h-3.5 w-3.5" />
                <span>页面评论</span>
              </a>
              <span className="text-[10px] text-zinc-500">拖到书签栏</span>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
              书签只保存一小段加载代码，不内嵌评论脚本；点击时才从运行中的 MileStack
              服务加载。
            </p>
          </div>

          <div>
            <button
              type="button"
              onClick={() => void copySnippet()}
              className="inline-flex items-center space-x-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copied ? "已复制控制台片段" : "复制控制台片段"}</span>
            </button>
            <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
              书签拖不动时，在目标页面的开发者工具 Console 中粘贴执行。
            </p>
            {copyFailed && (
              <p className="mt-1.5 text-[10px] text-rose-400">
                复制失败，请检查浏览器剪贴板权限。
              </p>
            )}
          </div>

          <ol className="list-decimal space-y-1.5 pl-4 text-[11px] text-zinc-400 marker:text-zinc-600">
            <li>把“页面评论”拖到浏览器书签栏；看不到书签栏时，按 ⌘+Shift+B（Windows/Linux：Ctrl+Shift+B）显示。</li>
            <li>打开要评论的 localhost 开发页面，点击这个书签。</li>
            <li>点选元素写评论；需要正常操作页面时切换为“已暂停”。</li>
            <li>点“复制全部”，把文本粘贴给编程 Agent 整理。</li>
          </ol>

          <p className="text-[10px] leading-relaxed text-zinc-500">
            整页刷新后，再次点击书签即可恢复评论。首期只保证 localhost 页面可用。
          </p>
        </div>

        <div className="flex items-center justify-end border-t border-zinc-800 bg-zinc-900/40 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
