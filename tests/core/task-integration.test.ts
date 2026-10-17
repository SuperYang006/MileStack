import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { IntegrationCheckStaleError, InvalidTaskStateError, ReviewRunOwnershipError } from "../../src/core/errors.js";
import { TaskService } from "../../src/core/task-service.js";
import { ensureDatabase } from "../../src/db/ensure-database.js";
import { createSqliteRepository } from "../../src/db/sqlite-repository.js";
import { projects } from "../../src/db/schema.js";
import { GitIntegrationChecker } from "../../src/git/integration-checker.js";

const temporaryProjects: string[] = [];

function git(projectRoot: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).trim();
}

function commitFile(projectRoot: string, filename: string, content: string, message: string): string {
  writeFileSync(path.join(projectRoot, filename), content);
  git(projectRoot, "add", filename);
  git(projectRoot, "commit", "-m", message);
  return git(projectRoot, "rev-parse", "HEAD");
}

async function createGitProject() {
  const projectRoot = path.join(os.tmpdir(), `milestack-integration-${randomUUID()}`);
  mkdirSync(projectRoot, { recursive: true });
  temporaryProjects.push(projectRoot);
  git(projectRoot, "init", "-b", "main");
  git(projectRoot, "config", "user.name", "MileStack Test");
  git(projectRoot, "config", "user.email", "milestack-test@example.invalid");
  git(projectRoot, "config", "core.hooksPath", "/dev/null");
  commitFile(projectRoot, "README.md", "temporary integration fixture\n", "initial commit");

  const database = await ensureDatabase(projectRoot);
  database.db.insert(projects).values({
    id: "project-1",
    name: "temporary integration fixture",
    rootPath: projectRoot,
    goal: null,
    createdAt: "2026-10-17T00:00:00.000Z",
    updatedAt: "2026-10-17T00:00:00.000Z",
  }).run();
  const service = new TaskService(createSqliteRepository(database), {
    generateId: randomUUID,
    integrationChecker: new GitIntegrationChecker(projectRoot),
  });
  return { projectRoot, database, service };
}

async function submitForReview(
  service: TaskService,
  taskId: string,
  commitSha: string,
  branch: string,
) {
  const started = service.startTask({ projectId: "project-1", taskId });
  service.submitForReview({
    projectId: "project-1",
    taskId,
    runId: started.runId,
    commitSha,
    branch,
    summary: "Implementation is ready for review.",
    completedWork: ["Created the fixed local review commit."],
  });
  const review = service.startReview({ projectId: "project-1", taskId });
  return service.completeReview({
    projectId: "project-1",
    taskId,
    reviewRunId: review.reviewRunId,
    decision: "passed",
    summary: "The implementation and verification evidence pass.",
    findings: [],
    verificationEvidence: [{ command: "pnpm typecheck", result: "passed" }],
  });
}

