import type {
  ProjectStatus,
  TaskDetails,
  CreateTaskPayload,
  TaskSummary,
  EditInboxTaskPayload,
  TaskPage,
  TaskStatus,
  RuntimeHealth,
} from "../types.js";
import { initialProjectStatus, sampleTaskDetails } from "./mock-data.js";

const STORAGE_KEY = "milestack_ui_status_data";
const DETAILS_KEY = "milestack_ui_details_data";

function loadStoredStatus(): ProjectStatus {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as ProjectStatus;
      const normalized = {
        ...stored,
        current: stored.current ?? [],
        next: stored.next ?? [],
        blocked: stored.blocked ?? [],
        inReview: stored.inReview ?? [],
        inbox: stored.inbox ?? [],
        recentlyCompleted: stored.recentlyCompleted ?? [],
      };
      return {
        ...normalized,
        counts: {
          inbox: normalized.inbox.length,
          ready: normalized.next.length,
          running: normalized.current.length,
          blocked: normalized.blocked.length,
          inReview: normalized.inReview.length,
          completed: normalized.recentlyCompleted.length,
          total:
            normalized.current.length +
            normalized.next.length +
            normalized.blocked.length +
            normalized.inReview.length +
            normalized.inbox.length +
            normalized.recentlyCompleted.length,
        },
      };
    }
  } catch {
    // fallback
  }
  return initialProjectStatus;
}

function saveStoredStatus(status: ProjectStatus) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
  } catch {
    // ignore
  }
}

