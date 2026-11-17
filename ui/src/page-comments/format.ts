import type { PageComment } from "./model.js";

export const COMMENT_HANDLING_INSTRUCTION =
  "以下是开发者的页面评论。请先整理，不要直接修改代码：逐条定位到代码，合并针对同一处的修改，拆出涉及数据、接口或校验的需求，并就需要决策或有歧义的地方询问开发者、给出建议；开发者确认后再创建任务或修改代码。";

export interface CommentFormatContext {
  origin: string;
  formattedAt: string;
}

/**
 * Formats the "copy all" text for an agent. The long structural selector is
 * deliberately omitted: it is brittle and only the script uses it internally.
 */
export function formatComments(
  comments: readonly PageComment[],
  context: CommentFormatContext,
): string {
  const lines: string[] = [
    COMMENT_HANDLING_INSTRUCTION,
    "",
    `页面评论（共 ${comments.length} 条）`,
    `来源：${context.origin}；整理时间：${context.formattedAt}`,
    "",
  ];

  comments.forEach((comment, index) => {
    lines.push(`## ${index + 1}. ${comment.route}（视口 ${comment.viewport}）`);
    lines.push(`- 意见：${comment.comment}`);
    lines.push(`- 元素：${comment.target.description}`);
    if (comment.formItem) lines.push(`- 所属表单项：${comment.formItem}`);
    if (comment.section) lines.push(`- 所在区块：${comment.section}`);
    if (comment.target.components.length > 0) {
      lines.push(`- React 组件（由近到远）：${comment.target.components.join(" › ")}`);
    }
    if (comment.target.classes.length > 0) {
      lines.push(`- 业务类名：${comment.target.classes.join(" ")}`);
    }
    if (comment.target.areaClasses.length > 0) {
      lines.push(`- 外层业务类名：${comment.target.areaClasses.join(" ")}`);
    }
    if (comment.target.testId) {
      lines.push(`- data-testid：${comment.target.testId}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}
