import { describe, expect, it } from "vitest";
import {
  getFeedbackThemeConfig,
  isValidFeedback,
  type FeedbackTheme,
} from "../../ui/src/utils/feedbackDialog.js";

describe("FeedbackModal and useFeedbackDialog contracts", () => {
  describe("isValidFeedback input validation", () => {
    it("rejects empty strings", () => {
      expect(isValidFeedback("")).toBe(false);
    });

    it("rejects whitespace-only strings with spaces, tabs, and newlines", () => {
      expect(isValidFeedback("   ")).toBe(false);
      expect(isValidFeedback("\n\n\t  ")).toBe(false);
    });

    it("accepts valid single-line text", () => {
      expect(isValidFeedback("验收通过，无新增风险")).toBe(true);
    });

    it("accepts valid multi-line feedback with newlines", () => {
      const multiline = "第1轮审核发现以下问题：\n1. 需要补充单元测试\n2. 标题对齐说明文档";
      expect(isValidFeedback(multiline)).toBe(true);
    });
  });

  describe("getFeedbackThemeConfig semantic themes", () => {
    it("returns amber theme config for 退回返工", () => {
      const config = getFeedbackThemeConfig("amber");
      expect(config.badgeLabel).toBe("退回返工");
      expect(config.defaultTitle).toBe("退回返工反馈");
      expect(config.defaultConfirmLabel).toBe("确认退回");
      expect(config.iconColor).toContain("amber");
      expect(config.confirmButtonClass).toContain("amber");
    });

    it("returns violet theme config for 直接验收", () => {
      const config = getFeedbackThemeConfig("violet");
      expect(config.badgeLabel).toBe("直接验收");
      expect(config.defaultTitle).toBe("直接验收任务");
      expect(config.defaultConfirmLabel).toBe("直接验收");
      expect(config.iconColor).toContain("violet");
      expect(config.confirmButtonClass).toContain("violet");
    });

    it("returns cyan theme config for 归档返工", () => {
      const config = getFeedbackThemeConfig("cyan");
      expect(config.badgeLabel).toBe("归档返工");
      expect(config.defaultTitle).toBe("归档任务返工");
      expect(config.defaultConfirmLabel).toBe("确认返工");
      expect(config.iconColor).toContain("cyan");
      expect(config.confirmButtonClass).toContain("cyan");
    });

    it("falls back gracefully for unknown themes", () => {
      const fallback = getFeedbackThemeConfig("unknown" as FeedbackTheme);
      expect(fallback.badgeLabel).toBe("退回返工");
    });
  });
});
