import { describe, expect, it } from "vitest";

import { formatKnownTaskBriefInstructions } from "../../src/core/agent-instructions.js";
import type { TaskDetails, TaskEvent, TaskModel, TaskSummary } from "../../ui/src/types.js";
import { formatTaskBriefing } from "../../ui/src/utils/taskBriefing.js";

function taskRecord(overrides: Partial<TaskModel> = {}): TaskModel {
  return {
    id: "task-1",
    projectId: "project-1",
    title: "修复简报",
    objective: "让简报步骤连续",
    acceptanceCriteria: [
      { id: "criterion-1", text: "步骤不重复" },
      { id: "criterion-2", text: "不编造目标" },
    ],
    status: "ready",
    queuePosition: null,
    dependencyIds: [],
    currentStep: null,
    nextStep: null,
    blocker: null,
    requiredAction: null,
    handoffNote: null,
    sourceTaskId: null,
    activeRunId: null,
    integrationRequired: true,
    integrationTargetBranch: "main",
    integrationNotRequiredReason: null,
    createdBy: "developer",
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function event(overrides: Partial<TaskEvent> = {}): TaskEvent {
  return {
    id: "event-1",
    projectId: "project-1",
    taskId: "task-1",
    runId: null,
    type: "progress",
    summary: "写了初稿",
    completedWork: null,
    currentStep: null,
    nextStep: null,
    blocker: null,
    requiredAction: null,
    handoffNote: null,
    actorLabel: "agent",
    createdAt: "2026-10-13T01:00:00.000Z",
    ...overrides,
  };
}

function briefing(input: {
  goal?: string | null;
  runnable?: boolean;
  dependencyIds?: string[];
  waitingFor?: TaskSummary["waitingFor"];
  task?: Partial<TaskModel>;
  events?: TaskEvent[];
}): string {
  const record = taskRecord(input.task);
  const details: TaskDetails = { task: record, events: input.events ?? [] };
  return formatTaskBriefing({
    project: { name: "MileStack", goal: input.goal ?? null },
    task: {
      dependencyIds: input.dependencyIds ?? record.dependencyIds,
      waitingFor: input.waitingFor ?? [],
      runnable: input.runnable ?? false,
    },
    details,
  });
}

describe("task briefing text", () => {
  it("uses recorded facts and one continuous execution protocol", () => {
    const text = briefing({
      runnable: false,
      dependencyIds: ["dep-1", "dep-2"],
      waitingFor: [{ id: "dep-1", title: "先做依赖", status: "ready" }],
      task: {
        queuePosition: null,
        riskLevel: "medium",
        riskConfirmed: true,
        handoffNote: "上次停在协议段",
        currentStep: "核对完成条件",
      },
      events: [
        event({ id: "event-0", summary: "更早的记录", createdAt: "2026-10-13T00:30:00.000Z" }),
        event({ handoffNote: "事件里的另一条交接" }),
      ],
    });

    expect(text).toContain("- **项目目标**: （未设置）");
    expect(text).not.toContain("对齐人机任务上下文");
    expect(text).toContain("- **队列序号**: 无");
    expect(text).not.toContain("#1");
    expect(text).toContain("- **风险**: medium，开发者已确认");
    expect(text).toContain("- **可执行性**: 等待前置依赖，start_task 会拒绝领取");
    expect(text).toContain("  - `dep-1`");
    expect(text).toContain("  - `dep-2`");
    expect(text).toContain("  - 先做依赖 (`ready`)");
    expect(text).toContain("- **当前步骤**: 核对完成条件");
    expect(text).toContain("- **交接说明**: 上次停在协议段");
    expect(text).toContain("- **最近事件**: progress: 写了初稿");
    expect(text).toContain("- **最近事件交接**: 事件里的另一条交接");
    expect(text).not.toContain("更早的记录");
    expect(text).toContain(formatKnownTaskBriefInstructions("task-1"));
    expect(text).not.toContain("等待开发者批准后才会完成");
    for (const step of [1, 2, 3, 4, 5, 6, 7]) {
      expect(text.split(`\n${step}. `).length - 1).toBe(1);
    }
  });

  it("keeps a real goal and queue position, and says when nothing has started", () => {
    const text = briefing({
      goal: "让本地任务状态可信",
      runnable: true,
      task: { queuePosition: 2, objective: null, acceptanceCriteria: [] },
    });

    expect(text).toContain("- **项目目标**: 让本地任务状态可信");
    expect(text).toContain("- **队列序号**: #2");
    expect(text).toContain("- **可执行性**: 依赖已完成，可以调用 start_task 领取");
    expect(text).toContain("- **核心目标**: （未提供详细目标说明）");
    expect(text).toContain("  （未指定具体验收条件）");
    expect(text).toContain("- **前置依赖**: 无");
    expect(text).toContain("- **尚未完成的前置依赖**: 无");
    expect(text).toContain("- （尚无进展或交接）");
    expect(text).not.toContain("- **风险**:");
  });
});
