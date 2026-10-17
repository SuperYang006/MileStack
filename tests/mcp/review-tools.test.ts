import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../../src/mcp/server.js";
import {
  initializeProject,
  openProjectContext,
} from "../../src/project/project-context.js";

const temporaryProjects: string[] = [];

function createTemporaryProject(): string {
  const projectRoot = path.join(os.tmpdir(), `milestack-review-mcp-${randomUUID()}`);
  mkdirSync(projectRoot, { recursive: true });
  temporaryProjects.push(projectRoot);
  return projectRoot;
}

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

afterEach(() => {
  for (const projectRoot of temporaryProjects.splice(0)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

describe("MCP review tools", () => {
  it("protects review ownership and returns requested changes to a new execution", async () => {
    const projectRoot = createTemporaryProject();
    const initialized = await initializeProject(projectRoot);
    initialized.database.close();
    const context = await openProjectContext(projectRoot);
    const ready = context.service.createTask({
      projectId: context.project.id,
      title: "Review ownership",
      createdBy: "developer",
      status: "ready",
    });
    const execution = context.service.startTask({
      projectId: context.project.id,
      taskId: ready.task.id,
      actorLabel: "implementation-model",
    });
    context.service.submitForReview({
      projectId: context.project.id,
      taskId: ready.task.id,
      runId: execution.runId,
      commitSha: "1111111111111111111111111111111111111111",
      summary: "Ready for review.",
    });

    const server = createMcpServer(context);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "review-test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const started = await client.callTool({
      name: "start_review",
      arguments: { taskId: ready.task.id, actorLabel: "review-model" },
    });
    const startedValue = JSON.parse(textContent(started));

    const concurrentClaim = await client.callTool({
      name: "start_review",
      arguments: { taskId: ready.task.id },
    });
    expect(concurrentClaim.isError).toBe(true);
    expect(textContent(concurrentClaim)).toContain("INVALID_TASK_STATE");

    const wrongOwner = await client.callTool({
      name: "approve_review",
      arguments: {
        taskId: ready.task.id,
        reviewRunId: randomUUID(),
        summary: "This credential does not own the review.",
        verificationEvidence: [{ command: "pnpm test", result: "passed" }],
      },
    });
    expect(wrongOwner.isError).toBe(true);
    expect(textContent(wrongOwner)).toContain("REVIEW_RUN_OWNERSHIP");

    const missingEvidence = await client.callTool({
      name: "approve_review",
      arguments: {
        taskId: ready.task.id,
        reviewRunId: startedValue.reviewRunId,
        summary: "Evidence was accidentally omitted.",
      },
    });
    expect(missingEvidence.isError).toBe(true);
    expect(textContent(missingEvidence)).toContain("REVIEW_EVIDENCE_INCOMPLETE");

    const unactionableChanges = await client.callTool({
      name: "request_changes",
      arguments: {
        taskId: ready.task.id,
        reviewRunId: startedValue.reviewRunId,
        summary: "This feedback does not include a concrete change.",
      },
    });
    expect(unactionableChanges.isError).toBe(true);
    expect(textContent(unactionableChanges)).toContain("INVALID_INPUT");

    const changes = await client.callTool({
      name: "request_changes",
      arguments: {
        taskId: ready.task.id,
        reviewRunId: startedValue.reviewRunId,
        summary: "Add a deterministic ownership regression test.",
        findings: [
          {
            issue: "The stale credential path is not covered.",
            suggestion: "Submit a second round and assert that the first reviewRunId fails.",
            severity: "medium",
            trigger: "An old reviewRunId is reused after the task returns to ready.",
            impact: "A stale credential could conclude the next review round.",
            evidence: "pnpm test tests/mcp/review-tools.test.ts: no stale-credential case.",
            location: "tests/mcp/review-tools.test.ts",
          },
        ],
        actorLabel: "review-model",
      },
    });
    const changesValue = JSON.parse(textContent(changes));
    expect(changesValue.task).toMatchObject({
      status: "ready",
      activeRunId: null,
      activeReviewRunId: null,
    });
    expect(changesValue.task.handoffNote).toContain("stale credential path");
    expect(changesValue.task.handoffNote).toContain("Submit a second round");
    expect(changesValue.reviews.at(-1)).toMatchObject({
      status: "changes_requested",
      reviewerActorLabel: "review-model",
    });

    const restarted = await client.callTool({
      name: "start_task",
      arguments: { taskId: ready.task.id, actorLabel: "fix-model" },
    });
    const restartedValue = JSON.parse(textContent(restarted));
    expect(restartedValue.runId).not.toBe(execution.runId);

    await client.callTool({
      name: "submit_for_review",
      arguments: {
        taskId: ready.task.id,
        runId: restartedValue.runId,
        commitSha: "2222222222222222222222222222222222222222",
        summary: "Added the requested regression test.",
      },
    });
    const secondReview = await client.callTool({
      name: "start_review",
      arguments: { taskId: ready.task.id },
    });
    const secondReviewValue = JSON.parse(textContent(secondReview));
    expect(secondReviewValue.reviewRunId).not.toBe(startedValue.reviewRunId);

    const staleCredential = await client.callTool({
      name: "approve_review",
      arguments: {
        taskId: ready.task.id,
        reviewRunId: startedValue.reviewRunId,
        summary: "Attempt with an expired credential.",
        verificationEvidence: [{ command: "pnpm test", result: "passed" }],
      },
    });
    expect(staleCredential.isError).toBe(true);
    expect(textContent(staleCredential)).toContain("REVIEW_RUN_OWNERSHIP");

    await client.close();
    await server.close();
    context.database.close();
  });

  it("automatically completes a confirmed low-risk task after approval", async () => {
    const projectRoot = createTemporaryProject();
    const initialized = await initializeProject(projectRoot);
    initialized.database.close();
    const context = await openProjectContext(projectRoot);
    const ready = context.service.createTask({
      projectId: context.project.id,
      title: "Low-risk review",
      createdBy: "developer",
      status: "ready",
      riskLevel: "low",
    });
    expect(ready.task).toMatchObject({ riskLevel: "low", riskConfirmed: true });
    context.service.setTaskIntegrationPolicy({
      projectId: context.project.id,
      taskId: ready.task.id,
      integrationRequired: false,
      integrationTargetBranch: "main",
      integrationNotRequiredReason: "This MCP test isolates the low-risk review policy.",
    });

    const server = createMcpServer(context);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "review-test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const started = JSON.parse(
      textContent(
        await client.callTool({
          name: "start_task",
          arguments: { taskId: ready.task.id },
        }),
      ),
    );
    await client.callTool({
      name: "submit_for_review",
      arguments: {
        taskId: ready.task.id,
        runId: started.runId,
        commitSha: "3333333333333333333333333333333333333333",
        summary: "Low-risk change complete.",
      },
    });
    const review = JSON.parse(
      textContent(
        await client.callTool({
          name: "start_review",
          arguments: { taskId: ready.task.id },
        }),
      ),
    );
    const approved = await client.callTool({
      name: "approve_review",
      arguments: {
        taskId: ready.task.id,
        reviewRunId: review.reviewRunId,
        summary: "Focused verification passed.",
        verificationEvidence: [{ command: "pnpm test tests/mcp", result: "passed" }],
      },
    });
    const approvedValue = JSON.parse(textContent(approved));
    expect(approvedValue.task).toMatchObject({
      status: "completed",
      activeReviewRunId: null,
    });
    expect(approvedValue.task.completedAt).toBeTruthy();
    expect(approvedValue.reviews.at(-1)).toMatchObject({
      status: "passed",
      reviewerActorLabel: "agent",
    });

    await client.close();
    await server.close();
    context.database.close();
  });

  it("uses the shared approval gate when an accepted task retries integration through MCP", async () => {
    const projectRoot = createTemporaryProject();
    const initialized = await initializeProject(projectRoot);
    initialized.database.close();
    const context = await openProjectContext(projectRoot);
    const task = context.service.createTask({
      projectId: context.project.id,
      title: "Retry integration through MCP",
      createdBy: "developer",
      status: "ready",
      riskLevel: "high",
    });
    const server = createMcpServer(context);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "integration-retry-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const started = JSON.parse(textContent(await client.callTool({
      name: "start_task",
      arguments: { taskId: task.task.id },
    })));
    await client.callTool({
      name: "submit_for_review",
      arguments: {
        taskId: task.task.id,
        runId: started.runId,
        commitSha: "9999999999999999999999999999999999999999",
        summary: "Submitted high-risk artifact.",
      },
    });
    const review = JSON.parse(textContent(await client.callTool({
      name: "start_review",
      arguments: { taskId: task.task.id },
    })));
    const passed = JSON.parse(textContent(await client.callTool({
      name: "approve_review",
      arguments: {
        taskId: task.task.id,
        reviewRunId: review.reviewRunId,
        summary: "Review passed.",
        verificationEvidence: [{ command: "pnpm test", result: "passed" }],
      },
    })));
    const expectedReviewId = passed.reviews.at(-1).id as string;
    const beforeApproval = await client.callTool({
      name: "check_task_integration",
      arguments: { taskId: task.task.id, expectedReviewId },
    });
    expect(beforeApproval.isError).toBe(true);
    expect(textContent(beforeApproval)).toContain("INVALID_TASK_STATE");

    context.service.approveTask({ projectId: context.project.id, taskId: task.task.id });
    const retry = JSON.parse(textContent(await client.callTool({
      name: "check_task_integration",
      arguments: { taskId: task.task.id, expectedReviewId },
    })));
    expect(retry.task.status).toBe("in_review");
    expect(retry.reviews.at(-1)).toMatchObject({
      approvedBy: "developer",
      integrationStatus: "unavailable",
    });
    expect(retry.events.filter((event: { type: string }) => event.type === "approved"))
      .toHaveLength(1);

    await client.close();
    await server.close();
    context.database.close();
  });
});
