import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHttpServer } from "../../src/server/server.js";

describe("HTTP API Server", () => {
  let tempDir: string;
  let serverInstance: Awaited<ReturnType<typeof createHttpServer>>;

  beforeEach(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "milestack-http-test-"));
    serverInstance = await createHttpServer({ projectRoot: tempDir });
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

  it("creates tasks via POST /api/tasks and queries status via GET /api/status", async () => {
    // 1. Create task
    const createRes = await serverInstance.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Test Task 1",
        objective: "Testing HTTP API creation",
        status: "inbox",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.payload);
    expect(created.task.title).toBe("Test Task 1");

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
    expect(deleteInbox.statusCode).toBe(400);

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
    expect(released.events.at(-1)?.type).toBe("released");
  });
});
