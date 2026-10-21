import { describe, expect, it } from "vitest";
import {
  computePopoverPosition,
  getRiskOption,
  RISK_OPTIONS,
} from "../../ui/src/utils/riskOptions.js";

describe("Risk popover options and placement contracts", () => {
  describe("RISK_OPTIONS configuration", () => {
    it("defines low, medium, and high risk configurations", () => {
      const levels = RISK_OPTIONS.map((opt) => opt.level);
      expect(levels).toEqual(["low", "medium", "high"]);
    });

    it("keeps the required labels, tags, descriptions, and order", () => {
      expect(
        RISK_OPTIONS.map(({ level, label, tag, description }) => ({
          level,
          label,
          tag,
          description,
        }))
      ).toEqual([
        {
          level: "low",
          label: "低风险",
          tag: "Low",
          description: "AI 审核通过后自动完成",
        },
        {
          level: "medium",
          label: "中风险",
          tag: "Medium",
          description: "需人工复核终审 (推荐)",
        },
        {
          level: "high",
          label: "高风险",
          tag: "High",
          description: "核心架构或破坏性变更",
        },
      ]);
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

  describe("computePopoverPosition", () => {
    const size = { width: 288, height: 180 };

    it("places the menu below the trigger when the space below fits", () => {
      expect(
        computePopoverPosition(
          { top: 260, bottom: 290, right: 500 },
          size,
          { width: 1024, height: 800 }
        )
      ).toEqual({ top: 296, left: 212, placement: "down" });
    });

    it("flips above the trigger in a short widescreen window", () => {
      expect(
        computePopoverPosition(
          { top: 430, bottom: 460, right: 500 },
          size,
          { width: 1024, height: 520 }
        )
      ).toEqual({ top: 244, left: 212, placement: "up" });
    });

    it("clamps the menu into the viewport when neither side fits", () => {
      const position = computePopoverPosition(
        { top: 150, bottom: 180, right: 500 },
        size,
        { width: 1024, height: 300 }
      );

      expect(position.placement).toBe("up");
      expect(position.top).toBe(8);
      expect(position.top + size.height).toBeLessThanOrEqual(300);
    });

    it("keeps a downward menu inside the viewport when the window is very short", () => {
      const position = computePopoverPosition(
        { top: 20, bottom: 50, right: 300 },
        size,
        { width: 1024, height: 200 }
      );

      expect(position.placement).toBe("down");
      expect(position.top).toBe(12);
      expect(position.top + size.height).toBeLessThanOrEqual(200);
    });

    it("clamps the menu horizontally so it does not leave the viewport", () => {
      expect(
        computePopoverPosition(
          { top: 100, bottom: 130, right: 500 },
          size,
          { width: 320, height: 800 }
        ).left
      ).toBe(24);

      expect(
        computePopoverPosition(
          { top: 100, bottom: 130, right: 100 },
          size,
          { width: 320, height: 800 }
        ).left
      ).toBe(8);
    });
  });
});
