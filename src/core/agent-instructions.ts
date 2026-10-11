const taskDiscoveryRule =
  "没有已知 taskId 时，调用 get_project_status，选择 next 中第一个 runnable 为 true 的任务，再调用 get_task 读取详情。";
const knownTaskRule =
  "开发者或任务简报已经提供 taskId 时，直接调用 get_task 读取详情，不必先调用 get_project_status。";
const taskClaimRule =
  "读取任务详情后调用 start_task，保存返回的 runId。";
const taskClaimValidationRule =
  "服务端会校验任务状态、前置依赖和并发领取冲突。";
const taskCompletionRule =
  "实现完成后调用 submit_for_review 提交固定 commit 制品；任务进入 in_review，提交审核后旧 runId 立即失效。随后由 AI 调用 start_review 和 complete_review，低风险且证据完整时可自动完成，中高风险仍等待开发者批准。";

export function formatAgentIntegrationInstructions(): string {
  return `MILESTACK_START
- MileStack 是本项目任务和进度的事实源。不要新建或维护独立的 TODO、进度、计划或交接任务文档。
- 任务发现：${taskDiscoveryRule}
- 已知任务：${knownTaskRule}
- 领取任务：${taskClaimRule}${taskClaimValidationRule}
- 提交验收：${taskCompletionRule}
- 执行中发现的新工作通过 create_task 记录到 inbox，不要写入新的任务文档。
MILESTACK_END`;
}

export function formatMcpInstructions(): string {
  return [
    `任务发现：${taskDiscoveryRule}`,
    `已知任务：${knownTaskRule}`,
    `领取任务：${taskClaimRule}${taskClaimValidationRule}`,
    `提交验收：${taskCompletionRule}`,
    "Agent 创建的新工作进入 inbox。",
  ].join(" ");
}

export function formatKnownTaskBriefInstructions(taskId: string): string {
  return [
    "本简报已提供 taskId，因此采用已知任务流程：",
    `1. 直接调用 get_task，传入 taskId \`${taskId}\`；${knownTaskRule}`,
    `2. ${taskClaimRule}（taskId \`${taskId}\`）；${taskClaimValidationRule}`,
  ].join("\n");
}
