import { describe, expect, it } from "vitest";
import {
  COMMENT_HANDLING_INSTRUCTION,
  formatComments,
} from "../../ui/src/page-comments/format.js";
import {
  compareElementSignals,
  pickBestCandidate,
  type Candidate,
} from "../../ui/src/page-comments/matching.js";
import type { ElementSignals, PageComment } from "../../ui/src/page-comments/model.js";

function signals(overrides: Partial<ElementSignals> = {}): ElementSignals {
  return {
    tag: "button",
    id: "",
    testId: "",
    text: "",
    classes: [],
    areaClasses: [],
    components: [],
    selector: "",
    ...overrides,
  };
}

function comment(overrides: Partial<PageComment> = {}): PageComment {
  return {
    id: "comment-1",
    route: "/orders",
    origin: "http://localhost:3000",
    viewport: "1440×900",
    target: {
      tag: "button",
      id: "",
      testId: "submit-order",
      text: "提交订单",
      classes: ["orders-module__submit"],
      areaClasses: ["orders-module__toolbar"],
      components: ["SubmitButton", "OrderToolbar", "OrderPage"],
      selector: "main > form:nth-of-type(2) > button",
      description: "<button> “提交订单”",
      anchor: { x: 120, y: 480, width: 120, height: 36 },
    },
    formItem: "订单信息",
    section: "订单详情",
    comment: "按钮太小，容易点错",
    createdAt: "2026-11-17T12:00:00.000Z",
    ...overrides,
  };
}

describe("page comment copy formatting", () => {
  it("starts with the handling instruction and includes every identity clue", () => {
    const text = formatComments([comment()], {
      origin: "http://localhost:3000",
      formattedAt: "2026/11/17 20:30:00",
    });

    expect(text.startsWith(COMMENT_HANDLING_INSTRUCTION)).toBe(true);
    expect(text).toContain("页面评论（共 1 条）");
    expect(text).toContain("来源：http://localhost:3000；整理时间：2026/11/17 20:30:00");
    expect(text).toContain("## 1. /orders（视口 1440×900）");
    expect(text).toContain("- 意见：按钮太小，容易点错");
    expect(text).toContain("- 元素：<button> “提交订单”");
    expect(text).toContain("- 所属表单项：订单信息");
    expect(text).toContain("- 所在区块：订单详情");
    expect(text).toContain(
      "- React 组件（由近到远）：SubmitButton › OrderToolbar › OrderPage",
    );
    expect(text).toContain("- 业务类名：orders-module__submit");
    expect(text).toContain("- 外层业务类名：orders-module__toolbar");
    expect(text).toContain("- data-testid：submit-order");
    // The brittle structural selector stays out of the agent-facing text.
    expect(text).not.toContain("nth-of-type");
    expect(text).not.toContain("选择器");
  });

  it("omits optional fields when the element has no such clues", () => {
    const text = formatComments(
      [
        comment({
          target: {
            ...comment().target,
            testId: "",
            classes: [],
            areaClasses: [],
            components: [],
          },
          formItem: "",
          section: "",
        }),
      ],
      { origin: "http://localhost:3000", formattedAt: "now" },
    );

    expect(text).not.toContain("所属表单项");
    expect(text).not.toContain("所在区块");
    expect(text).not.toContain("React 组件");
    expect(text).not.toContain("业务类名");
    expect(text).not.toContain("data-testid");
  });

  it("keeps comments in order with one-based numbering", () => {
    const text = formatComments([comment(), comment({ id: "comment-2", comment: "再来一条" })], {
      origin: "http://localhost:3000",
      formattedAt: "now",
    });

    expect(text).toContain("## 1. /orders");
    expect(text).toContain("## 2. /orders");
    expect(text.indexOf("按钮太小")).toBeLessThan(text.indexOf("再来一条"));
  });
});

describe("page comment element re-location", () => {
  it("relocates an element whose structural path changed when identity clues match", () => {
    const snapshot = signals({
      testId: "submit-order",
      text: "提交订单",
      classes: ["orders-module__submit"],
      selector: "main > form:nth-of-type(2) > button",
    });
    const relocated = signals({
      testId: "submit-order",
      text: "提交订单",
      classes: ["orders-module__submit"],
      selector: "main > section > div > form > button",
    });
    const candidates: Candidate<string>[] = [
      { value: "old", signals: signals({ text: "取消", selector: snapshot.selector }) },
      { value: "new", signals: relocated },
    ];

    expect(pickBestCandidate(snapshot, candidates)).toBe("new");
  });

  it("rejects a candidate that only matches the structural path but shows different text", () => {
    const snapshot = signals({
      text: "提交订单",
      selector: "main > form > button:nth-of-type(2)",
    });
    const candidate = signals({
      text: "删除订单",
      selector: snapshot.selector,
    });

    const match = compareElementSignals(snapshot, candidate);
    expect(match.accepted).toBe(false);
  });

  it("treats a text mismatch as a conflict even when tag and classes are identical", () => {
    const snapshot = signals({
      text: "保存",
      classes: ["panel-module__action"],
      components: ["PrimaryAction"],
    });
    const candidate = signals({
      text: "取消",
      classes: ["panel-module__action"],
      components: ["PrimaryAction"],
      selector: snapshot.selector,
    });

    expect(compareElementSignals(snapshot, candidate).accepted).toBe(false);
  });

  it("relocates an icon button through business classes and component chain", () => {
    const snapshot = signals({
      tag: "svg",
      classes: ["toolbar-module__icon"],
      components: ["ToolbarIcon"],
      selector: "header > div > svg:nth-of-type(3)",
    });
    const candidate = signals({
      tag: "svg",
      classes: ["toolbar-module__icon"],
      components: ["ToolbarIcon", "Toolbar"],
      selector: "header > nav > button > svg",
    });

    expect(compareElementSignals(snapshot, candidate).accepted).toBe(true);
  });

  it("falls back to a structural path only when the element has no identity clues", () => {
    const bare = signals({ tag: "div", selector: "main > div:nth-of-type(2)" });

    expect(
      compareElementSignals(bare, signals({ tag: "div", selector: bare.selector })).accepted,
    ).toBe(true);
    expect(
      compareElementSignals(bare, signals({ tag: "div", selector: "main > div:nth-of-type(3)" }))
        .accepted,
    ).toBe(false);
  });

  it("returns no match when the original element is gone", () => {
    const snapshot = signals({ testId: "removed-row", text: "订单 A" });

    expect(
      pickBestCandidate(snapshot, [
        { value: "other-row", signals: signals({ testId: "other-row", text: "订单 B" }) },
      ]),
    ).toBeNull();
  });

  it("keeps a form control attached when only its typed value changed", () => {
    const snapshot = signals({
      tag: "input",
      id: "customer-name",
      text: "张三",
      selector: "form > input",
    });
    const candidate = signals({
      tag: "input",
      id: "customer-name",
      text: "李四",
      selector: "form > div > input",
    });

    expect(compareElementSignals(snapshot, candidate).accepted).toBe(true);
  });
});
