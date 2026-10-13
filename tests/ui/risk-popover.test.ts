import { describe, expect, it } from "vitest";
import {
  computePopoverPlacement,
  getRiskOption,
  RISK_OPTIONS,
} from "../../ui/src/utils/riskOptions.js";

describe("Risk popover options and placement contracts", () => {
  describe("RISK_OPTIONS configuration", () => {
    it("defines low, medium, and high risk configurations", () => {
      const levels = RISK_OPTIONS.map((opt) => opt.level);
      expect(levels).toEqual(["low", "medium", "high"]);
    });

    it("includes required labels, tags, and cyber terminal colors", () => {
      for (const opt of RISK_OPTIONS) {
        expect(opt.label).toBeTruthy();
        expect(opt.tag).toBeTruthy();
        expect(opt.description).toBeTruthy();
        expect(opt.dotColorClass).toContain("shadow-");
      }
    });
  });

  describe("getRiskOption", () => {
    it("returns correct config for each risk level", () => {
      expect(getRiskOption("low").label).toBe("低风险");
      expect(getRiskOption("medium").label).toBe("中风险");
      expect(getRiskOption("high").label).toBe("高风险");
    });

    it("falls back to medium when level is undefined or null", () => {
      expect(getRiskOption(undefined).level).toBe("medium");
      expect(getRiskOption(null).level).toBe("medium");
    });
  });

  describe("computePopoverPlacement", () => {
    it("places down when sufficient space is available below", () => {
      // window height = 800, button bottom = 300 (500px below)
      expect(computePopoverPlacement(300, 270, 800)).toBe("down");
    });

    it("places up when space below is tight and space above is sufficient", () => {
      // window height = 800, button bottom = 720 (80px below, button top = 690)
      expect(computePopoverPlacement(720, 690, 800)).toBe("up");
    });

    it("falls back to down when space above is also constrained", () => {
      // window height = 200, button bottom = 120 (80px below, button top = 90)
      expect(computePopoverPlacement(120, 90, 200)).toBe("down");
    });

    it("never places up when space above containerTop would collide with the header", () => {
      // button is at top of container: containerTop = 300, button top = 320 (only 20px clearance)
      // window height = 800, button bottom = 720 (tight below window, but tight above container!)
      expect(computePopoverPlacement(720, 320, 800, 300)).toBe("down");
    });

    it("allows placing up only when clearance above containerTop is greater than popoverHeight + margin", () => {
      // containerTop = 200, button top = 450 (250px clearance above containerTop)
      // window height = 800, button bottom = 720 (tight below window)
      expect(computePopoverPlacement(720, 450, 800, 200)).toBe("up");
    });
  });
});
