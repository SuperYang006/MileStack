import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHttpServer } from "../../src/server/server.js";

describe("HTTP API Server", () => {
  let tempDir: string;
  let serverInstance: Awaited<ReturnType<typeof createHttpServer>>;

  beforeEach(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "milestack-http-test-"));
    const staticDir = path.join(tempDir, "dist", "ui");
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(path.join(staticDir, "index.html"), "<h1>MileStack test UI</h1>\n");
    serverInstance = await createHttpServer({ projectRoot: tempDir, staticDir });
  });

  afterEach(async () => {
    serverInstance.context.database.close();
    await serverInstance.app.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns health status on GET /api/health", async () => {
    const res = await serverInstance.app.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });

  it("returns project summary on GET /api/project", async () => {
    const res = await serverInstance.app.inject({
      method: "GET",
      url: "/api/project",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.id).toBe(serverInstance.context.project.id);
  });

  it("serves the built UI from the root path", async () => {
    const res = await serverInstance.app.inject({
      method: "GET",
      url: "/",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.payload).toContain("MileStack test UI");
  });

  it("creates tasks via POST /api/tasks and queries status via GET /api/status", async () => {
    // 1. Create task
    const createRes = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Test Task 1",
        objective: "Testing HTTP API creation",
        status: "inbox",
        createdBy: "agent",
        actorLabel: "untrusted-model-label",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.payload);
    expect(created.task.title).toBe("Test Task 1");
    expect(created.task.createdBy).toBe("developer");
    expect(created.events[0].actorLabel).toBe("developer");

    // 2. Query status
    const statusRes = await serverInstance.app.inject({
      method: "GET",
      url: "/api/status",
    });
    expect(statusRes.statusCode).toBe(200);
    const status = JSON.parse(statusRes.payload);
    expect(status.inbox.length).toBe(1);
    expect(status.inbox[0].id).toBe(created.task.id);

    // 3. Confirm task to ready queue
    const confirmRes = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.task.id}/confirm`,
    });
    expect(confirmRes.statusCode).toBe(200);

    // 4. Verify in ready queue
    const statusAfterConfirm = await serverInstance.app.inject({
      method: "GET",
      url: "/api/status",
    });
    const afterStatus = JSON.parse(statusAfterConfirm.payload);
    expect(afterStatus.inbox.length).toBe(0);
    expect(afterStatus.next.length).toBe(1);
    expect(afterStatus.next[0].id).toBe(created.task.id);
    const confirmed = serverInstance.context.service.getTask({
      projectId: serverInstance.context.project.id,
      taskId: created.task.id,
    });
    expect(confirmed.events.at(-1)).toMatchObject({
      type: "confirmed",
      actorLabel: "developer",
    });
  });

  it("supports batch task creation via POST /api/tasks/batch", async () => {
    const batchRes = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks/batch",
      payload: {
        tasks: [
          { title: "Batch 1", status: "inbox" },
          { title: "Batch 2", status: "inbox" },
        ],
      },
    });
    expect(batchRes.statusCode).toBe(201);
    const createdList = JSON.parse(batchRes.payload);
    expect(createdList.length).toBe(2);
  });

  it("supports compact status and stable paginated task queries", async () => {
    for (let index = 0; index < 7; index += 1) {
      serverInstance.context.service.createTask({
        projectId: serverInstance.context.project.id,
        title: `Ready ${index + 1}`,
        status: "ready",
        queuePosition: index + 1,
        createdBy: "developer",
      });
    }

    const compact = await serverInstance.app.inject({
      method: "GET",
      url: "/api/status?view=compact",
    });
    expect(compact.statusCode).toBe(200);
    const compactBody = JSON.parse(compact.payload);
    expect(compactBody.view).toBe("compact");
    expect(compactBody.counts.ready).toBe(7);
    expect(compactBody.next).toHaveLength(5);
    expect(compactBody.nextRunnable.title).toBe("Ready 1");
    expect(compactBody.truncated.next).toBe(true);

    const full = await serverInstance.app.inject({
      method: "GET",
      url: "/api/status?view=full",
    });
    expect(full.statusCode).toBe(200);
    expect(JSON.parse(full.payload).next).toHaveLength(7);

    const firstPage = await serverInstance.app.inject({
      method: "GET",
      url: "/api/tasks?status=ready&limit=2",
    });
    expect(firstPage.statusCode).toBe(200);
    const firstPageBody = JSON.parse(firstPage.payload);
    expect(firstPageBody.tasks.map((task: { title: string }) => task.title)).toEqual([
      "Ready 1",
      "Ready 2",
    ]);
    expect(firstPageBody.nextCursor).toBeTruthy();

    const secondPage = await serverInstance.app.inject({
      method: "GET",
      url: `/api/tasks?status=ready&limit=2&cursor=${encodeURIComponent(firstPageBody.nextCursor)}`,
    });
    expect(secondPage.statusCode).toBe(200);
    expect(JSON.parse(secondPage.payload).tasks.map((task: { title: string }) => task.title)).toEqual([
      "Ready 3",
      "Ready 4",
    ]);
  });

  it("routes confirmation, deletion, reordering, and release through service state checks", async () => {
    const inbox = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Inbox task", status: "inbox" },
    });
    const inboxTask = JSON.parse(inbox.payload);

    const confirm = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${inboxTask.task.id}/confirm`,
    });
    expect(confirm.statusCode).toBe(200);

    const invalidRelease = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${inboxTask.task.id}/release`,
    });
    expect(invalidRelease.statusCode).toBe(400);

    const deleteInbox = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${inboxTask.task.id}/delete`,
    });
    expect(deleteInbox.statusCode).toBe(200);

    const ready = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Release me", status: "ready" },
    });
    const readyTask = JSON.parse(ready.payload);
    const started = serverInstance.context.service.startTask({
      projectId: serverInstance.context.project.id,
      taskId: readyTask.task.id,
    });
    expect(started.task.task.status).toBe("running");
    expect(started.task.events.at(-1)).toMatchObject({
      type: "started",
      actorLabel: "agent",
    });

    const release = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${readyTask.task.id}/release`,
    });
    expect(release.statusCode).toBe(200);
    const released = serverInstance.context.service.getTask({
      projectId: serverInstance.context.project.id,
      taskId: readyTask.task.id,
    });
    expect(released.task.status).toBe("ready");
    expect(released.events.at(-1)).toMatchObject({
      type: "released",
      actorLabel: "developer",
    });
  });

  it("edits an inbox task via PUT /api/tasks/:id and enforces inbox status and dependency checks", async () => {
    const ready = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Ready Pre-requisite", status: "ready" },
    });
    const readyTask = JSON.parse(ready.payload).task;

    const inbox = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Initial Draft Title",
        objective: "Initial Draft Objective",
        status: "inbox",
      },
    });
    const inboxTask = JSON.parse(inbox.payload).task;

    // Legitimate edit
    const editRes = await serverInstance.app.inject({
      method: "PUT",
      url: `/api/tasks/${inboxTask.id}`,
      payload: {
        title: "Updated Title By Developer",
        objective: "Updated Objective",
        acceptanceCriteria: ["AC 1", "AC 2"],
        dependencyIds: [readyTask.id],
      },
    });
    expect(editRes.statusCode).toBe(200);
    const edited = JSON.parse(editRes.payload);
    expect(edited.task.title).toBe("Updated Title By Developer");
    expect(edited.task.objective).toBe("Updated Objective");
    expect(edited.task.acceptanceCriteria).toEqual(["AC 1", "AC 2"]);
    expect(edited.task.dependencyIds).toEqual([readyTask.id]);
    expect(edited.task.status).toBe("inbox");
    expect(edited.events.at(-1).summary).toBe("Inbox task definition updated by developer.");

    // Reject editing non-inbox task
    const editReadyRes = await serverInstance.app.inject({
      method: "PUT",
      url: `/api/tasks/${readyTask.id}`,
      payload: { title: "Cannot Edit Ready" },
    });
    expect(editReadyRes.statusCode).toBe(400);

    // Reject non-existent task
    const editNotFound = await serverInstance.app.inject({
      method: "PUT",
      url: "/api/tasks/not-found-id",
      payload: { title: "Not Found" },
    });
    expect(editNotFound.statusCode).toBe(404);

    // Reject self dependency
    const editSelfDep = await serverInstance.app.inject({
      method: "PUT",
      url: `/api/tasks/${inboxTask.id}`,
      payload: {
        title: "Self Dep",
        dependencyIds: [inboxTask.id],
      },
    });
    expect(editSelfDep.statusCode).toBe(400);
  });

  it("returns ready tasks to inbox and safely deletes ready tasks", async () => {
    const firstRes = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "First ready", status: "ready" },
    });
    const first = JSON.parse(firstRes.payload).task;
    const secondRes = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Return to inbox",
        objective: "Preserve this content",
        status: "ready",
        dependencyIds: [first.id],
      },
    });
    const second = JSON.parse(secondRes.payload).task;

    const returnRes = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${second.id}/return-to-inbox`,
    });
    expect(returnRes.statusCode).toBe(200);

    const afterReturn = JSON.parse(
      (await serverInstance.app.inject({ method: "GET", url: "/api/status" })).payload,
    );
    expect(afterReturn.inbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: second.id, status: "inbox", queuePosition: null }),
      ]),
    );
    expect(afterReturn.next).toEqual([
      expect.objectContaining({ id: first.id, queuePosition: 1 }),
    ]);
    const returnedDetails = serverInstance.context.service.getTask({
      projectId: serverInstance.context.project.id,
      taskId: second.id,
    });
    expect(returnedDetails.task).toMatchObject({
      objective: "Preserve this content",
      dependencyIds: [first.id],
    });
    expect(returnedDetails.events.at(-1)).toMatchObject({
      type: "progress",
      summary: "Ready task returned to inbox by developer.",
    });

    const deleteReady = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${first.id}/delete`,
    });
    expect(deleteReady.statusCode).toBe(400);

    const deleteInbox = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${second.id}/delete`,
    });
    expect(deleteInbox.statusCode).toBe(200);
  });

  it("rejects deleting a ready task that is still referenced", async () => {
    const prerequisiteRes = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Referenced ready", status: "ready" },
    });
    const prerequisite = JSON.parse(prerequisiteRes.payload).task;
    const dependentRes = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Inbox dependent",
        status: "inbox",
        dependencyIds: [prerequisite.id],
      },
    });
    expect(JSON.parse(dependentRes.payload).task.dependencyIds).toEqual([prerequisite.id]);

    const deleteRes = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${prerequisite.id}/delete`,
    });
    expect(deleteRes.statusCode).toBe(400);
    expect(JSON.parse(deleteRes.payload).error).toContain(prerequisite.id);
    expect(JSON.parse(deleteRes.payload).error).toContain(
      JSON.parse(dependentRes.payload).task.id,
    );
  });

  it("supports developer review, change requests, approval, and reopening over HTTP", async () => {
    const createdRes = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Review through HTTP", status: "ready" },
    });
    const created = JSON.parse(createdRes.payload).task;
    const firstRun = serverInstance.context.service.startTask({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
    });
    serverInstance.context.service.submitForReview({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      runId: firstRun.runId,
      commitSha: "5555555555555555555555555555555555555555",
      summary: "Ready for review",
    });

    const statusInReview = JSON.parse(
      (await serverInstance.app.inject({ method: "GET", url: "/api/status" })).payload,
    );
    expect(statusInReview.inReview).toEqual([
      expect.objectContaining({ id: created.id, status: "in_review" }),
    ]);
    expect(statusInReview.recentlyCompleted).toEqual([]);

    const missingFeedback = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/request-changes`,
      payload: {},
    });
    expect(missingFeedback.statusCode).toBe(400);

    const requestChanges = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/request-changes`,
      payload: { feedback: "Please add an edge-case regression test." },
    });
    expect(requestChanges.statusCode).toBe(200);
    expect(serverInstance.context.service.getTask({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
    }).task).toMatchObject({ status: "ready", queuePosition: 1, completedAt: null });

    const secondRun = serverInstance.context.service.startTask({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
    });
    serverInstance.context.service.submitForReview({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      runId: secondRun.runId,
      commitSha: "6666666666666666666666666666666666666666",
      summary: "Updated and ready for review",
    });
    const reviewRun = serverInstance.context.service.startReview({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
    });
    serverInstance.context.service.completeReview({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      reviewRunId: reviewRun.reviewRunId,
      decision: "passed",
      summary: "AI review passed",
      verificationEvidence: [{ command: "pnpm test", result: "passed" }],
    });

    const approve = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/approve`,
    });
    expect(approve.statusCode).toBe(200);
    expect(serverInstance.context.service.getTask({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
    }).task).toMatchObject({ status: "completed" });

    const missingReason = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/reopen`,
      payload: {},
    });
    expect(missingReason.statusCode).toBe(400);

    const reopen = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/reopen`,
      payload: { reason: "Need a performance note before final sign-off." },
    });
    expect(reopen.statusCode).toBe(200);
    const reopened = serverInstance.context.service.getTask({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
    });
    expect(reopened.task).toMatchObject({
      status: "ready",
      queuePosition: 1,
      completedAt: null,
    });
    expect(reopened.events.at(-1)).toMatchObject({
      type: "reopened",
      summary: "Need a performance note before final sign-off.",
    });
  });
});
