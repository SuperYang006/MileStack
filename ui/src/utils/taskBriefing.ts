import { formatKnownTaskBriefInstructions } from "../../../src/core/agent-instructions.js";
import type {
  ProjectSummary,
  TaskDetails,
  TaskEvent,
  TaskModel,
  TaskSummary,
} from "../types.js";

function presentText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function bullet(label: string, value: string): string {
  return `- **${label}**: ${value}`;
}

function formatRisk(task: TaskModel): string | null {
  if (!task.riskLevel) {
    return null;
  }
  if (task.riskConfirmed === true) {
    return `${task.riskLevel}，开发者已确认`;
  }
  if (task.riskConfirmed === false) {
    return `${task.riskLevel}，尚未确认`;
  }
  return task.riskLevel;
}

function bulletList(label: string, items: string[]): string {
  if (items.length === 0) {
    return bullet(label, "无");
  }
  return [`- **${label}**:`, ...items.map((item) => `  - ${item}`)].join("\n");
}

function formatDependencies(
  task: Pick<TaskSummary, "dependencyIds" | "waitingFor">,
): string {
  return [
    bulletList(
      "前置依赖",
      task.dependencyIds.map((id) => `\`${id}\``),
    ),
    bulletList(
      "尚未完成的前置依赖",
      task.waitingFor.map((item) => `${item.title} (\`${item.status}\`)`),
    ),
  ].join("\n");
}

function formatProgress(task: TaskModel, events: TaskEvent[]): string {
  const fields: Array<[string, string | null]> = [
    ["当前步骤", presentText(task.currentStep)],
    ["下一步", presentText(task.nextStep)],
    ["阻塞", presentText(task.blocker)],
    ["需要的动作", presentText(task.requiredAction)],
    ["交接说明", presentText(task.handoffNote)],
  ];
  const lines = fields.flatMap(([label, value]) => (value ? [bullet(label, value)] : []));
  const latest = events.at(-1);
  if (latest) {
    lines.push(bullet("最近事件", `${latest.type}: ${latest.summary}`));
    const eventHandoff = presentText(latest.handoffNote);
    if (eventHandoff && eventHandoff !== presentText(task.handoffNote)) {
      lines.push(bullet("最近事件交接", eventHandoff));
    }
  }
  return lines.length > 0 ? lines.join("\n") : "- （尚无进展或交接）";
}

export function formatTaskBriefing(input: {
  project: Pick<ProjectSummary, "name" | "goal">;
  task: Pick<TaskSummary, "dependencyIds" | "waitingFor" | "runnable">;
  details: TaskDetails;
}): string {
  const record = input.details.task;
  const risk = formatRisk(record);
  const criteria =
    record.acceptanceCriteria && record.acceptanceCriteria.length > 0
      ? record.acceptanceCriteria.map((criterion, index) => `  ${index + 1}. ${criterion}`).join("\n")
      : "  （未指定具体验收条件）";
  const runnable = input.task.runnable
    ? "依赖已完成，可以调用 start_task 领取"
    : "等待前置依赖，start_task 会拒绝领取";

  return [
    "# MileStack 任务简报",
    "",
    "## 1. 项目概览",
    bullet("项目名称", input.project.name),
    bullet("项目目标", presentText(input.project.goal) ?? "（未设置）"),
    "",
    "## 2. 目标任务",
    bullet("Task ID", `\`${record.id}\``),
    bullet("任务标题", record.title),
    bullet("当前状态", `\`${record.status}\``),
    bullet("队列序号", record.queuePosition == null ? "无" : `#${record.queuePosition}`),
    ...(risk ? [bullet("风险", risk)] : []),
    bullet("可执行性", runnable),
    bullet("核心目标", presentText(record.objective) ?? "（未提供详细目标说明）"),
    "- **验收条件**:",
    criteria,
    formatDependencies(input.task),
    "",
    "## 3. 已有进展和交接",
    formatProgress(record, input.details.events),
    "",
    "## 4. AI 协作执行协议",
    formatKnownTaskBriefInstructions(record.id),
    "",
  ].join("\n");
}
