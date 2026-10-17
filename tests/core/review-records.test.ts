import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  FindingClosureIncompleteError,
  ReviewCannotPassError,
  SubmissionCriteriaIncompleteError,
} from "../../src/core/errors.js";
import { TaskService } from "../../src/core/task-service.js";
import { createSqliteRepository } from "../../src/db/sqlite-repository.js";
import { ensureDatabase } from "../../src/db/ensure-database.js";
import { projects, taskEvents, taskReviews } from "../../src/db/schema.js";

const temporaryProjects: string[] = [];

function createTemporaryProject(): string {
  const projectRoot = path.join(os.tmpdir(), `milestack-review-records-${randomUUID()}`);
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
      goal: "Keep review records verifiable",
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

function createReadyTask(
  service: TaskService,
  overrides: {
    title?: string;
    acceptanceCriteria?: string[];
    riskLevel?: "low" | "medium" | "high";
  } = {},
) {
  return service.createTask({
    projectId: "project-1",
    title: overrides.title ?? "Structured review task",
    objective: "Return phase context and structured records",
    acceptanceCriteria:
      overrides.acceptanceCriteria ?? ["First criterion", "Second criterion"],
    riskLevel: overrides.riskLevel ?? "medium",
    createdBy: "developer",
    status: "ready",
    queuePosition: 1,
  });
}

function criterionResult(
  criterion: string,
  status: "met" | "not_met" | "unverifiable",
) {
  return {
    criterion,
    status,
    evidence:
      status === "met"
        ? [{ command: `check ${criterion}`, result: "passed" }]
        : [],
  };
}

function finding(issue: string) {
  return {
    issue,
    suggestion: `Fix ${issue}`,
    severity: "medium" as const,
    trigger: `Trigger for ${issue}`,
    impact: `Impact of ${issue}`,
    evidence: `Evidence for ${issue}`,
  };
}

afterEach(() => {
  for (const projectRoot of temporaryProjects.splice(0)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

describe("structured delivery and review records", () => {
  it("returns only the context of the current phase and drops closed findings", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const task = createReadyTask(service);
    const taskId = task.task.id;

    const initial = service.getTask({ projectId: "project-1", taskId });
    expect(initial.phase).toBe("implementation");
    expect(initial.task.objective).toBe("Return phase context and structured records");
    expect(initial.task.acceptanceCriteria).toEqual([
      "First criterion",
      "Second criterion",
    ]);
    expect(initial.currentRunEvents).toEqual([]);
    expect(initial.latestSubmission).toBeNull();
    expect(initial.previousFindings).toEqual([]);
    expect(initial.openFindings).toEqual([]);

    const run1 = service.startTask({ projectId: "project-1", taskId });
    service.updateTask({
      projectId: "project-1",
      taskId,
      runId: run1.runId,
      summary: "Round 1 progress",
      completedWork: ["Round 1 work"],
    });
    const running = service.getTask({ projectId: "project-1", taskId });
    expect(running.phase).toBe("implementation");
    expect(running.currentRunEvents.map((event) => event.type)).toEqual([
      "started",
      "progress",
    ]);

    service.submitForReview({
      projectId: "project-1",
      taskId,
      runId: run1.runId,
      commitSha: "1".repeat(40),
      branch: "main",
      summary: "Round 1 submission",
      completedWork: ["Round 1 work"],
      criteriaResults: [
        criterionResult("First criterion", "met"),
        criterionResult("Second criterion", "met"),
      ],
    });

    const inReview = service.getTask({ projectId: "project-1", taskId });
    expect(inReview.phase).toBe("review");
    expect(inReview.currentRunEvents).toEqual([]);
    expect(inReview.latestSubmission).toMatchObject({
      summary: "Round 1 submission",
      review: {
        reviewRound: 1,
        commitSha: "1".repeat(40),
        status: "pending",
      },
    });
    expect(
      inReview.latestSubmission?.criteriaResults?.map((result) => [
        result.criterion,
        result.status,
      ]),
    ).toEqual([
      ["First criterion", "met"],
      ["Second criterion", "met"],
    ]);
    expect(inReview.previousFindings).toEqual([]);
    expect(inReview.openFindings).toEqual([]);

    const full = service.getTask({ projectId: "project-1", taskId, view: "full" });
    expect(full.events.map((event) => event.type)).toEqual([
      "created",
      "started",
      "progress",
      "submitted_for_review",
    ]);
    expect(
      full.events.at(-1)?.criteriaResults?.map((result) => result.criterion),
    ).toEqual(["First criterion", "Second criterion"]);
    expect(full.reviews).toHaveLength(1);

    const review1 = service.startReview({ projectId: "project-1", taskId });
    service.completeReview({
      projectId: "project-1",
      taskId,
      reviewRunId: review1.reviewRunId,
      decision: "changes_requested",
      summary: "Round 1 findings",
      findings: [finding("First defect"), finding("Second defect")],
    });

    const rework = service.getTask({ projectId: "project-1", taskId });
    expect(rework.phase).toBe("implementation");
    expect(rework.task.acceptanceCriteria).toEqual([
      "First criterion",
      "Second criterion",
    ]);
    expect(
      rework.openFindings.map((open) => [
        open.reviewRound,
        open.findingIndex,
        open.issue,
        open.closureStatus,
      ]),
    ).toEqual([
      [1, 0, "First defect", null],
      [1, 1, "Second defect", null],
    ]);
    expect(rework.openFindings[0]).toMatchObject({
      trigger: "Trigger for First defect",
      impact: "Impact of First defect",
      evidence: "Evidence for First defect",
    });

    const run2 = service.startTask({ projectId: "project-1", taskId });
    service.submitForReview({
      projectId: "project-1",
      taskId,
      runId: run2.runId,
      commitSha: "2".repeat(40),
      summary: "Round 2 submission",
      criteriaResults: [
        criterionResult("First criterion", "met"),
        criterionResult("Second criterion", "met"),
      ],
    });
    const reReview = service.getTask({ projectId: "project-1", taskId });
    expect(reReview.phase).toBe("review");
    expect(
      reReview.previousFindings.map((previous) => [
        previous.findingIndex,
        previous.issue,
      ]),
    ).toEqual([
      [0, "First defect"],
      [1, "Second defect"],
    ]);

    const review2 = service.startReview({ projectId: "project-1", taskId });
    service.completeReview({
      projectId: "project-1",
      taskId,
      reviewRunId: review2.reviewRunId,
      decision: "changes_requested",
      summary: "Round 2 findings",
      findingClosures: [
        {
          findingIndex: 0,
          status: "fixed",
          evidence: [{ command: "pnpm test", result: "passed" }],
        },
        { findingIndex: 1, status: "not_fixed", evidence: [] },
      ],
      findings: [finding("Third defect")],
    });

    const rework2 = service.getTask({ projectId: "project-1", taskId });
    expect(
      rework2.openFindings.map((open) => [
        open.findingIndex,
        open.issue,
        open.closureStatus,
      ]),
    ).toEqual([
      [1, "Second defect", "not_fixed"],
      [0, "Third defect", null],
    ]);
    expect(
      rework2.openFindings.some((open) => open.issue === "First defect"),
    ).toBe(false);

    database.close();
  });

  it("rejects submissions without exactly one evidenced result per criterion", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const task = createReadyTask(service);
    const taskId = task.task.id;
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

    expect(() => submit([criterionResult("First criterion", "met")])).toThrow(
      SubmissionCriteriaIncompleteError,
    );
    expect(() =>
      submit([
        criterionResult("First criterion", "met"),
        criterionResult("First criterion", "met"),
      ]),
    ).toThrow(SubmissionCriteriaIncompleteError);
    expect(() =>
      submit([
        criterionResult("First criterion", "met"),
        criterionResult("Unknown criterion", "met"),
      ]),
    ).toThrow(SubmissionCriteriaIncompleteError);
    expect(() =>
      submit([
        { criterion: "First criterion", status: "met", evidence: [] },
        criterionResult("Second criterion", "met"),
      ]),
    ).toThrow(/met criterion/);

    expect(() =>
      submit([
        criterionResult("First criterion", "not_met"),
        criterionResult("Second criterion", "unverifiable"),
      ]),
    ).not.toThrow();

    const review = service.startReview({ projectId: "project-1", taskId });
    expect(() =>
      service.completeReview({
        projectId: "project-1",
        taskId,
        reviewRunId: review.reviewRunId,
        decision: "passed",
        summary: "Attempting to pass an unresolved submission.",
        verificationEvidence: [{ command: "pnpm test", result: "passed" }],
      }),
    ).toThrow(ReviewCannotPassError);

    const noCriteriaTask = createReadyTask(service, {
      title: "No criteria task",
      acceptanceCriteria: [],
    });
    const noCriteriaRun = service.startTask({
      projectId: "project-1",
      taskId: noCriteriaTask.task.id,
    });
    expect(() =>
      service.submitForReview({
        projectId: "project-1",
        taskId: noCriteriaTask.task.id,
        runId: noCriteriaRun.runId,
        commitSha: "4".repeat(40),
        summary: "Submission with an unknown criterion.",
        criteriaResults: [criterionResult("Anything", "met")],
      }),
    ).toThrow(SubmissionCriteriaIncompleteError);

    database.close();
  });

  it("requires structured findings and closure of every previous finding before passing", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const task = createReadyTask(service);
    const taskId = task.task.id;
    const run1 = service.startTask({ projectId: "project-1", taskId });
    service.submitForReview({
      projectId: "project-1",
      taskId,
      runId: run1.runId,
      commitSha: "5".repeat(40),
      summary: "Round 1 submission",
      criteriaResults: [
        criterionResult("First criterion", "met"),
        criterionResult("Second criterion", "met"),
      ],
    });
    const review1 = service.startReview({ projectId: "project-1", taskId });
    const complete = (input: {
      decision: "passed" | "changes_requested";
      findings?: unknown;
      findingClosures?: unknown;
      summary?: string;
    }) =>
      service.completeReview({
        projectId: "project-1",
        taskId,
        reviewRunId: review1.reviewRunId,
        decision: input.decision,
        summary: input.summary ?? "Review under test",
        findings: input.findings,
        findingClosures: input.findingClosures,
        verificationEvidence:
          input.decision === "passed"
            ? [{ command: "pnpm test", result: "passed" }]
            : [],
      } as Parameters<typeof service.completeReview>[0]);

    expect(() =>
      complete({
        decision: "changes_requested",
        findings: [{ issue: "A", suggestion: "B", severity: "low" }],
      }),
    ).toThrow(/trigger/);
    expect(() =>
      complete({
        decision: "changes_requested",
        findings: [
          {
            issue: "A",
            suggestion: "B",
            severity: "low",
            trigger: "t",
            impact: "i",
          },
        ],
      }),
    ).toThrow(/evidence/);
    expect(() =>
      complete({
        decision: "changes_requested",
        summary: "First round cannot close previous findings.",
        findings: [finding("Defect A")],
        findingClosures: [{ findingIndex: 0, status: "fixed", evidence: [] }],
      }),
    ).toThrow(FindingClosureIncompleteError);

    service.completeReview({
      projectId: "project-1",
      taskId,
      reviewRunId: review1.reviewRunId,
      decision: "changes_requested",
      summary: "Return with two findings.",
      findings: [finding("Defect A"), finding("Defect B")],
    });

    const run2 = service.startTask({ projectId: "project-1", taskId });
    service.submitForReview({
      projectId: "project-1",
      taskId,
      runId: run2.runId,
      commitSha: "6".repeat(40),
      summary: "Round 2 submission",
      criteriaResults: [
        criterionResult("First criterion", "met"),
        criterionResult("Second criterion", "met"),
      ],
    });
    const review2 = service.startReview({ projectId: "project-1", taskId });
    const pass = (findingClosures: unknown) =>
      service.completeReview({
        projectId: "project-1",
        taskId,
        reviewRunId: review2.reviewRunId,
        decision: "passed",
        summary: "Round 2 pass attempt.",
        findingClosures,
        verificationEvidence: [{ command: "pnpm test", result: "passed" }],
      } as Parameters<typeof service.completeReview>[0]);

    expect(() =>
      pass([{ findingIndex: 0, status: "fixed", evidence: [] }]),
    ).toThrow(FindingClosureIncompleteError);
    expect(() =>
      pass([
        { findingIndex: 5, status: "fixed", evidence: [] },
        { findingIndex: 1, status: "fixed", evidence: [] },
      ]),
    ).toThrow(FindingClosureIncompleteError);
    expect(() =>
      pass([
        { findingIndex: 0, status: "fixed", evidence: [] },
        { findingIndex: 0, status: "fixed", evidence: [] },
      ]),
    ).toThrow(FindingClosureIncompleteError);
    expect(() =>
      pass([
        { findingIndex: 0, status: "fixed", evidence: [] },
        { findingIndex: 1, status: "not_fixed", evidence: [] },
      ]),
    ).toThrow(ReviewCannotPassError);
    expect(() =>
      pass([
        { findingIndex: 0, status: "fixed", evidence: [] },
        { findingIndex: 1, status: "partially_fixed", evidence: [] },
      ]),
    ).toThrow(ReviewCannotPassError);

    const passed = pass([
      {
        findingIndex: 0,
        status: "fixed",
        evidence: [{ command: "pnpm test", result: "passed" }],
      },
      { findingIndex: 1, status: "fixed", evidence: [] },
    ]);
    expect(passed.reviews.at(-1)).toMatchObject({
      status: "passed",
      findingClosures: [
        { findingIndex: 0, status: "fixed" },
        { findingIndex: 1, status: "fixed" },
      ],
    });
    expect(passed.task.status).toBe("in_review");

    database.close();
  });

  it("requires developer returns to close every previous finding and drops closed ones from rework", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const task = createReadyTask(service);
    const taskId = task.task.id;
    const run1 = service.startTask({ projectId: "project-1", taskId });
    service.submitForReview({
      projectId: "project-1",
      taskId,
      runId: run1.runId,
      commitSha: "8".repeat(40),
      summary: "Round 1 submission",
      criteriaResults: [
        criterionResult("First criterion", "met"),
        criterionResult("Second criterion", "met"),
      ],
    });
    const review1 = service.startReview({ projectId: "project-1", taskId });
    service.completeReview({
      projectId: "project-1",
      taskId,
      reviewRunId: review1.reviewRunId,
      decision: "changes_requested",
      summary: "Round 1 findings",
      findings: [
        finding("Defect A"),
        finding("Defect B"),
        finding("Defect C"),
        finding("Defect D"),
        finding("Defect E"),
      ],
    });

    const run2 = service.startTask({ projectId: "project-1", taskId });
    service.submitForReview({
      projectId: "project-1",
      taskId,
      runId: run2.runId,
      commitSha: "9".repeat(40),
      summary: "Round 2 submission",
      criteriaResults: [
        criterionResult("First criterion", "met"),
        criterionResult("Second criterion", "met"),
      ],
    });

    const developerReturn = (input: {
      feedback: string;
      findings?: unknown;
      findingClosures?: unknown;
    }) =>
      service.requestTaskChanges({
        projectId: "project-1",
        taskId,
        ...input,
      } as Parameters<typeof service.requestTaskChanges>[0]);

    expect(() =>
      developerReturn({ feedback: "Still broken." }),
    ).toThrow(FindingClosureIncompleteError);
    expect(() =>
      developerReturn({
        feedback: "Still broken.",
        findingClosures: [{ findingIndex: 0, status: "fixed", evidence: [] }],
      }),
    ).toThrow(FindingClosureIncompleteError);
    expect(() =>
      developerReturn({
        feedback: "Still broken.",
        findingClosures: [
          { findingIndex: 0, status: "fixed", evidence: [] },
          { findingIndex: 1, status: "fixed", evidence: [] },
          { findingIndex: 2, status: "fixed", evidence: [] },
          { findingIndex: 3, status: "fixed", evidence: [] },
          { findingIndex: 9, status: "fixed", evidence: [] },
        ],
      }),
    ).toThrow(FindingClosureIncompleteError);
    expect(() =>
      developerReturn({
        feedback: "Still broken.",
        findingClosures: [
          { findingIndex: 0, status: "fixed", evidence: [] },
          { findingIndex: 0, status: "fixed", evidence: [] },
          { findingIndex: 2, status: "fixed", evidence: [] },
          { findingIndex: 3, status: "fixed", evidence: [] },
          { findingIndex: 4, status: "fixed", evidence: [] },
        ],
      }),
    ).toThrow(FindingClosureIncompleteError);
    expect(() =>
      developerReturn({
        feedback: "Still broken.",
        findings: [{ issue: "Unstructured", suggestion: "Fix it", severity: "low" }],
        findingClosures: [
          { findingIndex: 0, status: "fixed", evidence: [] },
          { findingIndex: 1, status: "fixed", evidence: [] },
          { findingIndex: 2, status: "fixed", evidence: [] },
          { findingIndex: 3, status: "fixed", evidence: [] },
          { findingIndex: 4, status: "fixed", evidence: [] },
        ],
      }),
    ).toThrow(/trigger/);

    const returned = developerReturn({
      feedback: "One defect remains.",
      findings: [finding("New defect")],
      findingClosures: [
        {
          findingIndex: 0,
          status: "fixed",
          evidence: [{ command: "pnpm test", result: "passed" }],
        },
        { findingIndex: 1, status: "not_fixed", evidence: [] },
        { findingIndex: 2, status: "partially_fixed", evidence: [] },
        { findingIndex: 3, status: "unverifiable", evidence: [] },
        { findingIndex: 4, status: "invalidated", evidence: [] },
      ],
    });
    expect(returned.task).toMatchObject({ status: "ready", queuePosition: 1 });
    expect(returned.reviews.at(-1)).toMatchObject({
      status: "changes_requested",
      findingClosures: [
        { findingIndex: 0, status: "fixed" },
        { findingIndex: 1, status: "not_fixed" },
        { findingIndex: 2, status: "partially_fixed" },
        { findingIndex: 3, status: "unverifiable" },
        { findingIndex: 4, status: "invalidated" },
      ],
    });

    const rework = service.getTask({ projectId: "project-1", taskId });
    expect(rework.phase).toBe("implementation");
    expect(
      rework.openFindings.map((open) => [open.issue, open.closureStatus]),
    ).toEqual([
      ["Defect B", "not_fixed"],
      ["Defect C", "partially_fixed"],
      ["Defect D", "unverifiable"],
      ["New defect", null],
    ]);
    expect(rework.openFindings.some((open) => open.issue === "Defect A")).toBe(false);
    expect(rework.openFindings.some((open) => open.issue === "Defect E")).toBe(false);

    database.close();
  });

  it("keeps first-round developer returns closure-free and rejects unstructured findings", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const task = createReadyTask(service);
    const taskId = task.task.id;
    const run = service.startTask({ projectId: "project-1", taskId });
    service.submitForReview({
      projectId: "project-1",
      taskId,
      runId: run.runId,
      commitSha: "b".repeat(40),
      summary: "Round 1 submission",
      criteriaResults: [
        criterionResult("First criterion", "met"),
        criterionResult("Second criterion", "met"),
      ],
    });

    expect(() =>
      service.requestTaskChanges({
        projectId: "project-1",
        taskId,
        feedback: "Please rework.",
        findings: [{ issue: "Unstructured", suggestion: "Fix it", severity: "low" }],
      } as Parameters<typeof service.requestTaskChanges>[0]),
    ).toThrow(/trigger/);
    expect(() =>
      service.requestTaskChanges({
        projectId: "project-1",
        taskId,
        feedback: "Please rework.",
        findingClosures: [{ findingIndex: 0, status: "fixed", evidence: [] }],
      }),
    ).toThrow(FindingClosureIncompleteError);

    const returned = service.requestTaskChanges({
      projectId: "project-1",
      taskId,
      feedback: "Please rework.",
      findings: [finding("First defect")],
    });
    expect(returned.task).toMatchObject({ status: "ready", queuePosition: 1 });
    expect(returned.reviews.at(-1)).toMatchObject({
      status: "changes_requested",
      findingClosures: [],
    });
    const rework = service.getTask({ projectId: "project-1", taskId });
    expect(rework.openFindings.map((open) => open.issue)).toEqual(["First defect"]);

    database.close();
  });

  it("keeps pre-change submission and review JSON readable without migration", async () => {
    const { database, service } = await createService(createTemporaryProject());
    const task = createReadyTask(service);
    const taskId = task.task.id;
    const run = service.startTask({ projectId: "project-1", taskId });
    service.submitForReview({
      projectId: "project-1",
      taskId,
      runId: run.runId,
      commitSha: "7".repeat(40),
      summary: "Structured submission",
      completedWork: ["Structured work"],
      criteriaResults: [
        criterionResult("First criterion", "met"),
        criterionResult("Second criterion", "met"),
      ],
    });

    // Rewrite the stored JSON to the shapes written before this change.
    database.db
      .update(taskEvents)
      .set({ completedWork: ["Legacy completed work"] })
      .where(eq(taskEvents.taskId, taskId))
      .run();
    database.db
      .update(taskReviews)
      .set({
        findings: [
          {
            issue: "Legacy finding",
            suggestion: "Legacy suggestion",
            severity: "medium",
          },
        ],
      })
      .where(eq(taskReviews.taskId, taskId))
      .run();

    const working = service.getTask({ projectId: "project-1", taskId });
    expect(working.latestSubmission?.completedWork).toEqual([
      "Legacy completed work",
    ]);
    expect(working.latestSubmission?.criteriaResults).toBeNull();
    expect(working.latestSubmission?.review.findings).toEqual([
      {
        issue: "Legacy finding",
        suggestion: "Legacy suggestion",
        severity: "medium",
      },
    ]);

    const review = service.startReview({ projectId: "project-1", taskId });
    const passed = service.completeReview({
      projectId: "project-1",
      taskId,
      reviewRunId: review.reviewRunId,
      decision: "passed",
      summary: "A legacy submission without structured results can still pass.",
      verificationEvidence: [{ command: "pnpm test", result: "passed" }],
    });
    expect(passed.reviews.at(-1)?.status).toBe("passed");

    database.db
      .update(taskReviews)
      .set({
        findings: [
          {
            issue: "Legacy finding",
            suggestion: "Legacy suggestion",
            severity: "medium",
          },
        ],
      })
      .where(eq(taskReviews.taskId, taskId))
      .run();

    const full = service.getTask({ projectId: "project-1", taskId, view: "full" });
    const submissionEvent = full.events
      .filter((event) => event.type === "submitted_for_review")
      .at(-1);
    expect(submissionEvent?.completedWork).toEqual(["Legacy completed work"]);
    expect(submissionEvent?.criteriaResults).toBeNull();
    expect(full.reviews.at(-1)?.findings).toEqual([
      {
        issue: "Legacy finding",
        suggestion: "Legacy suggestion",
        severity: "medium",
      },
    ]);
    expect(full.reviews.at(-1)?.findingClosures).toEqual([]);

    database.close();
  });
});