function loadStoredDetails(): Record<string, TaskDetails> {
  try {
    const raw = localStorage.getItem(DETAILS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, TaskDetails>;
  } catch {
    // fallback
  }
  return sampleTaskDetails;
}

function saveStoredDetails(details: Record<string, TaskDetails>) {
  try {
    localStorage.setItem(DETAILS_KEY, JSON.stringify(details));
  } catch {
    // ignore
  }
}

let backendAvailable: boolean | null = null;

export const apiClient = {
  async getRuntimeHealth(): Promise<RuntimeHealth | null> {
    try {
      const res = await fetch("/api/health", { method: "GET", signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        const health = (await res.json()) as Partial<RuntimeHealth>;
        if (typeof health.version === "string" && health.version.length > 0) {
          backendAvailable = true;
          return {
            status: typeof health.status === "string" ? health.status : "ok",
            timestamp: typeof health.timestamp === "string" ? health.timestamp : "",
            version: health.version,
          };
        }
      }
      backendAvailable = false;
    } catch {
      backendAvailable = false;
    }
    return null;
  },

  async getProjectStatus(
    projectId?: string,
    since?: string,
  ): Promise<ProjectStatus | null> {
    try {
      const params = new URLSearchParams({ view: "full" });
      if (projectId) params.set("projectId", projectId);
      if (since) params.set("since", since);
      const url = `/api/status?${params.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status === 304) {
        backendAvailable = true;
        return null;
      }
      if (res.ok) {
        backendAvailable = true;
        return (await res.json()) as ProjectStatus;
      }
    } catch {
      backendAvailable = false;
    }

    // Mock fallback
    return loadStoredStatus();
  },

  async listTasks(
    status: TaskStatus,
    limit = 100,
    cursor?: string,
    projectId?: string,
  ): Promise<TaskPage> {
    const pageSize = Number.isFinite(limit)
      ? Math.min(Math.max(Math.trunc(limit), 1), 100)
      : 100;
    const params = new URLSearchParams({ status, limit: String(pageSize) });
    if (cursor) params.set("cursor", cursor);
    if (projectId) params.set("projectId", projectId);

    try {
      const res = await fetch(`/api/tasks?${params.toString()}`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        backendAvailable = true;
        return (await res.json()) as TaskPage;
      }
    } catch {
      backendAvailable = false;
    }

    const stored = loadStoredStatus();
    const tasksByStatus: Record<TaskStatus, TaskSummary[]> = {
      inbox: stored.inbox,
      ready: stored.next,
      running: stored.current,
      blocked: stored.blocked,
      in_review: stored.inReview,
      completed: stored.recentlyCompleted,
    };
    const allTasks = tasksByStatus[status];
    const offset = cursor?.startsWith("mock:")
      ? Number.parseInt(cursor.slice("mock:".length), 10)
      : 0;
    const startIndex = Number.isFinite(offset) && offset >= 0 ? offset : 0;
    const tasks = allTasks.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + tasks.length < allTasks.length;
    return {
      status,
      tasks,
      nextCursor: hasMore ? `mock:${startIndex + tasks.length}` : null,
      hasMore,
    };
  },

  async getTaskDetails(taskId: string, projectId?: string): Promise<TaskDetails> {
    const url = projectId
      ? `/api/tasks/${encodeURIComponent(taskId)}?projectId=${encodeURIComponent(projectId)}`
      : `/api/tasks/${encodeURIComponent(taskId)}`;

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    } catch (error) {
      backendAvailable = false;
      throw error;
    }

    backendAvailable = true;
    if (!res.ok) {
      const error: unknown = await res.json().catch(() => null);
      const message =
        typeof error === "object" &&
        error !== null &&
        "error" in error &&
        typeof error.error === "string"
          ? error.error
          : `HTTP ${res.status}`;
      throw new Error(
        message,
      );
    }

    return (await res.json()) as TaskDetails;
  },

  async createTask(payload: CreateTaskPayload, projectId?: string): Promise<TaskSummary> {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectId ? { ...payload, projectId } : payload),
      });
      if (res.ok) {
        const data = await res.json();
        return (data.task || data) as TaskSummary;
      }
    } catch {
      // fallback
    }

    const status = loadStoredStatus();
    const targetStatus = payload.status ?? "inbox";
    const newId = `task-${Date.now().toString(36)}`;
    const newSummary: TaskSummary = {
      id: newId,
      projectId: projectId || "proj_milestack",
      title: payload.title,
      status: targetStatus,
      queuePosition: targetStatus === "ready" ? status.next.length + 1 : null,
      dependencyIds: payload.dependencyIds ?? [],
      waitingFor: [],
      runnable: targetStatus === "ready",
      currentStep: null,
      nextStep: null,
      blocker: null,
      requiredAction: null,
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };

    if (targetStatus === "ready") {
      status.next.push(newSummary);
    } else {
      status.inbox.push(newSummary);
    }
    saveStoredStatus(status);

    const details = loadStoredDetails();
    details[newId] = {
      task: {
        id: newId,
        projectId: newSummary.projectId,
        title: payload.title,
        objective: payload.objective ?? null,
        acceptanceCriteria: payload.acceptanceCriteria ?? [],
        status: targetStatus,
        queuePosition: newSummary.queuePosition,
        dependencyIds: newSummary.dependencyIds,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: null,
        sourceTaskId: null,
        activeRunId: null,
        createdBy: "developer",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
      },
      events: [
        {
          id: `evt-${Date.now()}`,
          projectId: newSummary.projectId,
          taskId: newId,
          runId: null,
          type: "created",
          summary: `创建任务：${payload.title}`,
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "developer",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    saveStoredDetails(details);

    return newSummary;
  },

  async createTasks(payloads: CreateTaskPayload[], projectId?: string): Promise<TaskSummary[]> {
    try {
      const res = await fetch("/api/tasks/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectId ? { tasks: payloads, projectId } : { tasks: payloads }),
      });
      if (res.ok) {
        const data = await res.json();
        return (Array.isArray(data) ? data.map((d: any) => d.task || d) : []) as TaskSummary[];
      }
    } catch {
      // fallback
    }

    const results: TaskSummary[] = [];
    for (const payload of payloads) {
      results.push(await this.createTask(payload, projectId));
    }
    return results;
  },
  async editInboxTask(
    taskId: string,
    payload: EditInboxTaskPayload,
    projectId?: string,
  ): Promise<TaskDetails> {
    try {
      const url = projectId
        ? `/api/tasks/${encodeURIComponent(taskId)}?projectId=${encodeURIComponent(projectId)}`
        : `/api/tasks/${encodeURIComponent(taskId)}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, projectId }),
      });
      if (res.ok) {
        return (await res.json()) as TaskDetails;
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    } catch (e) {
      if (backendAvailable) throw e;
    }

    // Mock fallback
    const status = loadStoredStatus();
    const task = status.inbox.find((t) => t.id === taskId);
    if (task) {
      task.title = payload.title;
      task.dependencyIds = payload.dependencyIds || [];
      if (payload.riskLevel) task.riskLevel = payload.riskLevel;
      task.updatedAt = new Date().toISOString();
      saveStoredStatus(status);
    }
    const detailsMap = loadStoredDetails();
    if (detailsMap[taskId]) {
      detailsMap[taskId].task.title = payload.title;
      detailsMap[taskId].task.objective = payload.objective ?? null;
      detailsMap[taskId].task.acceptanceCriteria = payload.acceptanceCriteria || null;
      detailsMap[taskId].task.dependencyIds = payload.dependencyIds || [];
      if (payload.riskLevel) detailsMap[taskId].task.riskLevel = payload.riskLevel;
      detailsMap[taskId].task.updatedAt = new Date().toISOString();
      detailsMap[taskId].events.push({
        id: `evt-${Date.now()}`,
        projectId: detailsMap[taskId].task.projectId,
        taskId,
        runId: null,
        type: "progress",
        summary: "Inbox task definition updated by developer.",
        completedWork: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: null,
        actorLabel: "developer",
        createdAt: new Date().toISOString(),
      });
      saveStoredDetails(detailsMap);
      return detailsMap[taskId];
    }
    return this.getTaskDetails(taskId, projectId);
  },

  async confirmInboxTask(taskId: string, riskLevel?: import("../types.js").RiskLevel, projectId?: string): Promise<void> {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(projectId ? { projectId } : {}),
          ...(riskLevel ? { riskLevel } : {}),
        }),
      });
      if (res.ok) return;
    } catch {
      // fallback
    }

    const status = loadStoredStatus();
    const taskIdx = status.inbox.findIndex((t) => t.id === taskId);
    if (taskIdx >= 0) {
      const [task] = status.inbox.splice(taskIdx, 1);
      if (task) {
        task.status = "ready";
        if (riskLevel) task.riskLevel = riskLevel;
        task.riskConfirmed = true;
        task.queuePosition = status.next.length + 1;
        task.runnable = task.waitingFor.length === 0;
        status.next.push(task);
        saveStoredStatus(status);
      }
    }
  },

  async deleteInboxTask(taskId: string, projectId?: string): Promise<void> {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectId ? { projectId } : {}),
      });
      if (res.ok) return;
      backendAvailable = true;
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${res.status}`);
    } catch (error) {
      if (backendAvailable) throw error;
    }

    const status = loadStoredStatus();
    status.inbox = status.inbox.filter((t) => t.id !== taskId);
    saveStoredStatus(status);
  },

  async returnReadyTaskToInbox(taskId: string, projectId?: string): Promise<void> {
    try {
      const res = await fetch(
        `/api/tasks/${encodeURIComponent(taskId)}/return-to-inbox`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(projectId ? { projectId } : {}),
        },
      );
      if (res.ok) return;
      backendAvailable = true;
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${res.status}`);
    } catch (error) {
      if (backendAvailable) throw error;
    }

    const status = loadStoredStatus();
    const taskIdx = status.next.findIndex((task) => task.id === taskId);
    if (taskIdx >= 0) {
      const [task] = status.next.splice(taskIdx, 1);
      if (task) {
        task.status = "inbox";
        task.queuePosition = null;
        status.next.forEach((item, index) => {
          item.queuePosition = index + 1;
        });
        status.inbox.push(task);
        saveStoredStatus(status);

        const detailsMap = loadStoredDetails();
        const details = detailsMap[taskId];
        if (details) {
          details.task.status = "inbox";
          details.task.queuePosition = null;
          details.task.updatedAt = new Date().toISOString();
          details.events.push({
            id: `evt-${Date.now()}`,
            projectId: details.task.projectId,
            taskId,
            runId: null,
            type: "progress",
            summary: "Ready task returned to inbox by developer.",
            completedWork: null,
            currentStep: details.task.currentStep,
            nextStep: details.task.nextStep,
            blocker: details.task.blocker,
            requiredAction: details.task.requiredAction,
            handoffNote: details.task.handoffNote,
            actorLabel: "developer",
            createdAt: details.task.updatedAt,
          });
          saveStoredDetails(detailsMap);
        }
      }
    }
  },

  async deleteReadyTask(taskId: string, projectId?: string): Promise<void> {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectId ? { projectId } : {}),
      });
      if (res.ok) return;
      backendAvailable = true;
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${res.status}`);
    } catch (error) {
      if (backendAvailable) throw error;
    }

    const status = loadStoredStatus();
    status.next = status.next.filter((task) => task.id !== taskId);
    status.next.forEach((item, index) => {
      item.queuePosition = index + 1;
    });
    saveStoredStatus(status);
  },

  async reorderReadyTask(
    taskId: string,
    direction: "up" | "down",
    projectId?: string,
  ): Promise<void> {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectId ? { direction, projectId } : { direction }),
      });
      if (res.ok) return;
    } catch {
      // fallback
    }

    const status = loadStoredStatus();
    const idx = status.next.findIndex((t) => t.id === taskId);
    if (idx === -1) return;

    if (direction === "up" && idx > 0) {
      const current = status.next[idx]!;
      const prev = status.next[idx - 1]!;
      status.next[idx - 1] = current;
      status.next[idx] = prev;
    } else if (direction === "down" && idx < status.next.length - 1) {
      const current = status.next[idx]!;
      const next = status.next[idx + 1]!;
      status.next[idx + 1] = current;
      status.next[idx] = next;
    }

    status.next.forEach((item, index) => {
      item.queuePosition = index + 1;
    });
    saveStoredStatus(status);
  },

  async releaseTask(taskId: string, reason?: string, projectId?: string): Promise<void> {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectId ? { reason, projectId } : { reason }),
      });
      if (res.ok) return;
    } catch {
      // fallback
    }

    const status = loadStoredStatus();
    const idx = status.current.findIndex((t) => t.id === taskId);
    if (idx >= 0) {
      const [task] = status.current.splice(idx, 1);
      if (task) {
        task.status = "ready";
        task.currentStep = null;
        task.nextStep = null;
        task.queuePosition = 1;
        // Insert at head of next
        status.next.unshift(task);
        status.next.forEach((item, index) => {
          item.queuePosition = index + 1;
        });
        saveStoredStatus(status);
      }
    }
  },

  async approveTask(taskId: string, projectId?: string): Promise<void> {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectId ? { projectId } : {}),
      });
      if (res.ok) return;
      backendAvailable = true;
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${res.status}`);
    } catch (error) {
      if (backendAvailable) throw error;
    }

    const status = loadStoredStatus();
    const taskIndex = status.inReview.findIndex((task) => task.id === taskId);
    if (taskIndex < 0) return;
    const [task] = status.inReview.splice(taskIndex, 1);
    if (!task) return;
    const completedAt = new Date().toISOString();
    task.status = "completed";
    task.queuePosition = null;
    task.runnable = false;
    task.completedAt = completedAt;
    status.recentlyCompleted.unshift(task);
    saveStoredStatus(status);

    const detailsMap = loadStoredDetails();
    const details = detailsMap[taskId];
    if (details) {
      details.task.status = "completed";
      details.task.queuePosition = null;
      details.task.completedAt = completedAt;
      details.task.updatedAt = completedAt;
      details.events.push({
        id: `evt-${Date.now()}`,
        projectId: details.task.projectId,
        taskId,
        runId: null,
        type: "approved",
        summary: "Task approved by developer.",
        completedWork: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: details.task.handoffNote,
        actorLabel: "developer",
        createdAt: completedAt,
      });
      saveStoredDetails(detailsMap);
    }
  },

  async waiveTaskApproval(
    taskId: string,
    reason: string,
    projectId?: string,
  ): Promise<void> {
    const res = await fetch(
      `/api/tasks/${encodeURIComponent(taskId)}/waive-approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectId ? { reason, projectId } : { reason }),
      },
    );
    if (res.ok) return;
    backendAvailable = true;
    const error = await res.json().catch(() => ({}));
    throw new Error(
      typeof error.error === "string" ? error.error : `HTTP ${res.status}`,
    );
  },

  async requestTaskChanges(
    taskId: string,
    feedback: string,
    projectId?: string,
  ): Promise<void> {
    try {
      const res = await fetch(
        `/api/tasks/${encodeURIComponent(taskId)}/request-changes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(projectId ? { feedback, projectId } : { feedback }),
        },
      );
      if (res.ok) return;
      backendAvailable = true;
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${res.status}`);
    } catch (error) {
      if (backendAvailable) throw error;
    }

    const status = loadStoredStatus();
    const taskIndex = status.inReview.findIndex((task) => task.id === taskId);
    if (taskIndex < 0) return;
    const [task] = status.inReview.splice(taskIndex, 1);
    if (!task) return;
    status.next.forEach((item) => {
      item.queuePosition = (item.queuePosition ?? 0) + 1;
    });
    task.status = "ready";
    task.queuePosition = 1;
    task.runnable = task.waitingFor.length === 0;
    task.currentStep = null;
    task.nextStep = null;
    task.blocker = null;
    task.requiredAction = null;
    task.updatedAt = new Date().toISOString();
    status.next.unshift(task);
    saveStoredStatus(status);

    const detailsMap = loadStoredDetails();
    const details = detailsMap[taskId];
    if (details) {
      details.task.status = "ready";
      details.task.queuePosition = 1;
      details.task.activeRunId = null;
      details.task.currentStep = null;
      details.task.nextStep = null;
      details.task.blocker = null;
      details.task.requiredAction = null;
      details.task.handoffNote = feedback;
      details.task.updatedAt = task.updatedAt;
      details.events.push({
        id: `evt-${Date.now()}`,
        projectId: details.task.projectId,
        taskId,
        runId: null,
        type: "changes_requested",
        summary: feedback,
        completedWork: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: feedback,
        actorLabel: "developer",
        createdAt: task.updatedAt,
      });
      saveStoredDetails(detailsMap);
    }
  },

  async reopenCompletedTask(
    taskId: string,
    reason: string,
    projectId?: string,
  ): Promise<void> {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectId ? { reason, projectId } : { reason }),
      });
      if (res.ok) return;
      backendAvailable = true;
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${res.status}`);
    } catch (error) {
      if (backendAvailable) throw error;
    }

    const status = loadStoredStatus();
    const taskIndex = status.recentlyCompleted.findIndex((task) => task.id === taskId);
    if (taskIndex < 0) return;
    const [task] = status.recentlyCompleted.splice(taskIndex, 1);
    if (!task) return;
    status.next.forEach((item) => {
      item.queuePosition = (item.queuePosition ?? 0) + 1;
    });
    task.status = "ready";
    task.queuePosition = 1;
    task.runnable = task.waitingFor.length === 0;
    task.completedAt = null;
    task.currentStep = null;
    task.nextStep = null;
    task.blocker = null;
    task.requiredAction = null;
    task.updatedAt = new Date().toISOString();
    status.next.unshift(task);
    saveStoredStatus(status);

    const detailsMap = loadStoredDetails();
    const details = detailsMap[taskId];
    if (details) {
      details.task.status = "ready";
      details.task.queuePosition = 1;
      details.task.activeRunId = null;
      details.task.completedAt = null;
      details.task.handoffNote = reason;
      details.task.updatedAt = task.updatedAt;
      details.events.push({
        id: `evt-${Date.now()}`,
        projectId: details.task.projectId,
        taskId,
        runId: null,
        type: "reopened",
        summary: reason,
        completedWork: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: reason,
        actorLabel: "developer",
        createdAt: task.updatedAt,
      });
      saveStoredDetails(detailsMap);
    }
  },

  resetDemoData(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DETAILS_KEY);
  },
};
