import { describe, expect, it } from "vitest";

import {
  filterDependencyCandidates,
  parseDependencyIds,
  shortTaskId,
} from "../../ui/src/utils/dependencyPicker.js";
import type { TaskStatus, TaskSummary } from "../../ui/src/types.js";

function task(id: string, title: string, status: TaskStatus = "inbox"): TaskSummary {
  return {
    id,
    projectId: "project-1",
    title,
    status,
    queuePosition: null,
    dependencyIds: [],
    waitingFor: [],
    runnable: false,
    currentStep: null,
    nextStep: null,
    blocker: null,
    requiredAction: null,
    updatedAt: "2026-11-20T00:00:00.000Z",
    completedAt: null,
    integrationRequired: true,
    integrationTargetBranch: "main",
    integrationNotRequiredReason: null,
  };
}

const tasks = [
  task("aaaaaaaa-1111-4111-8111-111111111111", "Design the dependency picker"),
  task("bbbbbbbb-2222-4222-8222-222222222222", "Implement dashboard search", "ready"),
  task("cccccccc-3333-4333-8333-333333333333", "Draft dependency picker task"),
  task("dddddddd-4444-4444-8444-444444444444", "Review picker styles", "in_review"),
];

describe("draft dependency picker", () => {
  it("splits, trims, and de-duplicates pasted dependency ids", () => {
    expect(
      parseDependencyIds(
        " aaaaaaaa-1111-4111-8111-111111111111, bbbbbbbb-2222-4222-8222-222222222222\n" +
          "aaaaaaaa-1111-4111-8111-111111111111\n\n",
      ),
    ).toEqual([
      "aaaaaaaa-1111-4111-8111-111111111111",
      "bbbbbbbb-2222-4222-8222-222222222222",
    ]);
  });

  it("excludes the edited task and already selected tasks", () => {
    const candidates = filterDependencyCandidates(tasks, {
      currentTaskId: "cccccccc-3333-4333-8333-333333333333",
      selectedIds: ["aaaaaaaa-1111-4111-8111-111111111111"],
      query: "",
    });

    expect(candidates.map((candidate) => candidate.title)).toEqual([
      "Implement dashboard search",
      "Review picker styles",
    ]);
  });

  it("searches by title and by short id", () => {
    const byTitle = filterDependencyCandidates(tasks, {
      currentTaskId: "cccccccc-3333-4333-8333-333333333333",
      selectedIds: [],
      query: "SEARCH",
    });
    const byShortId = filterDependencyCandidates(tasks, {
      currentTaskId: "cccccccc-3333-4333-8333-333333333333",
      selectedIds: [],
      query: shortTaskId("dddddddd-4444-4444-8444-444444444444"),
    });

    expect(byTitle.map((candidate) => candidate.id)).toEqual([
      "bbbbbbbb-2222-4222-8222-222222222222",
    ]);
    expect(byShortId.map((candidate) => candidate.id)).toEqual([
      "dddddddd-4444-4444-8444-444444444444",
    ]);
  });

  it("matches short ids typed with the leading # shown in the ui", () => {
    const withHash = filterDependencyCandidates(tasks, {
      currentTaskId: "cccccccc-3333-4333-8333-333333333333",
      selectedIds: [],
      query: "#" + shortTaskId("dddddddd-4444-4444-8444-444444444444"),
    });
    const hashOnly = filterDependencyCandidates(tasks, {
      currentTaskId: "cccccccc-3333-4333-8333-333333333333",
      selectedIds: [],
      query: "#",
    });

    expect(withHash.map((candidate) => candidate.id)).toEqual([
      "dddddddd-4444-4444-8444-444444444444",
    ]);
    expect(hashOnly.map((candidate) => candidate.id)).toEqual([
      "aaaaaaaa-1111-4111-8111-111111111111",
      "bbbbbbbb-2222-4222-8222-222222222222",
      "dddddddd-4444-4444-8444-444444444444",
    ]);
  });

  it("limits the visible candidate list without changing its order", () => {
    const candidates = filterDependencyCandidates(tasks, {
      currentTaskId: "cccccccc-3333-4333-8333-333333333333",
      selectedIds: [],
      query: "",
      limit: 2,
    });

    expect(candidates.map((candidate) => candidate.title)).toEqual([
      "Design the dependency picker",
      "Implement dashboard search",
    ]);
  });
});
