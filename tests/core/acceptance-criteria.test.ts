import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { SubmissionCriteriaIncompleteError } from "../../src/core/errors.js";
import { TaskService } from "../../src/core/task-service.js";
import { createSqliteRepository } from "../../src/db/sqlite-repository.js";
import { ensureDatabase } from "../../src/db/ensure-database.js";
import { projects, taskEvents, tasks } from "../../src/db/schema.js";

const temporaryProjects: string[] = [];

function createTemporaryProject(): string {
  const projectRoot = path.join(os.tmpdir(), `milestack-criteria-${randomUUID()}`);
  mkdirSync(projectRoot, { recursive: true });
  temporaryProjects.push(projectRoot);
  return projectRoot;
}

async function createService(projectRoot: string) {
  const database = await ensureDatabase(projectRoot);
  database.db
    .insert(projects)
    .values({
      id: "project-1",
      name: "MileStack",
      rootPath: projectRoot,
      goal: "Match delivery results to stable criterion identities",
      createdAt: "2026-10-17T00:00:00.000Z",
      updatedAt: "2026-10-17T00:00:00.000Z",
    })
    .run();

  return {
    database,
    service: new TaskService(createSqliteRepository(database), {
      now: () => new Date("2026-10-17T12:00:00.000Z"),
      generateId: (() => {
        let counter = 0;
        return () => `generated-${++counter}`;
      })(),
      integrationChecker: {
        check: () => ({ status: "integrated", targetCommitSha: "a".repeat(40) }),
      },
    }),
  };
}

function createInboxTask(service: TaskService, acceptanceCriteria: string[]) {
  return service.createTask({
    projectId: "project-1",
    title: "Criterion identity task",
    objective: "Keep delivery results attached to the right criterion",
    acceptanceCriteria,
    createdBy: "developer",
    status: "inbox",
  });
}

function evidence(command = "pnpm test") {
  return [{ command, result: "passed" }];
}

