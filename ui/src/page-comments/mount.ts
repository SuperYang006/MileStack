import { formatComments } from "./format.js";
import { compareElementSignals, pickBestCandidate } from "./matching.js";
import type { PageComment } from "./model.js";
import { MissingTargetRetry } from "./placement-retry.js";
import {
  collectCandidates,
  collectSignals,
  collectTarget,
  currentRoute,
  describeElement,
  findElement,
  formItemLabel,
  sectionTitle,
  viewportLabel,
} from "./signals.js";
import { createCommentId, loadComments, saveComments } from "./storage.js";

export interface PageCommentsHandle {
  toggleVisible(): void;
}

type ViewportRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

// The element (or saved anchor) an open editor belongs to. Read on every
// scroll so the highlight and popover stay attached to it.
type EditorTarget = {
  label: string;
  rect(): ViewportRect;
  reveal(): void;
};

export function mountPageComments(): PageCommentsHandle {
  const host = document.createElement("div");
  host.id = "ms-page-comments-host";
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
    [hidden]{display:none!important}
    .hl{position:fixed;border:2px solid #2563eb;background:rgba(37,99,235,.08);border-radius:4px;pointer-events:none}
    .hl.locked{background:rgba(37,99,235,.14);box-shadow:0 0 0 3px rgba(37,99,235,.25)}
    .hl-label{position:absolute;left:-2px;top:-22px;background:#2563eb;color:#fff;font-size:11px;line-height:16px;padding:2px 6px;border-radius:4px;white-space:nowrap;max-width:360px;overflow:hidden;text-overflow:ellipsis}
    .badge{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:#dc2626;color:#fff;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.3);border:2px solid #fff}
    .mark{position:fixed;border:2px dashed #d97706;background:rgba(217,119,6,.1);border-radius:4px;color:#b45309;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer;min-width:26px;min-height:20px}
    .pop{position:fixed;z-index:1;width:320px;max-width:calc(100vw - 16px);background:#fff;border-radius:10px;box-shadow:0 8px 28px rgba(15,23,42,.25);padding:12px;pointer-events:auto;color:#0f172a;font-size:13px}
    .pop-head{display:flex;align-items:center;gap:6px;margin-bottom:8px}
    .pop-target{flex:1;min-width:0;color:#64748b;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    button.locate{flex:none;height:22px;padding:0 6px;font-size:11px}
    .pop-warn{color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:6px 8px;font-size:12px;line-height:1.4;margin-bottom:8px}
    textarea{width:100%;min-height:84px;resize:vertical;border:1px solid #cbd5e1;border-radius:8px;padding:8px;font-size:13px;line-height:1.5;outline:none;color:#0f172a}
    textarea:focus{border-color:#2563eb}
    .pop-acts{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}
    .hint{flex:1;color:#94a3b8;font-size:11px;min-width:120px}
    button{font-size:12px;height:28px;padding:0 10px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;white-space:nowrap}
    button.primary{background:#2563eb;border-color:#2563eb;color:#fff}
    button.danger{color:#dc2626}
    .bar{position:fixed;right:16px;bottom:16px;display:flex;align-items:center;gap:6px;background:#0f172a;color:#fff;padding:8px 10px;border-radius:10px;pointer-events:auto;box-shadow:0 6px 20px rgba(0,0,0,.25);font-size:12px}
    .bar button{background:#1e293b;border-color:#334155;color:#fff}
    .bar button.on{background:#2563eb;border-color:#2563eb}
    .count{padding:0 4px;color:#cbd5e1}
    .list{position:fixed;right:16px;bottom:64px;width:380px;max-width:calc(100vw - 32px);max-height:55vh;overflow:auto;background:#fff;border-radius:10px;box-shadow:0 8px 28px rgba(15,23,42,.25);pointer-events:auto;padding:6px;font-size:12px;color:#0f172a}
    .item{padding:8px;display:flex;gap:8px;align-items:flex-start}
    .item + .item{border-top:1px solid #eef2f6}
    .item-acts{flex:none;display:flex;gap:4px}
    .num{flex:none;width:20px;height:20px;border-radius:50%;background:#dc2626;color:#fff;font-weight:600;display:flex;align-items:center;justify-content:center;font-size:11px}
    .item-body{flex:1;min-width:0}
    .item-body.clickable{cursor:pointer}
    .item-body.clickable:hover .text{color:#2563eb}
    .meta{color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .item-warn{color:#b45309;margin-top:4px}
    .empty{padding:12px;color:#64748b;text-align:center}
    .toast{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);background:#0f172a;color:#fff;padding:6px 12px;border-radius:6px;font-size:12px;pointer-events:none}
  </style>
  <div class="hl" hidden><span class="hl-label"></span></div>
  <div class="badges"></div>
  <div class="pop" hidden>
    <div class="pop-head">
      <div class="pop-target"></div>
      <button class="locate" hidden></button>
    </div>
    <div class="pop-warn" hidden>原元素已变化。可以修改或删除评论，也可以重新指定一个新的元素。</div>
    <textarea placeholder="写下对这个元素的意见…"></textarea>
    <div class="pop-acts">
      <span class="hint">⌘/Ctrl+Enter 保存 · Esc 取消</span>
      <button class="respec" hidden>重新指定</button>
      <button class="del danger" hidden>删除</button>
      <button class="cancel">取消</button>
      <button class="ok primary">保存</button>
    </div>
  </div>
  <div class="list" hidden></div>
  <div class="bar">
    <span class="count"></span>
    <button class="mode"></button>
    <button class="list-btn">列表</button>
    <button class="copy">复制全部</button>
    <button class="clear">清空</button>
    <button class="close">退出</button>
  </div>
  <div class="toast" hidden></div>`;
  document.documentElement.appendChild(host);

  function query<T extends Element>(selector: string): T {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`页面评论界面缺少节点：${selector}`);
    return found;
  }

  const highlight = query<HTMLDivElement>(".hl");
  const highlightLabel = query<HTMLSpanElement>(".hl-label");
  const badges = query<HTMLDivElement>(".badges");
  const pop = query<HTMLDivElement>(".pop");
  const popTarget = query<HTMLDivElement>(".pop-target");
  const popWarn = query<HTMLDivElement>(".pop-warn");
  const locateButton = query<HTMLButtonElement>(".locate");
  const textarea = query<HTMLTextAreaElement>("textarea");
  const deleteButton = query<HTMLButtonElement>(".del");
  const reassignButton = query<HTMLButtonElement>(".respec");
  const list = query<HTMLDivElement>(".list");
  const modeButton = query<HTMLButtonElement>(".mode");
  const countElement = query<HTMLSpanElement>(".count");
  const toast = query<HTMLDivElement>(".toast");

  let comments = loadComments(window.localStorage);
  let picking = true;
  let hidden = false;
  let editingIndex: number | null = null;
  let draft: PageComment | null = null;
  let reassignIndex: number | null = null;
  let editorTarget: EditorTarget | null = null;

  const placements = new Map<string, Element | null>();
  const missingRetry = new MissingTargetRetry({
    set: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clear: (handle) => window.clearTimeout(handle),
  });

  const currentComment = (): PageComment | null => {
    if (draft) return draft;
    if (editingIndex === null) return null;
    return comments[editingIndex] ?? null;
  };

  const isUiEvent = (event: Event): boolean => event.composedPath().includes(host);

  function persist(): void {
    saveComments(window.localStorage, comments);
  }

  let toastTimer = 0;
  function showToast(message: string): void {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 2200);
  }

  // ---------- 元素定位 ----------

  function preference(element: Element, anchor: { x: number; y: number }): number {
    const rect = element.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0 ? 1_000_000 : 0;
    const dx = rect.left + window.scrollX - anchor.x;
    const dy = rect.top + window.scrollY - anchor.y;
    return visible - Math.min(Math.hypot(dx, dy), 999_000);
  }

  function locate(comment: PageComment): Element | null {
    const direct = findElement(comment.target.selector);
    if (direct && compareElementSignals(comment.target, collectSignals(direct)).accepted) {
      return direct;
    }
    const candidates = collectCandidates(comment.target)
      .filter((element) => element !== host)
      .map((element) => ({ value: element, signals: collectSignals(element) }));
    return pickBestCandidate(comment.target, candidates, (element) =>
      preference(element, comment.target.anchor),
    );
  }

  function refreshPlacements(): void {
    const route = currentRoute();
    let missingCount = 0;
    for (const comment of comments) {
      if (comment.route !== route) {
        placements.delete(comment.id);
        continue;
      }
      const cached = placements.get(comment.id) ?? null;
      if (
        cached &&
        cached.isConnected &&
        compareElementSignals(comment.target, collectSignals(cached)).accepted
      ) {
        continue;
      }
      const found = locate(comment);
      placements.set(comment.id, found);
      if (!found) missingCount += 1;
    }
    // Mutations always run this pass. The bounded retry additionally covers a
    // target that reappears after the last observed mutation.
    missingRetry.update(missingCount, () => refresh());
  }

  function elementRect(element: Element): ViewportRect {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  function markerRect(comment: PageComment): ViewportRect {
    return {
      left: comment.target.anchor.x - window.scrollX,
      top: comment.target.anchor.y - window.scrollY,
      width: comment.target.anchor.width,
      height: comment.target.anchor.height,
    };
  }

  function isOnScreen(rect: ViewportRect): boolean {
    return (
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth &&
      rect.top + Math.max(rect.height, 1) > 0 &&
      rect.left + Math.max(rect.width, 1) > 0
    );
  }

  // ---------- 绘制 ----------

  function drawHighlight(rect: ViewportRect, label: string, locked: boolean): void {
    highlight.hidden = false;
    highlight.classList.toggle("locked", locked);
    Object.assign(highlight.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    highlightLabel.textContent = label;
    highlightLabel.style.top = rect.top < 24 ? `${rect.height + 2}px` : "-22px";
  }

  function renderMarkers(): void {
    badges.textContent = "";
    const route = currentRoute();
    comments.forEach((comment, index) => {
      if (comment.route !== route) return;
      const element = placements.get(comment.id) ?? null;
      if (element && element.isConnected) {
        const rect = element.getBoundingClientRect();
        if (
          (rect.width === 0 && rect.height === 0) ||
          !isOnScreen({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
        ) {
          return;
        }
        const badge = document.createElement("div");
        badge.className = "badge";
        badge.textContent = String(index + 1);
        badge.title = comment.comment;
        badge.style.left = `${Math.max(11, rect.left)}px`;
        badge.style.top = `${Math.max(11, rect.top)}px`;
        badge.addEventListener("click", (event) => {
          event.stopPropagation();
          openEditor(index);
        });
        badges.appendChild(badge);
        return;
      }
      const rect = markerRect(comment);
      if (!isOnScreen(rect)) return;
      const mark = document.createElement("div");
      mark.className = "mark";
      mark.textContent = String(index + 1);
      mark.title = "原元素已变化";
      mark.style.left = `${Math.max(0, rect.left)}px`;
      mark.style.top = `${Math.max(0, rect.top)}px`;
      mark.style.width = `${Math.max(28, Math.min(rect.width || 28, 240))}px`;
      mark.style.height = `${Math.max(24, Math.min(rect.height || 24, 160))}px`;
      mark.addEventListener("click", (event) => {
        event.stopPropagation();
        openEditor(index);
      });
      badges.appendChild(mark);
    });
  }

  function renderList(): void {
    if (list.hidden) return;
    list.textContent = "";
    if (comments.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "还没有评论。开启“点选中”后点击页面元素即可添加。";
      list.appendChild(empty);
      return;
    }
    const route = currentRoute();
    comments.forEach((comment, index) => {
      const onRoute = comment.route === route;
      const changed = onRoute && (placements.get(comment.id) ?? null) === null;
      const item = document.createElement("div");
      item.className = "item";

      const number = document.createElement("span");
      number.className = "num";
      number.textContent = String(index + 1);

      const body = document.createElement("div");
      body.className = `item-body${onRoute ? " clickable" : ""}`;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${comment.route} · ${comment.target.description}`;
      const text = document.createElement("div");
      text.className = "text";
      text.textContent = comment.comment;
      body.append(meta, text);
      if (changed) {
        const warning = document.createElement("div");
        warning.className = "item-warn";
        warning.textContent = "原元素已变化，点击可修改或重新指定";
        body.appendChild(warning);
      }
      if (onRoute) {
        body.title = "点击定位到该元素";
        body.addEventListener("click", () => locateComment(index));
      }

      const copy = document.createElement("button");
      copy.textContent = "复制";
      copy.addEventListener("click", () => {
        void copyComments([comment], `已复制第 ${index + 1} 条评论，粘贴给 Agent 即可`);
      });

      const remove = document.createElement("button");
      remove.className = "danger";
      remove.textContent = "删除";
      remove.addEventListener("click", () => {
        comments.splice(index, 1);
        persist();
        closeEditor();
        refresh();
      });

      const actions = document.createElement("div");
      actions.className = "item-acts";
      actions.append(copy, remove);

      item.append(number, body, actions);
      list.appendChild(item);
    });
  }

  function updateToolbar(): void {
    modeButton.textContent = picking ? "点选中" : "已暂停点选";
    modeButton.classList.toggle("on", picking);
    countElement.textContent = `${comments.length} 条评论`;
  }

  function renderMarkersOnly(): void {
    if (hidden) return;
    renderMarkers();
  }

  function refresh(): void {
    if (hidden) return;
    refreshPlacements();
    renderMarkers();
    renderList();
    updateToolbar();
    syncEditor();
  }

  // ---------- 评论编辑 ----------

  function positionEditor(rect: ViewportRect): void {
    const margin = 8;
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - width - margin));
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    let top: number;
    let offscreen: "above" | "below" | null = null;
    if (rect.top + rect.height < 0) {
      top = margin;
      offscreen = "above";
    } else if (rect.top > window.innerHeight) {
      top = maxTop;
      offscreen = "below";
    } else {
      const below = rect.top + rect.height + margin;
      top =
        below + height + margin <= window.innerHeight
          ? below
          : Math.min(maxTop, Math.max(margin, rect.top - height - margin));
    }
    Object.assign(pop.style, { left: `${left}px`, top: `${top}px` });
    locateButton.hidden = offscreen === null;
    locateButton.textContent = offscreen === "above" ? "↑ 定位" : "↓ 定位";
  }

  // Keeps the locked highlight and the popover attached to the commented
  // element while the page scrolls, resizes, or re-renders.
  function syncEditor(): void {
    if (!editorTarget || pop.hidden) return;
    const rect = editorTarget.rect();
    if (rect.width === 0 && rect.height === 0) highlight.hidden = true;
    else drawHighlight(rect, editorTarget.label, true);
    positionEditor(rect);
  }

  function showEditor(target: EditorTarget): void {
    editorTarget = target;
    pop.hidden = false;
    syncEditor();
    textarea.focus();
  }

  function openEditor(index: number): void {
    const comment = comments[index];
    if (!comment) return;
    closeEditor();
    editingIndex = index;
    const changed = (placements.get(comment.id) ?? null) === null;
    popTarget.textContent = `#${index + 1} · ${comment.target.description}${changed ? "（原元素已变化）" : ""}`;
    textarea.value = comment.comment;
    deleteButton.hidden = false;
    reassignButton.hidden = !changed;
    popWarn.hidden = !changed;
    // Resolve through placements on every read: re-renders may replace the
    // element while the editor is open.
    const located = (): Element | null => {
      const found = placements.get(comment.id) ?? null;
      return found && found.isConnected ? found : null;
    };
    showEditor({
      label: `正在编辑 #${index + 1}`,
      rect: () => {
        const found = located();
        return found ? elementRect(found) : markerRect(comment);
      },
      reveal: () => {
        const found = located();
        if (found) found.scrollIntoView({ block: "center", behavior: "smooth" });
        else
          window.scrollTo({
            top: comment.target.anchor.y - window.innerHeight / 2,
            behavior: "smooth",
          });
      },
    });
  }

  function openDraft(element: Element): void {
    draft = {
      id: createCommentId(),
      route: currentRoute(),
      origin: location.origin,
      viewport: viewportLabel(),
      target: collectTarget(element),
      formItem: formItemLabel(element),
      section: sectionTitle(element),
      comment: "",
      createdAt: new Date().toISOString(),
    };
    editingIndex = null;
    popTarget.textContent = draft.target.description;
    textarea.value = "";
    deleteButton.hidden = true;
    reassignButton.hidden = true;
    popWarn.hidden = true;
    showEditor({
      label: "正在评论",
      rect: () => elementRect(element),
      reveal: () => element.scrollIntoView({ block: "center", behavior: "smooth" }),
    });
  }

  // Opens the comment's editor and scrolls its element into view unless it is
  // already fully visible; the editor follows the element while it scrolls.
  function locateComment(index: number): void {
    openEditor(index);
    if (!editorTarget) return;
    const rect = editorTarget.rect();
    const fullyVisible =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.top + rect.height <= window.innerHeight &&
      rect.left + rect.width <= window.innerWidth;
    if (!fullyVisible) editorTarget.reveal();
  }

  function closeEditor(): void {
    editingIndex = null;
    draft = null;
    editorTarget = null;
    pop.hidden = true;
    highlight.hidden = true;
  }

  function saveEditor(): void {
    const text = textarea.value.trim();
    if (!text) {
      closeEditor();
      return;
    }
    const comment = currentComment();
    if (!comment) {
      closeEditor();
      return;
    }
    comment.comment = text;
    if (draft) {
      comments.push(draft);
      draft = null;
    }
    persist();
    closeEditor();
    refresh();
  }

  function startReassign(): void {
    if (editingIndex === null) return;
    reassignIndex = editingIndex;
    closeEditor();
    picking = true;
    updateToolbar();
    showToast("请点击新的目标元素");
  }

  function assignTarget(index: number, element: Element): void {
    const comment = comments[index];
    if (!comment) {
      reassignIndex = null;
      return;
    }
    comment.target = collectTarget(element);
    comment.formItem = formItemLabel(element);
    comment.section = sectionTitle(element);
    comment.route = currentRoute();
    comment.origin = location.origin;
    comment.viewport = viewportLabel();
    placements.set(comment.id, element);
    reassignIndex = null;
    persist();
    refresh();
    showToast("已重新指定评论元素");
  }

  deleteButton.addEventListener("click", () => {
    if (editingIndex !== null) {
      comments.splice(editingIndex, 1);
      persist();
    }
    closeEditor();
    refresh();
  });
  reassignButton.addEventListener("click", startReassign);
  locateButton.addEventListener("click", () => {
    editorTarget?.reveal();
    textarea.focus();
  });
  query<HTMLButtonElement>(".ok").addEventListener("click", saveEditor);
  query<HTMLButtonElement>(".cancel").addEventListener("click", closeEditor);

  textarea.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") closeEditor();
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) saveEditor();
  });

  // ---------- 工具栏 ----------

  async function copyComments(selected: readonly PageComment[], message: string): Promise<void> {
    const text = formatComments(selected, {
      origin: location.origin,
      formattedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    });
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      root.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    showToast(message);
  }

  modeButton.addEventListener("click", () => {
    picking = !picking;
    highlight.hidden = true;
    closeEditor();
    updateToolbar();
  });
  query<HTMLButtonElement>(".list-btn").addEventListener("click", () => {
    list.hidden = !list.hidden;
    renderList();
  });
  query<HTMLButtonElement>(".copy").addEventListener("click", () => {
    if (comments.length === 0) {
      showToast("还没有评论");
      return;
    }
    void copyComments(comments, `已复制 ${comments.length} 条评论，粘贴给 Agent 即可`);
  });
  query<HTMLButtonElement>(".clear").addEventListener("click", () => {
    if (comments.length === 0) return;
    if (window.confirm(`清空全部 ${comments.length} 条评论？`)) {
      comments = [];
      placements.clear();
      persist();
      closeEditor();
      refresh();
    }
  });
  query<HTMLButtonElement>(".close").addEventListener("click", teardown);

  // ---------- 页面事件拦截 ----------

  function block(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function blockPageEvent(event: Event): void {
    if (!picking || isUiEvent(event)) return;
    block(event);
  }

  function onMove(event: MouseEvent): void {
    // While an editor is open the highlight stays locked on its element.
    if (!picking || editorTarget || isUiEvent(event)) return;
    const target = event.target;
    if (target instanceof Element) drawHighlight(elementRect(target), describeElement(target), false);
  }

  function onClick(event: MouseEvent): void {
    if (isUiEvent(event)) return;
    if (reassignIndex !== null) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      block(event);
      assignTarget(reassignIndex, target);
      return;
    }
    if (!picking) return;
    block(event);
    if (editingIndex !== null || draft) {
      showToast("请先保存或取消当前评论");
      return;
    }
    const target = event.target;
    if (target instanceof Element) openDraft(target);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && reassignIndex !== null) {
      reassignIndex = null;
      showToast("已取消重新指定");
    }
  }

  const blockedEvents = ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick"];
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  for (const type of blockedEvents) document.addEventListener(type, blockPageEvent, true);

  let viewportFrame = 0;
  function onViewportChange(): void {
    if (viewportFrame !== 0) return;
    viewportFrame = window.requestAnimationFrame(() => {
      viewportFrame = 0;
      renderMarkersOnly();
      syncEditor();
    });
  }
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);

  // HMR replaces DOM nodes without a page reload; observe mutations and
  // re-locate comments instead of polling a stale structural selector.
  let refreshTimer = 0;
  function scheduleRefresh(): void {
    if (refreshTimer !== 0) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = 0;
      refresh();
    }, 200);
  }
  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  // Client-side route changes do not necessarily replace the documentElement
  // observers watch, so keep a light route check alongside the observer.
  let lastRoute = currentRoute();
  const routeTimer = window.setInterval(() => {
    const route = currentRoute();
    if (route === lastRoute) return;
    lastRoute = route;
    scheduleRefresh();
  }, 1000);

  function teardown(): void {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    for (const type of blockedEvents) document.removeEventListener(type, blockPageEvent, true);
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange);
    observer.disconnect();
    missingRetry.dispose();
    window.clearInterval(routeTimer);
    window.clearTimeout(refreshTimer);
    window.clearTimeout(toastTimer);
    if (viewportFrame !== 0) window.cancelAnimationFrame(viewportFrame);
    host.remove();
    (window as Window & { __msPageComments?: PageCommentsHandle }).__msPageComments = undefined;
  }

  function toggleVisible(): void {
    hidden = !hidden;
    host.style.display = hidden ? "none" : "";
    if (hidden) {
      picking = false;
      highlight.hidden = true;
      closeEditor();
    }
    updateToolbar();
    if (!hidden) refresh();
  }

  updateToolbar();
  refresh();
  showToast(comments.length > 0 ? `已恢复 ${comments.length} 条评论` : "点选页面元素即可添加评论");

  return { toggleVisible };
}
