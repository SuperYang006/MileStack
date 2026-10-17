import { describe, expect, it } from "vitest";

import { reconcileCriteriaLines } from "../../ui/src/utils/acceptanceCriteria.js";
import type { AcceptanceCriterion } from "../../ui/src/types.js";

const criteria: AcceptanceCriterion[] = [
  { id: "criterion-1", text: "Alpha" },
  { id: "criterion-2", text: "Beta" },
  { id: "criterion-3", text: "Gamma" },
];

describe("inbox criterion line reconciliation", () => {
  it("keeps ids by text when unchanged lines move", () => {
    expect(reconcileCriteriaLines(criteria, ["Gamma", "Alpha", "Beta"])).toEqual([
      { id: "criterion-3", text: "Gamma" },
      { id: "criterion-1", text: "Alpha" },
      { id: "criterion-2", text: "Beta" },
    ]);
  });

  it("keeps the id of a line edited in place and drops deleted criteria", () => {
    expect(
      reconcileCriteriaLines(criteria, ["Alpha!", "Gamma"]),
    ).toEqual([
      { id: "criterion-1", text: "Alpha!" },
      { id: "criterion-3", text: "Gamma" },
    ]);
  });

  it("leaves added lines without an id", () => {
    expect(reconcileCriteriaLines(criteria, ["Alpha", "Beta", "Gamma", "Delta"])).toEqual([
      { id: "criterion-1", text: "Alpha" },
      { id: "criterion-2", text: "Beta" },
      { id: "criterion-3", text: "Gamma" },
      { text: "Delta" },
    ]);
  });

  it("keeps duplicated texts separate", () => {
    const duplicated: AcceptanceCriterion[] = [
      { id: "criterion-1", text: "相同" },
      { id: "criterion-2", text: "相同" },
    ];
    expect(reconcileCriteriaLines(duplicated, ["相同", "相同!"])).toEqual([
      { id: "criterion-1", text: "相同" },
      { id: "criterion-2", text: "相同!" },
    ]);
    expect(reconcileCriteriaLines(duplicated, ["相同"])).toEqual([
      { id: "criterion-1", text: "相同" },
    ]);
  });

  it("prefers text identity over position and never reuses a moved or deleted id", () => {
    expect(reconcileCriteriaLines(criteria, ["Alpha", "Edited", "Beta"])).toEqual([
      { id: "criterion-1", text: "Alpha" },
      { text: "Edited" },
      { id: "criterion-2", text: "Beta" },
    ]);
  });
});
