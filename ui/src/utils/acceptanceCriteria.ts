import type {
  AcceptanceCriteriaEditEntry,
  AcceptanceCriterion,
} from "../types.js";

export const acceptanceCriteriaPreSubmissionReminder =
  "提交前检查：条件是否描述交付结果、是否有对应验证方式、是否包含未经确认的实现限制。";

/**
 * Turns the edited criterion lines back into edit entries while keeping the
 * stable id of each criterion the developer edited in place. Lines whose text
 * is unchanged keep that criterion's id wherever they moved; a changed line
 * keeps the id of the criterion at the same position; added lines become new
 * criteria. Deleted criteria simply drop out.
 */
export function reconcileCriteriaLines(
  initial: AcceptanceCriterion[],
  lines: string[],
): AcceptanceCriteriaEditEntry[] {
  const used = new Set<string>();
  const exactIds = lines.map((line) => {
    const identical = initial.find(
      (criterion) => !used.has(criterion.id) && criterion.text === line,
    );
    if (!identical) {
      return null;
    }
    used.add(identical.id);
    return identical.id;
  });

  return lines.map((line, index) => {
    const exactId = exactIds[index];
    if (exactId) {
      return { id: exactId, text: line };
    }
    const samePosition = initial[index];
    if (samePosition && !used.has(samePosition.id)) {
      used.add(samePosition.id);
      return { id: samePosition.id, text: line };
    }
    return { text: line };
  });
}
