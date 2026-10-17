import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  projectStatusQueryKey,
  projectStatusQueryOptions,
  refreshProjectStatusAfterDeletion,
} from "../../ui/src/pages/projectStatusQuery.js";
import type { ProjectStatus, TaskSummary } from "../../ui/src/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("project status query", () => {
  it("fetches and awaits a full status refresh after task deletion", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const previousStatus: ProjectStatus = {
      project: { id: "project-1", name: "MileStack", goal: null },
      latestUpdatedAt: "2026-10-16T00:00:00.000Z",
      counts: {
        inbox: 1,
        ready: 0,
        running: 0,
        blocked: 0,
        inReview: 0,
        completed: 0,
        total: 1,
      },
      current: [],
      next: [],
      blocked: [],
      inReview: [],
      inbox: [
        {
          id: "deleted-task",
          projectId: "project-1",
          title: "Task to delete",
          status: "inbox",
          queuePosition: null,
          dependencyIds: [],
          waitingFor: [],
          runnable: false,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          updatedAt: "2026-10-16T00:00:00.000Z",
          completedAt: null,
          integrationRequired: true,
          integrationTargetBranch: "main",
          integrationNotRequiredReason: null,
        } satisfies TaskSummary,
      ],
      recentlyCompleted: [],
    };
    const updatedStatus: ProjectStatus = {
      ...previousStatus,
      latestUpdatedAt: "2026-10-17T00:00:00.001Z",
      counts: { ...previousStatus.counts, inbox: 0, total: 0 },
      inbox: [],
    };
    queryClient.setQueryData(projectStatusQueryKey, previousStatus);

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(updatedStatus), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const forceFullStatusRef = { current: false };
    const observer = new QueryObserver(queryClient, {
      ...projectStatusQueryOptions(queryClient, forceFullStatusRef),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});

    await refreshProjectStatusAfterDeletion(queryClient, forceFullStatusRef);

    expect(queryClient.getQueryData(projectStatusQueryKey)).toEqual(updatedStatus);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/status?view=full",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(forceFullStatusRef.current).toBe(false);

    unsubscribe();
    queryClient.clear();
  });
});