afterEach(() => {
  for (const projectRoot of temporaryProjects.splice(0)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

describe("TaskService local integration completion gate", () => {
  it("keeps approval pending until the fixed commit reaches local main and then unblocks dependents", async () => {
    const { projectRoot, database, service } = await createGitProject();
    try {
      const prerequisite = service.createTask({
        projectId: "project-1",
        title: "Integrate prerequisite",
        riskLevel: "low",
        createdBy: "developer",
      });
      const dependent = service.createTask({
        projectId: "project-1",
        title: "Wait for prerequisite",
        dependencyIds: [prerequisite.task.id],
        createdBy: "developer",
      });

      git(projectRoot, "checkout", "-b", "feature/prerequisite");
      const reviewedCommit = commitFile(projectRoot, "feature.txt", "reviewed work\n", "feature commit");
      const passed = await submitForReview(service, prerequisite.task.id, reviewedCommit, "feature/prerequisite");

      expect(passed.task.status).toBe("in_review");
      expect(passed.reviews?.at(-1)).toMatchObject({
        status: "passed",
        integrationStatus: "not_integrated",
        integrationTargetBranch: "main",
        commitSha: reviewedCommit,
      });
      expect(service.getProjectStatus({ projectId: "project-1", view: "full" }).next.find((task) => task.id === dependent.task.id)?.waitingFor)
        .toEqual([{ id: prerequisite.task.id, title: prerequisite.task.title, status: "in_review" }]);

      git(projectRoot, "checkout", "main");
      git(projectRoot, "merge", "--ff-only", "feature/prerequisite");
      git(projectRoot, "branch", "-d", "feature/prerequisite");
      const integrated = service.checkTaskIntegration({
        projectId: "project-1",
        taskId: prerequisite.task.id,
        expectedReviewId: passed.reviews!.at(-1)!.id,
      });

      expect(integrated.task.status).toBe("completed");
      expect(integrated.reviews?.at(-1)).toMatchObject({
        integrationStatus: "integrated",
        integrationTargetCommitSha: reviewedCommit,
      });
      expect(integrated.events.filter((event) => event.type === "completed")).toHaveLength(1);
      const repeated = service.checkTaskIntegration({
        projectId: "project-1",
        taskId: prerequisite.task.id,
        expectedReviewId: passed.reviews!.at(-1)!.id,
      });
      expect(repeated.events.filter((event) => event.type === "completed")).toHaveLength(1);
      const unblocked = service.getProjectStatus({ projectId: "project-1", view: "full" }).next
        .find((task) => task.id === dependent.task.id);
      expect(unblocked?.waitingFor).toEqual([]);
      expect(unblocked?.runnable).toBe(true);
    } finally {
      database.close();
    }
  });

  it("does not let integration replace high-risk approval or let a later review reuse old facts", async () => {
    const { projectRoot, database, service } = await createGitProject();
    try {
      const task = service.createTask({
        projectId: "project-1",
        title: "High-risk change",
        riskLevel: "high",
        createdBy: "developer",
      });
      git(projectRoot, "checkout", "-b", "feature/high-risk");
      const firstCommit = commitFile(projectRoot, "high-risk.txt", "round one\n", "high-risk round one");
      const firstPassed = await submitForReview(service, task.task.id, firstCommit, "feature/high-risk");
      const firstReviewId = firstPassed.reviews!.at(-1)!.id;

      git(projectRoot, "checkout", "main");
      git(projectRoot, "merge", "--ff-only", "feature/high-risk");
      expect(() => service.checkTaskIntegration({
        projectId: "project-1",
        taskId: task.task.id,
        expectedReviewId: firstReviewId,
      })).toThrow(InvalidTaskStateError);
      expect(service.getTask({ projectId: "project-1", taskId: task.task.id, view: "full" }).task.status)
        .toBe("in_review");

      const approved = service.approveTask({ projectId: "project-1", taskId: task.task.id });
      expect(approved.task.status).toBe("completed");
      expect(approved.reviews?.at(-1)?.approvedAt).toBeTruthy();

      service.reopenTask({ projectId: "project-1", taskId: task.task.id, reason: "A second delivery round is needed." });
      git(projectRoot, "checkout", "-b", "feature/high-risk-round-two");
      const secondCommit = commitFile(projectRoot, "high-risk.txt", "round two\n", "high-risk round two");
      const secondPassed = await submitForReview(service, task.task.id, secondCommit, "feature/high-risk-round-two");
      const secondReview = secondPassed.reviews!.at(-1)!;

      expect(secondReview.id).not.toBe(firstReviewId);
      expect(secondReview).toMatchObject({
        status: "passed",
        approvedAt: null,
        approvedBy: null,
        integrationStatus: "not_integrated",
        integrationTargetCommitSha: git(projectRoot, "rev-parse", "main"),
      });
      expect(() => service.checkTaskIntegration({
        projectId: "project-1",
        taskId: task.task.id,
        expectedReviewId: firstReviewId,
      })).toThrow(IntegrationCheckStaleError);
      expect(service.getTask({ projectId: "project-1", taskId: task.task.id, view: "full" }).task.status)
        .toBe("in_review");
    } finally {
      database.close();
    }
  });

  it("rechecks the target branch if integrated evidence becomes stale before developer approval", async () => {
    const { projectRoot, database, service } = await createGitProject();
    try {
      const task = service.createTask({
        projectId: "project-1",
        title: "Recheck stale integration evidence",
        riskLevel: "high",
        createdBy: "developer",
      });
      const dependent = service.createTask({
        projectId: "project-1",
        title: "Wait for current integration proof",
        dependencyIds: [task.task.id],
        createdBy: "developer",
      });
      const baselineCommit = git(projectRoot, "rev-parse", "main");
      git(projectRoot, "checkout", "-b", "feature/stale-integration-evidence");
      const reviewedCommit = commitFile(
        projectRoot,
        "reviewed.txt",
        "reviewed work\n",
        "reviewed work",
      );
      git(projectRoot, "checkout", "main");
      git(projectRoot, "merge", "--ff-only", "feature/stale-integration-evidence");

      const passed = await submitForReview(
        service,
        task.task.id,
        reviewedCommit,
        "feature/stale-integration-evidence",
      );
      const review = passed.reviews!.at(-1)!;
      expect(passed.task.status).toBe("in_review");
      expect(review).toMatchObject({
        status: "passed",
        approvedAt: null,
        integrationStatus: "integrated",
        integrationTargetCommitSha: reviewedCommit,
      });

      git(projectRoot, "reset", "--hard", baselineCommit);
      const approved = service.approveTask({ projectId: "project-1", taskId: task.task.id });
      expect(approved.task.status).toBe("in_review");
      expect(approved.reviews!.at(-1)).toMatchObject({
        approvedBy: "developer",
        integrationStatus: "not_integrated",
        integrationTargetCommitSha: baselineCommit,
      });
      expect(service.getProjectStatus({ projectId: "project-1", view: "full" }).next
        .find((candidate) => candidate.id === dependent.task.id))
        .toMatchObject({
          runnable: false,
          waitingFor: [{ id: task.task.id, status: "in_review" }],
        });

      git(projectRoot, "merge", "--ff-only", "feature/stale-integration-evidence");
      git(projectRoot, "branch", "-d", "feature/stale-integration-evidence");
      const integrated = service.checkTaskIntegration({
        projectId: "project-1",
        taskId: task.task.id,
        expectedReviewId: review.id,
      });
      expect(integrated.task.status).toBe("completed");
      expect(service.getProjectStatus({ projectId: "project-1", view: "full" }).next
        .find((candidate) => candidate.id === dependent.task.id))
        .toMatchObject({ runnable: true, waitingFor: [] });
    } finally {
      database.close();
    }
  });

  it("keeps direct acceptance and revokes the active reviewer until integration is retried", async () => {
    const { projectRoot, database, service } = await createGitProject();
    try {
      const task = service.createTask({
        projectId: "project-1",
        title: "Directly accepted change",
        riskLevel: "medium",
        createdBy: "developer",
      });
      git(projectRoot, "checkout", "-b", "feature/direct-acceptance");
      const commitSha = commitFile(projectRoot, "accepted.txt", "accepted work\n", "accepted change");
      const started = service.startTask({ projectId: "project-1", taskId: task.task.id });
      service.submitForReview({
        projectId: "project-1",
        taskId: task.task.id,
        runId: started.runId,
        commitSha,
        summary: "Ready for direct developer acceptance.",
        completedWork: ["Submitted a fixed commit."],
      });
      const review = service.startReview({ projectId: "project-1", taskId: task.task.id });
      const accepted = service.waiveTaskApproval({
        projectId: "project-1",
        taskId: task.task.id,
        reason: "Developer verified the submitted artifact directly.",
      });

      expect(accepted.task.status).toBe("in_review");
      expect(accepted.task.activeReviewRunId).toBeNull();
      expect(accepted.reviews?.at(-1)).toMatchObject({
        status: "waived",
        approvedBy: "developer",
        integrationStatus: "not_integrated",
      });
      expect(() => service.completeReview({
        projectId: "project-1",
        taskId: task.task.id,
        reviewRunId: review.reviewRunId,
        decision: "passed",
        summary: "Stale reviewer conclusion.",
        findings: [],
        verificationEvidence: [{ command: "true", result: "passed" }],
      })).toThrow(ReviewRunOwnershipError);

      git(projectRoot, "checkout", "main");
      git(projectRoot, "merge", "--ff-only", "feature/direct-acceptance");
      const completed = service.checkTaskIntegration({
        projectId: "project-1",
        taskId: task.task.id,
        expectedReviewId: accepted.reviews!.at(-1)!.id,
      });
      expect(completed.task.status).toBe("completed");
      expect(completed.reviews?.at(-1)?.status).toBe("waived");
    } finally {
      database.close();
    }
  });

  it("fails closed without an integration checker", async () => {
    const { projectRoot, database } = await createGitProject();
    try {
      const service = new TaskService(createSqliteRepository(database));
      const task = service.createTask({
        projectId: "project-1",
        title: "Require a missing integration checker",
        riskLevel: "low",
        createdBy: "developer",
      });
      const commitSha = git(projectRoot, "rev-parse", "HEAD");
      const passed = await submitForReview(service, task.task.id, commitSha, "main");

      expect(passed.task.status).toBe("in_review");
      expect(passed.reviews?.at(-1)).toMatchObject({
        status: "passed",
        integrationStatus: "unavailable",
        integrationMessage: expect.stringContaining("未装配"),
      });
    } finally {
      database.close();
    }
  });

  it("discards a Git result when the frozen review target changes during the check", async () => {
    const { database } = await createGitProject();
    try {
      const repository = createSqliteRepository(database);
      let reviewId = "";
      const service = new TaskService(repository, {
        integrationChecker: {
          check: () => {
            repository.transaction((transaction) => {
              transaction.updateReview(reviewId, { integrationTargetBranch: "develop" });
            });
            return { status: "integrated", targetCommitSha: "a".repeat(40) };
          },
        },
      });
      const task = service.createTask({
        projectId: "project-1",
        title: "Invalidate a check against an old target",
        riskLevel: "low",
        createdBy: "developer",
      });
      const started = service.startTask({ projectId: "project-1", taskId: task.task.id });
      service.submitForReview({
        projectId: "project-1",
        taskId: task.task.id,
        runId: started.runId,
        commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        summary: "Target mutation review.",
      });
      const review = service.startReview({ projectId: "project-1", taskId: task.task.id });
      const pending = service.getTask({ projectId: "project-1", taskId: task.task.id, view: "full" });
      reviewId = pending.reviews!.at(-1)!.id;

      expect(() => service.completeReview({
        projectId: "project-1",
        taskId: task.task.id,
        reviewRunId: review.reviewRunId,
        decision: "passed",
        summary: "Review passed before target changed.",
        verificationEvidence: [{ command: "pnpm test", result: "passed" }],
      })).toThrow(IntegrationCheckStaleError);

      const afterStaleCheck = service.getTask({ projectId: "project-1", taskId: task.task.id, view: "full" });
      expect(afterStaleCheck.task.status).toBe("in_review");
      expect(afterStaleCheck.reviews?.at(-1)).toMatchObject({
        status: "passed",
        integrationTargetBranch: "develop",
        integrationStatus: null,
        integrationCheckedAt: null,
      });
      expect(afterStaleCheck.events.some((event) => event.type === "completed")).toBe(false);
    } finally {
      database.close();
    }
  });
});
