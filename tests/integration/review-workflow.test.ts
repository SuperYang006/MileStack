import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../../src/mcp/server.js";
import type { StartedReview, StartedTask } from "../../src/core/task-service.js";
import type { TaskDetails } from "../../src/core/query-contract.js";
import {
  createHttpServer,
  type HttpServerOptions,
} from "../../src/server/server.js";
import { openProjectContext } from "../../src/project/project-context.js";

type HttpHarness = Awaited<ReturnType<typeof createHttpServer>> & {
  projectRoot: string;
};

type InMemoryMcpConnection = {
  client: Client;
  context: Awaited<ReturnType<typeof openProjectContext>>;
  server: ReturnType<typeof createMcpServer>;
};

function git(projectRoot: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).trim();
}

function commitFile(projectRoot: string, filename: string, content: string, message: string): string {
  writeFileSync(path.join(projectRoot, filename), content);
  git(projectRoot, "add", filename);
  git(projectRoot, "commit", "-m", message);
  return git(projectRoot, "rev-parse", "HEAD");
}

const httpHarnesses: HttpHarness[] = [];
const inMemoryConnections: InMemoryMcpConnection[] = [];
const stdioClients: Client[] = [];

function textContent(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result)) {
    throw new Error("MCP result did not contain content.");
  }
  const content = Array.isArray(result.content) ? result.content[0] : undefined;
  if (
    !content ||
    typeof content !== "object" ||
    !("type" in content) ||
    content.type !== "text" ||
    !("text" in content) ||
    typeof content.text !== "string"
  ) {
    throw new Error("MCP result did not contain text content.");
  }
  return content.text;
}

async function callMcp<T>(
  client: Client,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<T> {
  const result = await client.callTool({ name, arguments: arguments_ });
  if (result.isError) {
    throw new Error(textContent(result));
  }
  return JSON.parse(textContent(result)) as T;
}

function createTemporaryProject(): string {
  const projectRoot = path.join(os.tmpdir(), `milestack-review-integration-${randomUUID()}`);
  mkdirSync(path.join(projectRoot, "dist", "ui"), { recursive: true });
  writeFileSync(path.join(projectRoot, "dist", "ui", "index.html"), "<h1>test</h1>\n");
  return projectRoot;
}

async function createHttpHarness(): Promise<HttpHarness> {
  const projectRoot = createTemporaryProject();
  const options: HttpServerOptions = {
    projectRoot,
    staticDir: path.join(projectRoot, "dist", "ui"),
  };
  const server = await createHttpServer(options);
  const harness = { ...server, projectRoot };
  httpHarnesses.push(harness);
  return harness;
}

async function connectInMemoryMcp(
  projectRoot: string,
  name: string,
): Promise<Client> {
  const context = await openProjectContext(projectRoot);
  const server = createMcpServer(context);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name, version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  inMemoryConnections.push({ client, context, server });
  return client;
}

async function connectStdioMcp(projectRoot: string): Promise<Client> {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const tsxLoader = path.join(
    repositoryRoot,
    "node_modules",
    ".pnpm",
    "node_modules",
    "tsx",
    "dist",
    "loader.mjs",
  );
  expect(existsSync(tsxLoader)).toBe(true);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--import",
      tsxLoader,
      "src/cli/index.ts",
      "mcp",
      "--project",
      projectRoot,
    ],
    cwd: repositoryRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "review-integration-stdio", version: "1.0.0" });
  await client.connect(transport);
  stdioClients.push(client);
  return client;
}

async function getHttpTask(harness: HttpHarness, taskId: string): Promise<TaskDetails> {
  const response = await harness.app.inject({
    method: "GET",
    url: `/api/tasks/${taskId}`,
  });
  expect(response.statusCode).toBe(200);
  return JSON.parse(response.payload) as TaskDetails;
}

function disableIntegrationForReviewLifecycleTest(harness: HttpHarness, taskId: string): void {
  harness.context.service.setTaskIntegrationPolicy({
    projectId: harness.context.project.id,
    taskId,
    integrationRequired: false,
    integrationTargetBranch: "main",
    integrationNotRequiredReason: "This test isolates review ownership and risk policy.",
  });
}

