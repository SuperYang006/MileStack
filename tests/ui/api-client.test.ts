import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../ui/src/api/client.js";
import { isSemverVersion } from "../../ui/src/runtime-version.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UI API client", () => {
  it("returns null for an unchanged status response and sends since", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 304 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiClient.getProjectStatus("project-1", "2026-10-13T00:00:00.000Z"),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/status?view=full&projectId=project-1&since=2026-10-13T00%3A00%3A00.000Z",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("keeps the service online when a healthy response carries no usable version", async () => {
    const respondWith = (body: unknown): void => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
    };

    respondWith({ status: "ok", timestamp: "2026-10-13T00:00:00.000Z" });
    await expect(apiClient.getRuntimeHealth()).resolves.toEqual({
      status: "ok",
      timestamp: "2026-10-13T00:00:00.000Z",
      version: null,
    });

    respondWith({ status: "ok", timestamp: "2026-10-13T00:00:00.000Z", version: "" });
    await expect(apiClient.getRuntimeHealth()).resolves.toMatchObject({ version: null });

    respondWith({ status: "ok", timestamp: "2026-10-13T00:00:00.000Z", version: "unknown" });
    const invalid = await apiClient.getRuntimeHealth();
    expect(invalid).not.toBeNull();
    expect(isSemverVersion(invalid?.version)).toBe(false);

    respondWith({ status: "ok", timestamp: "2026-10-13T00:00:00.000Z", version: "1.2.3-rc.1+build.7" });
    await expect(apiClient.getRuntimeHealth()).resolves.toMatchObject({
      version: "1.2.3-rc.1+build.7",
    });
    expect(isSemverVersion("1.2.3-rc.1+build.7")).toBe(true);
  });

  it("reports no runtime health when the endpoint is unreachable or not successful", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
    );
    await expect(apiClient.getRuntimeHealth()).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("connection refused")),
    );
    await expect(apiClient.getRuntimeHealth()).resolves.toBeNull();
  });

  it("loads completed task pages with the requested cursor and page size", async () => {
    const page = {
      status: "completed",
      tasks: [],
      nextCursor: "next-page",
      hasMore: true,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(page), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiClient.listTasks("completed", 100, "cursor-value"),
    ).resolves.toEqual(page);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks?status=completed&limit=100&cursor=cursor-value",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects when the authoritative details request cannot reach the service", async () => {
    const networkError = new TypeError("network unavailable");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(networkError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiClient.getTaskDetails("task-network-error")).rejects.toBe(
      networkError,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a non-success response instead of returning mock empty fields", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "Task details unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiClient.getTaskDetails("task-http-error", "project-1"),
    ).rejects.toThrow("Task details unavailable");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-http-error?projectId=project-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("preserves authoritative null objective and empty acceptance criteria", async () => {
    const details = {
      task: {
        id: "task-empty-definition",
        projectId: "project-1",
        title: "Intentionally minimal task",
        objective: null,
        acceptanceCriteria: [],
        status: "ready",
        queuePosition: 1,
        dependencyIds: [],
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: null,
        sourceTaskId: null,
        activeRunId: null,
        activeReviewRunId: null,
        riskLevel: "medium",
        riskConfirmed: true,
        riskConfirmedBy: "developer",
        riskConfirmedAt: "2026-10-12T00:00:00.000Z",
        createdBy: "developer",
        createdAt: "2026-10-12T00:00:00.000Z",
        updatedAt: "2026-10-12T00:00:00.000Z",
        completedAt: null,
      },
      events: [],
      reviews: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(details), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(apiClient.getTaskDetails(details.task.id)).resolves.toEqual(
      details,
    );
  });
});
