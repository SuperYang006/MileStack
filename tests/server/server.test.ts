import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createHttpServer } from "../../src/server/server.js";
import { tasks } from "../../src/db/schema.js";

const packageVersion = (
  JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as { version: string }
).version;

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

  it("returns health status and the package version on GET /api/health", async () => {
    const res = await serverInstance.app.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
    expect(body.version).toBe(packageVersion);
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

  it("reports how to build the UI when an explicit static directory is missing", async () => {
    const missingStaticDir = path.join(tempDir, "missing-ui");

    await expect(
      createHttpServer({
        projectRoot: tempDir,
        staticDir: missingStaticDir,
      }),
    ).rejects.toThrow(
      `UI build output is missing at '${missingStaticDir}'. Run 'pnpm build' before 'pnpm serve', or run 'pnpm build:ui' if the backend is already built.`,
    );
  });

  it("serves MileStack UI for an external project without mixing project data", async () => {
    const externalProjectRoot = mkdtempSync(path.join(tmpdir(), "milestack-external-http-test-"));
    const packageUiDir = path.resolve(import.meta.dirname, "../../dist/ui");
    const packageUiIndex = path.join(packageUiDir, "index.html");
    const hadPackageUiDir = existsSync(packageUiDir);
    const hadPackageUi = existsSync(packageUiIndex);
    if (!hadPackageUi) {
      mkdirSync(packageUiDir, { recursive: true });
      writeFileSync(packageUiIndex, "<h1>MileStack bundled UI fixture</h1>\n");
    }
    let externalServer: Awaited<ReturnType<typeof createHttpServer>> | undefined;

    try {
      externalServer = await createHttpServer({ projectRoot: externalProjectRoot });

      const uiRes = await externalServer.app.inject({
        method: "GET",
        url: "/",
      });
      expect(uiRes.statusCode).toBe(200);
      expect(uiRes.headers["content-type"]).toContain("text/html");

      const projectRes = await externalServer.app.inject({
        method: "GET",
        url: "/api/project",
      });
      expect(projectRes.statusCode).toBe(200);
      expect(JSON.parse(projectRes.payload).rootPath).toBe(externalProjectRoot);

      const taskRes = await externalServer.app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: {
          title: "External project task",
          status: "inbox",
        },
      });
      expect(taskRes.statusCode).toBe(201);

      const statusRes = await externalServer.app.inject({
        method: "GET",
        url: "/api/status",
      });
      expect(statusRes.statusCode).toBe(200);
      expect(JSON.parse(statusRes.payload).inbox).toEqual([
        expect.objectContaining({ title: "External project task" }),
      ]);
    } finally {
      if (externalServer) {
        externalServer.context.database.close();
        await externalServer.app.close();
      }
      rmSync(externalProjectRoot, { recursive: true, force: true });
      if (!hadPackageUi) {
        if (hadPackageUiDir) {
          rmSync(packageUiIndex, { force: true });
        } else {
          rmSync(packageUiDir, { recursive: true, force: true });
        }
      }
    }
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
      view: "full",
    });
    expect(confirmed.events.at(-1)).toMatchObject({
      type: "confirmed",
      actorLabel: "developer",
    });
  });

  it("returns 304 for an unchanged status and a full response after a task changes", async () => {
    const initial = await serverInstance.app.inject({
      method: "GET",
      url: "/api/status",
    });
    const initialBody = JSON.parse(initial.payload);
    expect(initial.statusCode).toBe(200);
    expect(initialBody.latestUpdatedAt).toBeNull();

    const created = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Status polling task", status: "inbox" },
    });
    expect(created.statusCode).toBe(201);
    const createdStatus = JSON.parse(
      (await serverInstance.app.inject({ method: "GET", url: "/api/status" })).payload,
    );
    expect(createdStatus.latestUpdatedAt).toBeTruthy();

    const unchanged = await serverInstance.app.inject({
      method: "GET",
      url: `/api/status?since=${encodeURIComponent(createdStatus.latestUpdatedAt)}`,
    });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.payload).toBe("");

    await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "New status polling task", status: "inbox" },
    });
    const changed = await serverInstance.app.inject({
      method: "GET",
      url: `/api/status?since=${encodeURIComponent(createdStatus.latestUpdatedAt)}`,
    });
    expect(changed.statusCode).toBe(200);
    expect(JSON.parse(changed.payload).inbox).toHaveLength(2);
  });

  it("returns a full status after deleting an older task with a stale since cursor", async () => {
    const olderTaskResponse = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Task to delete", status: "inbox" },
    });
    const newerTaskResponse = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Task to keep", status: "inbox" },
    });
    const olderTaskId = JSON.parse(olderTaskResponse.payload).task.id as string;
    const newerTaskId = JSON.parse(newerTaskResponse.payload).task.id as string;
    serverInstance.context.database.db
      .update(tasks)
      .set({ updatedAt: "2026-10-16T00:00:00.000Z" })
      .where(eq(tasks.id, olderTaskId))
      .run();
    serverInstance.context.database.db
      .update(tasks)
      .set({ updatedAt: "2026-10-17T00:00:00.000Z" })
      .where(eq(tasks.id, newerTaskId))
      .run();

    const beforeDelete = JSON.parse(
      (await serverInstance.app.inject({ method: "GET", url: "/api/status" })).payload,
    );
    const staleSince = beforeDelete.latestUpdatedAt as string;
    const unchanged = await serverInstance.app.inject({
      method: "GET",
      url: `/api/status?since=${encodeURIComponent(staleSince)}`,
    });
    expect(unchanged.statusCode).toBe(304);

    const deletion = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${olderTaskId}/delete`,
    });
    expect(deletion.statusCode).toBe(200);

    const changed = await serverInstance.app.inject({
      method: "GET",
      url: `/api/status?since=${encodeURIComponent(staleSince)}`,
    });
    expect(changed.statusCode).toBe(200);
    expect(JSON.parse(changed.payload).inbox).toEqual([
      expect.objectContaining({ id: newerTaskId }),
    ]);
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
    const fullBody = JSON.parse(full.payload);
    expect(fullBody.next).toHaveLength(7);
    expect(fullBody.counts).toMatchObject({ ready: 7, completed: 0, total: 7 });

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
      view: "full",
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
      view: "full",
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
    serverInstance.context.service.setTaskIntegrationPolicy({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      integrationRequired: false,
      integrationTargetBranch: "main",
      integrationNotRequiredReason: "This HTTP test isolates review lifecycle behavior.",
    });
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
      expect.objectContaining({
        id: created.id,
        status: "in_review",
        latestReview: expect.objectContaining({
          status: "pending",
          reviewRound: 1,
          commitSha: "5555555555555555555555555555555555555555",
          summary: null,
          acceptanceCriteriaCount: 0,
          verificationEvidenceCount: 0,
          findingsCount: 0,
        }),
      }),
    ]);
    // Collapsed queue cards read only the digest; full evidence and findings stay in task details.
    expect(statusInReview.inReview[0].latestReview).not.toHaveProperty("findings");
    expect(statusInReview.inReview[0].latestReview).not.toHaveProperty(
      "verificationEvidence",
    );
    expect(statusInReview.recentlyCompleted).toEqual([]);

    const fullDetailsResponse = await serverInstance.app.inject({
      method: "GET",
      url: `/api/tasks/${created.id}`,
    });
    expect(fullDetailsResponse.statusCode).toBe(200);
    expect(JSON.parse(fullDetailsResponse.payload)).toMatchObject({
      reviews: [expect.objectContaining({ status: "pending" })],
    });
    expect(
      JSON.parse(fullDetailsResponse.payload).events.map(
        (event: { type: string }) => event.type,
      ),
    ).toEqual(["created", "progress", "started", "submitted_for_review"]);

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
      view: "full",
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

    const passedStatus = JSON.parse(
      (await serverInstance.app.inject({ method: "GET", url: "/api/status" })).payload,
    );
    expect(passedStatus.inReview).toEqual([
      expect.objectContaining({
        id: created.id,
        latestReview: expect.objectContaining({
          status: "passed",
          reviewRound: 2,
          commitSha: "6666666666666666666666666666666666666666",
          summary: "AI review passed",
          verificationEvidenceCount: 1,
          findingsCount: 0,
        }),
      }),
    ]);

    const approve = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/approve`,
    });
    expect(approve.statusCode).toBe(200);
    expect(serverInstance.context.service.getTask({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      view: "full",
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
      view: "full",
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

  it("handles risk level setting in creation/edit and enforces risk-based review workflow", async () => {
    // 1. Create inbox task with default riskLevel (medium)
    const createRes = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Task with Risk",
        status: "inbox",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.payload).task;
    expect(created.riskLevel).toBe("medium");
    expect(created.riskConfirmed).toBe(false);

    // 2. Edit inbox task to low riskLevel
    const editRes = await serverInstance.app.inject({
      method: "PUT",
      url: `/api/tasks/${created.id}`,
      payload: {
        title: "Task with Updated Risk",
        riskLevel: "low",
      },
    });
    expect(editRes.statusCode).toBe(200);
    const edited = JSON.parse(editRes.payload).task;
    expect(edited.riskLevel).toBe("low");

    // 3. Confirm task and verify risk level is confirmed
    const confirmRes = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/confirm`,
      payload: {
        riskLevel: "low",
      },
    });
    expect(confirmRes.statusCode).toBe(200);
    const confirmed = serverInstance.context.service.getTask({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      view: "full",
    });
    expect(confirmed.task.riskLevel).toBe("low");
    expect(confirmed.task.riskConfirmed).toBe(true);

    serverInstance.context.service.setTaskIntegrationPolicy({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      integrationRequired: false,
      integrationTargetBranch: "main",
      integrationNotRequiredReason: "This HTTP test isolates the low-risk review policy.",
    });

    // 4. Start task, submit for review, start AI review, and complete review with pass
    const run = serverInstance.context.service.startTask({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
    });
    serverInstance.context.service.submitForReview({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      runId: run.runId,
      commitSha: "1111111111111111111111111111111111111111",
      summary: "Low risk implementation ready",
    });

    const startRevRes = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/start-review`,
      payload: { actorLabel: "agent/ai-reviewer" },
    });
    expect(startRevRes.statusCode).toBe(200);
    const revRunId = JSON.parse(startRevRes.payload).reviewRunId;

    // Complete review: for low risk, this should automatically complete the task
    const completeRevRes = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/complete-review`,
      payload: {
        reviewRunId: revRunId,
        decision: "passed",
        summary: "All verification checks pass",
        verificationEvidence: [{ command: "pnpm test", result: "all 12 tests passed" }],
      },
    });
    expect(completeRevRes.statusCode).toBe(200);
    const autoCompleted = serverInstance.context.service.getTask({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      view: "full",
    });
    expect(autoCompleted.task.status).toBe("completed");
    expect(autoCompleted.events.some((event: any) => event.type === "completed")).toBe(true);
    expect(autoCompleted.reviews[0]?.verificationEvidence[0]?.command).toBe("pnpm test");
    expect(autoCompleted.reviews[0]?.reviewerActorLabel).toBe("agent/ai-reviewer");
  });

  it("lets the developer waive an unfinished review over HTTP", async () => {
    const createdRes = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Waive over HTTP", status: "ready" },
    });
    const created = JSON.parse(createdRes.payload).task;
    serverInstance.context.service.setTaskIntegrationPolicy({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      integrationRequired: false,
      integrationTargetBranch: "main",
      integrationNotRequiredReason: "This HTTP test isolates direct acceptance behavior.",
    });
    const run = serverInstance.context.service.startTask({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
    });
    serverInstance.context.service.submitForReview({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      runId: run.runId,
      commitSha: "7777777777777777777777777777777777777777",
      summary: "Ready for review",
    });

    const missingReason = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/waive-approval`,
      payload: {},
    });
    expect(missingReason.statusCode).toBe(400);

    const waived = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/waive-approval`,
      payload: { reason: "Reviewed the artifact directly." },
    });
    expect(waived.statusCode).toBe(200);

    const details = serverInstance.context.service.getTask({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      view: "full",
    });
    expect(details.task.status).toBe("completed");
    expect(details.task.activeReviewRunId).toBeNull();
    expect(details.reviews[0]).toMatchObject({
      status: "waived",
      reviewerActorLabel: "developer",
    });
    expect(details.reviews[0]?.verificationEvidence).toEqual([]);
    expect(details.events.find((event: any) => event.type === "approved")?.summary)
      .toContain("Reviewed the artifact directly.");

    const statusAfterWaiver = JSON.parse(
      (await serverInstance.app.inject({ method: "GET", url: "/api/status" })).payload,
    );
    expect(
      statusAfterWaiver.recentlyCompleted.some(
        (task: { id: string }) => task.id === created.id,
      ),
    ).toBe(true);
    expect(
      statusAfterWaiver.inReview.some((task: { id: string }) => task.id === created.id),
    ).toBe(false);

    const secondWaiver = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/waive-approval`,
      payload: { reason: "Already completed." },
    });
    expect(secondWaiver.statusCode).toBe(400);
  });

  it("keeps approval after an unavailable local check and retries without approving twice", async () => {
    const createdResponse = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Retry local integration", status: "ready", riskLevel: "high" },
    });
    const created = JSON.parse(createdResponse.payload).task;
    const run = serverInstance.context.service.startTask({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
    });
    serverInstance.context.service.submitForReview({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      runId: run.runId,
      commitSha: "8888888888888888888888888888888888888888",
      summary: "Ready for a high-risk review.",
    });
    const reviewRun = serverInstance.context.service.startReview({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
    });
    const passed = serverInstance.context.service.completeReview({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      reviewRunId: reviewRun.reviewRunId,
      decision: "passed",
      summary: "Review passed.",
      verificationEvidence: [{ command: "pnpm test", result: "passed" }],
    });
    const reviewId = passed.reviews[0]!.id;

    const prematureCheck = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/check-integration`,
      payload: { expectedReviewId: reviewId },
    });
    expect(prematureCheck.statusCode).toBe(400);

    const approval = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/approve`,
    });
    expect(approval.statusCode).toBe(200);

    const firstCheck = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/check-integration`,
      payload: { expectedReviewId: reviewId },
    });
    expect(firstCheck.statusCode).toBe(200);
    expect(JSON.parse(firstCheck.payload).task.status).toBe("in_review");
    const afterFirstCheck = serverInstance.context.service.getTask({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      view: "full",
    });
    expect(afterFirstCheck.reviews.at(-1)).toMatchObject({
      approvedBy: "developer",
      integrationRequired: true,
      integrationStatus: "unavailable",
    });
    expect(afterFirstCheck.events.filter((event) => event.type === "approved")).toHaveLength(1);

    const retry = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/check-integration`,
      payload: { expectedReviewId: reviewId },
    });
    expect(retry.statusCode).toBe(200);
    expect(JSON.parse(retry.payload).task.status).toBe("in_review");
    const afterRetry = serverInstance.context.service.getTask({
      projectId: serverInstance.context.project.id,
      taskId: created.id,
      view: "full",
    });
    expect(afterRetry.events.filter((event) => event.type === "approved")).toHaveLength(1);
    expect(afterRetry.events.filter((event) => event.type === "completed")).toHaveLength(0);
  });

  it("allows developers to set a different local branch or document that integration is not required", async () => {
    const createdResponse = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Configure local delivery", status: "ready" },
    });
    const created = JSON.parse(createdResponse.payload).task;
    expect(created).toMatchObject({
      integrationRequired: true,
      integrationTargetBranch: "main",
      integrationNotRequiredReason: null,
    });

    const policy = await serverInstance.app.inject({
      method: "POST",
      url: `/api/tasks/${created.id}/integration-policy`,
      payload: {
        integrationRequired: false,
        integrationTargetBranch: "develop",
        integrationNotRequiredReason: "This task only documents external behavior.",
      },
    });
    expect(policy.statusCode).toBe(200);
    expect(JSON.parse(policy.payload).task).toMatchObject({
      integrationRequired: false,
      integrationTargetBranch: "develop",
      integrationNotRequiredReason: "This task only documents external behavior.",
    });
  });
});
