import { mountPageComments, type PageCommentsHandle } from "./mount.js";

declare global {
  interface Window {
    __msPageComments?: PageCommentsHandle;
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (window.__msPageComments) {
    // Running the bookmark again toggles the toolbar instead of mounting a
    // second copy with a second set of page listeners.
    window.__msPageComments.toggleVisible();
  } else {
    window.__msPageComments = mountPageComments();
  }
}