afterEach(() => {
  for (const projectRoot of temporaryProjects.splice(0)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

describe("acceptance criterion identities", () => {
  it("stores a single-sentence criterion without format labels and keeps it through an edit", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const criterionText = "点击保存后页面刷新并显示新任务。";
    const created = createInboxTask(service, [criterionText]);
    const createdCriterion = created.task.acceptanceCriteria?.[0];

    expect(createdCriterion?.text).toBe(criterionText);

    const edited = service.editInboxTask({
      projectId: "project-1",
      taskId: created.task.id,
      title: "Criterion identity task",
      acceptanceCriteria: [{ id: createdCriterion?.id, text: criterionText }],
    });
    expect(edited.task.acceptanceCriteria).toEqual([createdCriterion]);

    database.close();
  });

  it("gives identical criterion texts distinct ids that must each receive a result", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const created = createInboxTask(service, ["相同标准", "相同标准"]);
    const taskId = created.task.id;
    const criteria = created.task.acceptanceCriteria ?? [];
    expect(criteria).toHaveLength(2);
    expect(criteria[0]?.text).toBe("相同标准");
    expect(criteria[1]?.text).toBe("相同标准");
    expect(criteria[0]?.id).not.toBe(criteria[1]?.id);

    service.confirmTask({ projectId: "project-1", taskId });
    const run = service.startTask({ projectId: "project-1", taskId });
    const submit = (criteriaResults: unknown) =>
      service.submitForReview({
        projectId: "project-1",
        taskId,
        runId: run.runId,
        commitSha: "1".repeat(40),
        summary: "Submission under test",
        criteriaResults,
      } as Parameters<typeof service.submitForReview>[0]);

    expect(() =>
      submit([
        { criterionId: criteria[0]?.id, status: "met", evidence: evidence() },
      ]),
    ).toThrow(SubmissionCriteriaIncompleteError);
    expect(() =>
      submit([
        { criterionId: criteria[0]?.id, status: "met", evidence: evidence() },
        { criterionId: criteria[0]?.id, status: "met", evidence: evidence() },
      ]),
    ).toThrow(SubmissionCriteriaIncompleteError);

    const submitted = submit([
      { criterionId: criteria[0]?.id, status: "met", evidence: evidence() },
      { criterionId: criteria[1]?.id, status: "not_met", evidence: [] },
    ]);
    const event = submitted.events.at(-1);
    expect(event?.type).toBe("submitted_for_review");
    expect(
      event?.criteriaResults?.map((result) => [
        result.criterionId,
        result.criterion,
        result.status,
      ]),
    ).toEqual([
      [criteria[0]?.id, "相同标准", "met"],
      [criteria[1]?.id, "相同标准", "not_met"],
    ]);

    database.close();
  });

  it("keeps the id across text edits and still matches submissions filed under it", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const created = createInboxTask(service, ["First criterion", "Second criterion"]);
    const taskId = created.task.id;
    const before = created.task.acceptanceCriteria ?? [];

    const edited = service.editInboxTask({
      projectId: "project-1",
      taskId,
      title: "Criterion identity task",
      acceptanceCriteria: [
        { id: before[0]?.id, text: "First criterion." },
        { id: before[1]?.id, text: "Second  criterion" },
      ],
    });
    const after = edited.task.acceptanceCriteria ?? [];
    expect(after.map((criterion) => criterion.id)).toEqual(
      before.map((criterion) => criterion.id),
    );
    expect(after.map((criterion) => criterion.text)).toEqual([
      "First criterion.",
      "Second  criterion",
    ]);

    service.confirmTask({ projectId: "project-1", taskId });
    const run = service.startTask({ projectId: "project-1", taskId });
    const submitted = service.submitForReview({
      projectId: "project-1",
      taskId,
      runId: run.runId,
      commitSha: "2".repeat(40),
      summary: "Submitted after the text edit",
      criteriaResults: [
        { criterionId: before[0]?.id ?? "", status: "met", evidence: evidence() },
        { criterionId: before[1]?.id ?? "", status: "met", evidence: evidence() },
      ],
    });
    expect(submitted.events.at(-1)?.criteriaResults).toMatchObject([
      { criterionId: before[0]?.id, criterion: "First criterion.", status: "met" },
      { criterionId: before[1]?.id, criterion: "Second  criterion", status: "met" },
    ]);

    database.close();
  });

  it("drops deleted ids, never reuses them, and rejects stale or missing ids", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const created = createInboxTask(service, ["Alpha", "Beta", "Gamma"]);
    const taskId = created.task.id;
    const before = created.task.acceptanceCriteria ?? [];

    const reordered = service.editInboxTask({
      projectId: "project-1",
      taskId,
      title: "Criterion identity task",
      acceptanceCriteria: ["Gamma", "Alpha", "Beta"],
    });
    expect(reordered.task.acceptanceCriteria?.map((criterion) => criterion.id)).toEqual([
      before[2]?.id,
      before[0]?.id,
      before[1]?.id,
    ]);

    const replaced = service.editInboxTask({
      projectId: "project-1",
      taskId,
      title: "Criterion identity task",
      acceptanceCriteria: ["Alpha", "Delta"],
    });
    const after = replaced.task.acceptanceCriteria ?? [];
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[1]?.text).toBe("Delta");
    expect(after[1]?.id).not.toBe(before[1]?.id);
    expect(after[1]?.id).not.toBe(before[2]?.id);

    service.confirmTask({ projectId: "project-1", taskId });
    const run = service.startTask({ projectId: "project-1", taskId });
    const submit = (criteriaResults: unknown) =>
      service.submitForReview({
        projectId: "project-1",
        taskId,
        runId: run.runId,
        commitSha: "3".repeat(40),
        summary: "Submission under test",
        criteriaResults,
      } as Parameters<typeof service.submitForReview>[0]);

    expect(() =>
      submit([
        { criterionId: before[1]?.id, status: "met", evidence: evidence() },
        { criterionId: after[1]?.id, status: "met", evidence: evidence() },
      ]),
    ).toThrow(SubmissionCriteriaIncompleteError);
    expect(() =>
      submit([
        { criterionId: after[0]?.id, status: "met", evidence: evidence() },
      ]),
    ).toThrow(SubmissionCriteriaIncompleteError);
    expect(() =>
      submit([
        { criterionId: after[0]?.id, status: "met", evidence: evidence() },
        { criterionId: after[1]?.id, status: "met", evidence: evidence() },
      ]),
    ).not.toThrow();

    database.close();
  });

  it("reads legacy string criteria and text-keyed results, and accepts submissions under the derived ids", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const created = createInboxTask(service, ["Legacy A", "Legacy B"]);
    const taskId = created.task.id;

    // Rewrite the row to the shape written before criterion identities existed.
    database.db
      .update(tasks)
      .set({ acceptanceCriteria: ["Legacy A", "Legacy B"] })
      .where(eq(tasks.id, taskId))
      .run();

    const working = service.getTask({ projectId: "project-1", taskId });
    const criteria = working.task.acceptanceCriteria ?? [];
    expect(criteria.map((criterion) => criterion.text)).toEqual([
      "Legacy A",
      "Legacy B",
    ]);
    expect(criteria.map((criterion) => criterion.id)).toEqual([
      "legacy-0",
      "legacy-1",
    ]);
    expect(criteria[0]?.id).not.toBe(criteria[0]?.text);

    service.confirmTask({ projectId: "project-1", taskId });
    const run = service.startTask({ projectId: "project-1", taskId });
    const submitted = service.submitForReview({
      projectId: "project-1",
      taskId,
      runId: run.runId,
      commitSha: "4".repeat(40),
      summary: "Legacy criteria submission",
      criteriaResults: [
        { criterionId: "legacy-0", status: "met", evidence: evidence() },
        { criterionId: "legacy-1", status: "met", evidence: evidence() },
      ],
    });
    expect(
      submitted.events.at(-1)?.criteriaResults?.map((result) => [
        result.criterionId,
        result.criterion,
      ]),
    ).toEqual([
      ["legacy-0", "Legacy A"],
      ["legacy-1", "Legacy B"],
    ]);

    // Rewrite the stored results to the text-keyed payload written before this change.
    database.db
      .update(taskEvents)
      .set({
        completedWork: {
          completedWork: null,
          criteriaResults: [
            {
              criterion: "Legacy A",
              status: "met",
              evidence: evidence(),
            },
            {
              criterion: "Legacy B",
              status: "not_met",
              evidence: [],
            },
          ],
        },
      })
      .where(eq(taskEvents.taskId, taskId))
      .run();

    const full = service.getTask({ projectId: "project-1", taskId, view: "full" });
    expect(
      full.events
        .filter((event) => event.type === "submitted_for_review")
        .at(-1)
        ?.criteriaResults?.map((result) => [
          result.criterionId,
          result.criterion,
          result.status,
        ]),
    ).toEqual([
      [undefined, "Legacy A", "met"],
      [undefined, "Legacy B", "not_met"],
    ]);
    const review = service.getTask({ projectId: "project-1", taskId });
    expect(review.phase).toBe("review");
    expect(
      review.latestSubmission?.criteriaResults?.map((result) => result.criterion),
    ).toEqual(["Legacy A", "Legacy B"]);

    database.close();
  });
});