afterEach(async () => {
  for (const client of stdioClients.splice(0)) {
    await client.close();
  }
  for (const connection of inMemoryConnections.splice(0)) {
    await connection.client.close();
    await connection.server.close();
    connection.context.database.close();
  }
  for (const harness of httpHarnesses.splice(0)) {
    await harness.app.close();
    harness.context.database.close();
    rmSync(harness.projectRoot, { recursive: true, force: true });
  }
});

describe("review workflow integration", () => {
  it("runs the local delivery gate through a real MCP process, SQLite project, HTTP API, and temporary Git repository", async () => {
    const harness = await createHttpHarness();
    const projectRoot = harness.projectRoot;
    git(projectRoot, "init", "-b", "main");
    git(projectRoot, "config", "user.name", "MileStack Test");
    git(projectRoot, "config", "user.email", "milestack-test@example.invalid");
    git(projectRoot, "config", "core.hooksPath", "/dev/null");
    git(projectRoot, "add", "dist/ui/index.html");
    git(projectRoot, "commit", "-m", "temporary project baseline");

    const createTask = async (input: {
      title: string;
      dependencyIds?: string[];
    }): Promise<TaskDetails> => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: {
          title: input.title,
          objective: "Verify local integration gates the current review round",
          acceptanceCriteria: ["Only the current approved artifact completes"],
          dependencyIds: input.dependencyIds ?? [],
          riskLevel: "medium",
          status: "ready",
        },
      });
      expect(response.statusCode).toBe(201);
      return JSON.parse(response.payload) as TaskDetails;
    };

    const submitAndPass = async (
      client: Client,
      taskId: string,
      commitSha: string,
      branch: string,
    ): Promise<TaskDetails> => {
      const started = await callMcp<StartedTask>(client, "start_task", { taskId });
      const submitted = await callMcp<TaskDetails>(client, "submit_for_review", {
        taskId,
        runId: started.runId,
        commitSha,
        branch,
        worktree: projectRoot,
        summary: "The fixed local commit is ready for review.",
        completedWork: ["Created the review commit in the temporary repository."],
      });
      const latest = submitted.reviews?.at(-1);
      if (!latest) throw new Error("Submitted task did not return its review.");
      const review = await callMcp<StartedReview>(client, "start_review", { taskId });
      return callMcp<TaskDetails>(client, "complete_review", {
        taskId,
        reviewRunId: review.reviewRunId,
        decision: "passed",
        summary: "The fixed artifact passed review.",
        verificationEvidence: [{ command: "pnpm typecheck", result: "passed" }],
      });
    };

    const prerequisite = await createTask({ title: "Integrated prerequisite" });
    const dependent = await createTask({
      title: "Dependent work",
      dependencyIds: [prerequisite.task.id],
    });
    const client = await connectStdioMcp(projectRoot);

    git(projectRoot, "checkout", "-b", "feature/prerequisite");
    const firstCommit = commitFile(projectRoot, "prerequisite.txt", "first delivery\n", "first delivery");
    const firstPassed = await submitAndPass(client, prerequisite.task.id, firstCommit, "feature/prerequisite");
    const firstReview = firstPassed.reviews!.at(-1)!;
    expect(firstPassed.task.status).toBe("in_review");
    expect(firstReview).toMatchObject({ status: "passed", integrationStatus: "not_integrated", approvedAt: null });

    const firstApproval = await harness.app.inject({
      method: "POST",
      url: `/api/tasks/${prerequisite.task.id}/approve`,
    });
    expect(firstApproval.statusCode).toBe(200);
    const approvedButUnmerged = await getHttpTask(harness, prerequisite.task.id);
    expect(approvedButUnmerged.task.status).toBe("in_review");
    expect(approvedButUnmerged.reviews?.at(-1)).toMatchObject({
      approvedBy: "developer",
      integrationStatus: "not_integrated",
    });

    git(projectRoot, "checkout", "main");
    git(projectRoot, "merge", "--ff-only", "feature/prerequisite");
    git(projectRoot, "branch", "-d", "feature/prerequisite");
    const firstIntegration = await harness.app.inject({
      method: "POST",
      url: `/api/tasks/${prerequisite.task.id}/check-integration`,
      payload: { expectedReviewId: firstReview.id },
    });
    expect(firstIntegration.statusCode).toBe(200);
    expect(JSON.parse(firstIntegration.payload).task.status).toBe("completed");

    const completedStatus = await harness.app.inject({ method: "GET", url: "/api/status?view=full" });
    const next = (JSON.parse(completedStatus.payload) as {
      next: Array<{ id: string; runnable: boolean; waitingFor: unknown[] }>;
    }).next.find((task) => task.id === dependent.task.id);
    expect(next).toMatchObject({ runnable: true, waitingFor: [] });

    const integratedButUnapproved = await createTask({ title: "Integrated but unapproved" });
    git(projectRoot, "checkout", "-b", "feature/unapproved");
    const unapprovedCommit = commitFile(projectRoot, "unapproved.txt", "reviewed\n", "reviewed unapproved change");
    git(projectRoot, "checkout", "main");
    git(projectRoot, "merge", "--ff-only", "feature/unapproved");
    git(projectRoot, "branch", "-d", "feature/unapproved");
    const unapprovedPassed = await submitAndPass(client, integratedButUnapproved.task.id, unapprovedCommit, "feature/unapproved");
    const unapprovedReview = unapprovedPassed.reviews!.at(-1)!;

    const prematureArchive = await harness.app.inject({
      method: "POST",
      url: `/api/tasks/${integratedButUnapproved.task.id}/check-integration`,
      payload: { expectedReviewId: unapprovedReview.id },
    });
    expect(prematureArchive.statusCode).toBe(400);
    expect((await getHttpTask(harness, integratedButUnapproved.task.id)).task.status).toBe("in_review");
    expect((await getHttpTask(harness, integratedButUnapproved.task.id)).reviews?.at(-1)).toMatchObject({
      approvedAt: null,
      integrationStatus: "integrated",
    });

    const secondApproval = await harness.app.inject({
      method: "POST",
      url: `/api/tasks/${integratedButUnapproved.task.id}/approve`,
    });
    expect(secondApproval.statusCode).toBe(200);
    expect((await getHttpTask(harness, integratedButUnapproved.task.id)).task.status).toBe("completed");

    const reopened = await harness.app.inject({
      method: "POST",
      url: `/api/tasks/${prerequisite.task.id}/reopen`,
      payload: { reason: "A new delivery round is required." },
    });
    expect(reopened.statusCode).toBe(200);
    git(projectRoot, "checkout", "-b", "feature/prerequisite-round-two");
    const secondCommit = commitFile(projectRoot, "prerequisite.txt", "second delivery\n", "second delivery");
    const secondPassed = await submitAndPass(client, prerequisite.task.id, secondCommit, "feature/prerequisite-round-two");
    const secondReview = secondPassed.reviews!.at(-1)!;
    expect(secondReview).toMatchObject({ status: "passed", approvedAt: null, integrationStatus: "not_integrated" });
    expect(secondReview.id).not.toBe(firstReview.id);

    const staleReviewCheck = await harness.app.inject({
      method: "POST",
      url: `/api/tasks/${prerequisite.task.id}/check-integration`,
      payload: { expectedReviewId: firstReview.id },
    });
    expect(staleReviewCheck.statusCode).toBe(409);
    const secondRoundApproval = await harness.app.inject({
      method: "POST",
      url: `/api/tasks/${prerequisite.task.id}/approve`,
    });
    expect(secondRoundApproval.statusCode).toBe(200);
    expect((await getHttpTask(harness, prerequisite.task.id)).task.status).toBe("in_review");

    git(projectRoot, "checkout", "main");
    git(projectRoot, "merge", "--ff-only", "feature/prerequisite-round-two");
    git(projectRoot, "branch", "-d", "feature/prerequisite-round-two");
    const secondIntegration = await harness.app.inject({
      method: "POST",
      url: `/api/tasks/${prerequisite.task.id}/check-integration`,
      payload: { expectedReviewId: secondReview.id },
    });
    expect(secondIntegration.statusCode).toBe(200);
    expect(JSON.parse(secondIntegration.payload).task.status).toBe("completed");
  });

  it("bridges a real stdio MCP process to HTTP over the same SQLite project", async () => {
    const harness = await createHttpHarness();
    const createdResponse = await harness.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Stdio review integration",
        objective: "Verify the complete medium-risk review boundary",
        acceptanceCriteria: ["HTTP and MCP expose the same review record"],
        status: "ready",
        riskLevel: "medium",
      },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = JSON.parse(createdResponse.payload) as TaskDetails;
    disableIntegrationForReviewLifecycleTest(harness, created.task.id);
    const client = await connectStdioMcp(harness.projectRoot);

    const started = await callMcp<StartedTask>(client, "start_task", {
      taskId: created.task.id,
      actorLabel: "stdio-implementer",
    });
    const submitted = await callMcp<TaskDetails>(client, "submit_for_review", {
      taskId: created.task.id,
      runId: started.runId,
      commitSha: "1111111111111111111111111111111111111111",
      branch: "feature/review-integration",
      worktree: harness.projectRoot,
      summary: "The implementation is ready for independent review.",
      completedWork: ["Exercised the stdio submission boundary"],
    });
    expect(submitted.task).toMatchObject({
      status: "in_review",
      riskLevel: "medium",
      activeRunId: null,
    });

    const review = await callMcp<StartedReview>(client, "start_review", {
      taskId: created.task.id,
      actorLabel: "stdio-reviewer",
    });
    const passed = await callMcp<TaskDetails>(client, "approve_review", {
      taskId: created.task.id,
      reviewRunId: review.reviewRunId,
      summary: "The submitted artifact passed independent review.",
      verificationEvidence: [
        { command: "pnpm test tests/integration/review-workflow.test.ts", result: "passed" },
      ],
    });
    expect(passed.task).toMatchObject({
      status: "in_review",
      riskLevel: "medium",
      activeReviewRunId: null,
    });
    expect(passed.reviews.at(-1)).toMatchObject({
      commitSha: "1111111111111111111111111111111111111111",
      branch: "feature/review-integration",
      worktree: harness.projectRoot,
      status: "passed",
      reviewerActorLabel: "stdio-reviewer",
      verificationEvidence: [
        { command: "pnpm test tests/integration/review-workflow.test.ts", result: "passed" },
      ],
    });

    const httpDetails = await getHttpTask(harness, created.task.id);
    expect(httpDetails).toEqual(passed);
    expect(httpDetails.events.map((event) => event.type)).toEqual([
      "created",
      "progress",
      "started",
      "submitted_for_review",
      "review_started",
      "review_passed",
    ]);

    const status = await harness.app.inject({ method: "GET", url: "/api/status" });
    expect(status.statusCode).toBe(200);
    expect(JSON.parse(status.payload)).toMatchObject({
      inReview: [expect.objectContaining({ id: created.task.id, riskLevel: "medium" })],
    });

    const developerApproval = await harness.app.inject({
      method: "POST",
      url: `/api/tasks/${created.task.id}/approve`,
    });
    expect(developerApproval.statusCode).toBe(200);
    expect((await getHttpTask(harness, created.task.id)).task.status).toBe("completed");
  });

  it("applies low, medium, and high risk policies consistently across MCP and HTTP", async () => {
    const harness = await createHttpHarness();
    const client = await connectInMemoryMcp(harness.projectRoot, "risk-policy-agent");
    const risks = [
      { riskLevel: "low" as const, commitSha: "2222222222222222222222222222222222222222" },
      { riskLevel: "medium" as const, commitSha: "3333333333333333333333333333333333333333" },
      { riskLevel: "high" as const, commitSha: "4444444444444444444444444444444444444444" },
    ];
    const taskIds: string[] = [];

    for (const risk of risks) {
      const createdResponse = await harness.app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: {
          title: `${risk.riskLevel} policy task`,
          objective: `Verify ${risk.riskLevel} completion policy`,
          acceptanceCriteria: ["Risk behavior remains deterministic"],
          status: "ready",
          riskLevel: risk.riskLevel,
        },
      });
      expect(createdResponse.statusCode).toBe(201);
      const created = JSON.parse(createdResponse.payload) as TaskDetails;
      disableIntegrationForReviewLifecycleTest(harness, created.task.id);
      taskIds.push(created.task.id);

      const started = await callMcp<StartedTask>(client, "start_task", {
        taskId: created.task.id,
      });
      const submitted = await callMcp<TaskDetails>(client, "submit_for_review", {
        taskId: created.task.id,
        runId: started.runId,
        commitSha: risk.commitSha,
        summary: `${risk.riskLevel} implementation submitted.`,
      });
      const review = await callMcp<StartedReview>(client, "start_review", {
        taskId: created.task.id,
      });
      const passed = await callMcp<TaskDetails>(client, "complete_review", {
        taskId: created.task.id,
        reviewRunId: review.reviewRunId,
        decision: "passed",
        summary: `${risk.riskLevel} review passed.`,
        verificationEvidence: [{ command: "pnpm test", result: "passed" }],
        actorLabel: "risk-reviewer",
      });

      expect(submitted.task.riskLevel).toBe(risk.riskLevel);
      expect(passed.task.riskLevel).toBe(risk.riskLevel);
      expect(passed.reviews.at(-1)).toMatchObject({
        commitSha: risk.commitSha,
        status: "passed",
        reviewerActorLabel: "risk-reviewer",
        verificationEvidence: [{ command: "pnpm test", result: "passed" }],
      });
      expect(passed.task.status).toBe(risk.riskLevel === "low" ? "completed" : "in_review");
      if (risk.riskLevel === "low") {
        expect(passed.events.at(-1)).toMatchObject({
          type: "completed",
          actorLabel: "risk-reviewer",
        });
      }
      expect((await getHttpTask(harness, created.task.id)).task).toMatchObject({
        riskLevel: risk.riskLevel,
        status: risk.riskLevel === "low" ? "completed" : "in_review",
      });

      if (risk.riskLevel !== "low") {
        const approved = await harness.app.inject({
          method: "POST",
          url: `/api/tasks/${created.task.id}/approve`,
        });
        expect(approved.statusCode).toBe(200);
        expect((await getHttpTask(harness, created.task.id)).task.status).toBe("completed");
      }
    }

    const mcpStatus = await callMcp<Record<string, unknown>>(client, "get_project_status", {
      view: "full",
    });
    const httpStatusResponse = await harness.app.inject({
      method: "GET",
      url: "/api/status?view=full",
    });
    expect(httpStatusResponse.statusCode).toBe(200);
    expect(mcpStatus).toEqual(JSON.parse(httpStatusResponse.payload));
    expect((mcpStatus.recentlyCompleted as Array<{ id: string }>).map((task) => task.id)).toEqual(
      expect.arrayContaining(taskIds),
    );
  });

  it("serializes review claims and invalidates execution and review credentials after rework", async () => {
    const harness = await createHttpHarness();
    const implementer = await connectInMemoryMcp(harness.projectRoot, "implementer");
    const reviewerA = await connectInMemoryMcp(harness.projectRoot, "reviewer-a");
    const reviewerB = await connectInMemoryMcp(harness.projectRoot, "reviewer-b");

    const createdResponse = await harness.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Concurrent review claim",
        objective: "Prove credentials are scoped to one execution and review round",
        acceptanceCriteria: ["Only one reviewer can claim a pending review"],
        status: "ready",
        riskLevel: "medium",
      },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = JSON.parse(createdResponse.payload) as TaskDetails;
    disableIntegrationForReviewLifecycleTest(harness, created.task.id);
    const started = await callMcp<StartedTask>(implementer, "start_task", {
      taskId: created.task.id,
      actorLabel: "implementer",
    });
    await callMcp<TaskDetails>(implementer, "submit_for_review", {
      taskId: created.task.id,
      runId: started.runId,
      commitSha: "5555555555555555555555555555555555555555",
      summary: "First implementation submitted.",
    });

    const claims = await Promise.all(
      [reviewerA, reviewerB].map(async (client) => ({
        client,
        result: await client.callTool({
          name: "start_review",
          arguments: { taskId: created.task.id },
        }),
      })),
    );
    const successfulClaims = claims.filter(({ result }) => result.isError !== true);
    const rejectedClaims = claims.filter(({ result }) => result.isError === true);
    expect(successfulClaims).toHaveLength(1);
    expect(rejectedClaims).toHaveLength(1);
    const winningClaim = successfulClaims[0]!;
    const review = JSON.parse(textContent(winningClaim.result)) as StartedReview;

    const requestChanges = await harness.app.inject({
      method: "POST",
      url: `/api/tasks/${created.task.id}/request-changes`,
      payload: {
        feedback: "Add a regression test for stale review credentials.",
        findings: [
          {
            issue: "The stale credential path is not covered.",
            suggestion: "Retry the old runId and reviewRunId after returning to ready.",
            severity: "medium",
          },
        ],
      },
    });
    expect(requestChanges.statusCode).toBe(200);

    const returned = await getHttpTask(harness, created.task.id);
    expect(returned.task).toMatchObject({
      status: "ready",
      activeRunId: null,
      activeReviewRunId: null,
    });
    expect(returned.task.handoffNote).toContain("stale review credentials");
    expect(returned.reviews.at(-1)).toMatchObject({
      status: "changes_requested",
      summary: expect.stringContaining("stale review credentials"),
    });

    const staleExecution = await implementer.callTool({
      name: "update_task",
      arguments: {
        taskId: created.task.id,
        runId: started.runId,
        summary: "Late update from the first execution.",
      },
    });
    expect(staleExecution.isError).toBe(true);

    const staleReview = await winningClaim.client.callTool({
      name: "complete_review",
      arguments: {
        taskId: created.task.id,
        reviewRunId: review.reviewRunId,
        decision: "passed",
        summary: "Late review conclusion.",
        verificationEvidence: [{ command: "pnpm test", result: "passed" }],
      },
    });
    expect(staleReview.isError).toBe(true);

    const reclaimer = winningClaim.client === reviewerA ? reviewerB : reviewerA;
    const restarted = await callMcp<StartedTask>(reclaimer, "start_task", {
      taskId: created.task.id,
      actorLabel: "rework-implementer",
    });
    expect(restarted.runId).not.toBe(started.runId);
    await callMcp<TaskDetails>(reclaimer, "submit_for_review", {
      taskId: created.task.id,
      runId: restarted.runId,
      commitSha: "6666666666666666666666666666666666666666",
      summary: "Reworked implementation submitted.",
    });
    const secondReview = await callMcp<StartedReview>(reclaimer, "start_review", {
      taskId: created.task.id,
    });
    const staleSecondRoundReview = await winningClaim.client.callTool({
      name: "complete_review",
      arguments: {
        taskId: created.task.id,
        reviewRunId: review.reviewRunId,
        decision: "passed",
        summary: "The first review must not conclude the second round.",
        verificationEvidence: [{ command: "pnpm test", result: "passed" }],
      },
    });
    expect(staleSecondRoundReview.isError).toBe(true);
    expect(textContent(staleSecondRoundReview)).toContain("REVIEW_RUN_OWNERSHIP");
    const passed = await callMcp<TaskDetails>(reclaimer, "complete_review", {
      taskId: created.task.id,
      reviewRunId: secondReview.reviewRunId,
      decision: "passed",
      summary: "The reworked implementation passed review.",
      verificationEvidence: [{ command: "pnpm test", result: "passed" }],
    });
    expect(passed.task.status).toBe("in_review");
    expect(passed.reviews).toHaveLength(2);
    expect(passed.reviews.at(-1)).toMatchObject({
      reviewRound: 2,
      commitSha: "6666666666666666666666666666666666666666",
      status: "passed",
    });

    const approved = await harness.app.inject({
      method: "POST",
      url: `/api/tasks/${created.task.id}/approve`,
    });
    expect(approved.statusCode).toBe(200);
    expect((await getHttpTask(harness, created.task.id)).task.status).toBe("completed");
  });
});
