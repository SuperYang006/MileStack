import { useEffect, useRef } from "react";

/** An open overlay that Escape may dismiss. */
export interface EscapeOverlay {
  close: () => void;
  /** Mirrors the z-index of the overlay root so Esc agrees with what the user
   *  sees, e.g. 70 for a `z-[70]` root. */
  zIndex: number;
  /** Opening-order counter. Overlay roots are portaled to <body> in open
   *  order, so for equal z-index the most recently opened overlay also paints
   *  last — the tiebreak below matches the browser's paint rule exactly. */
  seq: number;
}

const openOverlays: EscapeOverlay[] = [];
let overlaySeq = 0;
/** The editable element with an open IME composition, tracked at window level.
 *  Some engines hand Esc to the input method without marking the keydown
 *  itself, so composition state is tracked in addition to `event.isComposing`. */
let compositionTarget: Element | null = null;

/** Decides whether a keydown may dismiss an overlay. Escape events inside an
 *  IME composition (event flag, legacy keyCode 229, or a live composition)
 *  belong to the input method — Esc cancels candidate words and must not close
 *  a dialog — and auto-repeat must not peel off several layers in one long
 *  press. Pure so the rule stays unit-testable without a DOM. */
export function shouldHandleEscapeKey(
  event: Pick<KeyboardEvent, "key" | "isComposing" | "keyCode" | "repeat">,
  composingActive: boolean
): boolean {
  if (event.key !== "Escape") return false;
  if (composingActive || event.isComposing || event.keyCode === 229) return false;
  if (event.repeat) return false;
  return true;
}

/** Escape targets the visually topmost overlay: highest z-index, ties broken
 *  by opening order. Pure so the layering rule stays unit-testable. */
export function pickTopmostOverlay(
  overlays: ReadonlyArray<EscapeOverlay>
): EscapeOverlay | null {
  let topmost: EscapeOverlay | null = null;
  for (const overlay of overlays) {
    if (
      topmost === null ||
      overlay.zIndex > topmost.zIndex ||
      (overlay.zIndex === topmost.zIndex && overlay.seq > topmost.seq)
    ) {
      topmost = overlay;
    }
  }
  return topmost;
}

/** True while an IME composition is live on a connected, still-focused target.
 *  A composition whose target was unmounted or blurred without compositionend
 *  (e.g. the offline notice replacing an editor mid-composition) must not keep
 *  swallowing Escape, so stale state is dropped here. */
function isCompositionActive(): boolean {
  const target = compositionTarget;
  if (!target) return false;
  if (!target.isConnected || document.activeElement !== target) {
    compositionTarget = null;
    return false;
  }
  return true;
}

function handleEscapeKey(event: KeyboardEvent): void {
  if (!shouldHandleEscapeKey(event, isCompositionActive())) return;
  const topmost = pickTopmostOverlay(openOverlays);
  if (!topmost) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  topmost.close();
}

function handleCompositionStart(event: CompositionEvent): void {
  compositionTarget = event.target instanceof Element ? event.target : null;
}

function handleCompositionEnd(): void {
  compositionTarget = null;
}

/** Closes the overlay on Escape while it is the visually topmost open layer.
 *  The overlay root must be rendered through a portal on <body> (as every
 *  modal here does) so its paint order is exactly (zIndex, open order), and
 *  `zIndex` must match the z-index of that root, e.g. 70 for `z-[70]`. The
 *  callback is read through a ref so re-renders never change the stack. */
export function useEscapeToClose(
  isOpen: boolean,
  onClose: () => void,
  zIndex: number
): void {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const overlay: EscapeOverlay = {
      close: () => onCloseRef.current(),
      zIndex,
      seq: overlaySeq++,
    };
    openOverlays.push(overlay);
    if (openOverlays.length === 1) {
      window.addEventListener("keydown", handleEscapeKey, true);
      window.addEventListener("compositionstart", handleCompositionStart, true);
      window.addEventListener("compositionend", handleCompositionEnd, true);
    }
    return () => {
      const index = openOverlays.indexOf(overlay);
      if (index !== -1) openOverlays.splice(index, 1);
      if (openOverlays.length === 0) {
        window.removeEventListener("keydown", handleEscapeKey, true);
        window.removeEventListener("compositionstart", handleCompositionStart, true);
        window.removeEventListener("compositionend", handleCompositionEnd, true);
        compositionTarget = null;
      }
    };
  }, [isOpen, zIndex]);
}
