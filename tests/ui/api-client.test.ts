import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../ui/src/api/client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UI API client", () => {
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
