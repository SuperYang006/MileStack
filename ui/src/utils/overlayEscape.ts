import { useEffect, useRef } from "react";

/** Open overlays in opening order. Escape closes only the most recently opened
 *  one, so a confirmation layer stacked on a task modal never closes both. */
const openOverlays: Array<() => void> = [];

function handleEscapeKey(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  const closeTopmost = openOverlays[openOverlays.length - 1];
  if (!closeTopmost) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  closeTopmost();
}

/** Closes the overlay on Escape while it is the topmost open overlay. The
 *  callback is read through a ref so re-renders never change the stack order. */
export function useEscapeToClose(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOverlay = () => onCloseRef.current();
    openOverlays.push(closeOverlay);
    if (openOverlays.length === 1) {
      window.addEventListener("keydown", handleEscapeKey, true);
    }
    return () => {
      const index = openOverlays.indexOf(closeOverlay);
      if (index !== -1) openOverlays.splice(index, 1);
      if (openOverlays.length === 0) {
        window.removeEventListener("keydown", handleEscapeKey, true);
      }
    };
  }, [isOpen]);
}
