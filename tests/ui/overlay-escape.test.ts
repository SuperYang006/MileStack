import { describe, expect, it } from "vitest";
import {
  pickTopmostOverlay,
  shouldHandleEscapeKey,
  type EscapeOverlay,
} from "../../ui/src/utils/overlayEscape.js";

const overlay = (zIndex: number, seq: number): EscapeOverlay => ({
  close: () => undefined,
  zIndex,
  seq,
});

describe("Escape overlay dismissal rules", () => {
  describe("shouldHandleEscapeKey", () => {
    it("accepts a plain Escape keydown", () => {
      expect(
        shouldHandleEscapeKey(
          { key: "Escape", isComposing: false, keyCode: 27, repeat: false },
          false
        )
      ).toBe(true);
    });

    it("rejects keys other than Escape", () => {
      expect(
        shouldHandleEscapeKey(
          { key: "Enter", isComposing: false, keyCode: 13, repeat: false },
          false
        )
      ).toBe(false);
    });

    it("leaves Esc inside an IME composition to the input method", () => {
      // The keydown that cancels candidate words reports isComposing; some
      // engines only expose the legacy keyCode 229 during composition, and the
      // open-composition flag covers synthetic or undocumented events.
      expect(
        shouldHandleEscapeKey(
          { key: "Escape", isComposing: true, keyCode: 27, repeat: false },
          false
        )
      ).toBe(false);
      expect(
        shouldHandleEscapeKey(
          { key: "Escape", isComposing: false, keyCode: 229, repeat: false },
          false
        )
      ).toBe(false);
      expect(
        shouldHandleEscapeKey(
          { key: "Escape", isComposing: false, keyCode: 27, repeat: false },
          true
        )
      ).toBe(false);
    });

    it("ignores auto-repeat so one long press closes only the top layer", () => {
      expect(
        shouldHandleEscapeKey(
          { key: "Escape", isComposing: false, keyCode: 27, repeat: true },
          false
        )
      ).toBe(false);
    });
  });

  describe("pickTopmostOverlay", () => {
    it("returns null when no overlay is open", () => {
      expect(pickTopmostOverlay([])).toBeNull();
    });

    it("returns the only open overlay", () => {
      const only = overlay(50, 0);
      expect(pickTopmostOverlay([only])).toBe(only);
    });

    it("prefers the highest z-index even when it opened first", () => {
      // Regression: with the delete confirmation (z-[70], opened first) and the
      // create-task modal (z-50, opened later) both registered, Esc must close
      // the confirmation the user can see, not the hidden create modal.
      const deleteConfirm = overlay(70, 0);
      const createModal = overlay(50, 1);
      expect(pickTopmostOverlay([deleteConfirm, createModal])).toBe(
        deleteConfirm
      );
    });

    it("breaks equal z-index ties by opening order (later portal on top)", () => {
      const detail = overlay(50, 0);
      const briefing = overlay(50, 1);
      expect(pickTopmostOverlay([detail, briefing])).toBe(briefing);
    });

    it("peels stacked layers one Esc at a time", () => {
      const detail = overlay(50, 0);
      const feedback = overlay(60, 1);
      expect(pickTopmostOverlay([detail, feedback])).toBe(feedback);
      expect(pickTopmostOverlay([detail])).toBe(detail);
    });

    it("does not mutate the given overlay list", () => {
      const list = [overlay(40, 0), overlay(70, 1), overlay(50, 2)];
      pickTopmostOverlay(list);
      expect(list.map((entry) => entry.zIndex)).toEqual([40, 70, 50]);
    });
  });
});
