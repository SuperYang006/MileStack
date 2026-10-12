import type {
  ProjectStatus,
  TaskDetails,
  CreateTaskPayload,
  TaskSummary,
  TaskModel,
  TaskEvent,
  EditInboxTaskPayload,
} from "../types";
import { initialProjectStatus, sampleTaskDetails } from "./mock-data";

const STORAGE_KEY = "milestack_ui_status_data";
const DETAILS_KEY = "milestack_ui_details_data";

function loadStoredStatus(): ProjectStatus {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as ProjectStatus;
      return { ...stored, inReview: stored.inReview ?? [] };
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
  async isBackendAvailable(): Promise<boolean> {
    try {
      const res = await fetch("/api/health", { method: "GET", signal: AbortSignal.timeout(1000) });
      backendAvailable = res.ok;
    } catch {
      backendAvailable = false;
    }
    return backendAvailable;
  },

  async getProjectStatus(projectId?: string): Promise<ProjectStatus> {
    try {
      const params = new URLSearchParams({ view: "full" });
      if (projectId) params.set("projectId", projectId);
      const url = `/api/status?${params.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
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

  async getTaskDetails(taskId: string, projectId?: string): Promise<TaskDetails> {
    try {
      const url = projectId
        ? `/api/tasks/${encodeURIComponent(taskId)}?projectId=${encodeURIComponent(projectId)}`
        : `/api/tasks/${encodeURIComponent(taskId)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        return (await res.json()) as TaskDetails;
      }
    } catch {
      // fallback
    }

    const detailsMap = loadStoredDetails();
    if (detailsMap[taskId]) {
      return detailsMap[taskId];
    }

    // Generate detail from summary if not in detail map
    const status = loadStoredStatus();
    const allSummaries = [
      ...status.current,
      ...status.next,
      ...status.blocked,
      ...status.inReview,
      ...status.inbox,
      ...status.recentlyCompleted,
    ];
    const found = allSummaries.find((t) => t.id === taskId);
    const mockModel: TaskModel = {
      id: taskId,
      projectId: projectId || "proj_milestack",
      title: found?.title ?? `任务 ${taskId}`,
      objective: null,
      acceptanceCriteria: [],
      status: found?.status ?? "ready",
      queuePosition: found?.queuePosition ?? null,
      dependencyIds: found?.dependencyIds ?? [],
      currentStep: found?.currentStep ?? null,
      nextStep: found?.nextStep ?? null,
      blocker: found?.blocker ?? null,
      requiredAction: found?.requiredAction ?? null,
      handoffNote: null,
      sourceTaskId: null,
      activeRunId: null,
      createdBy: "developer",
      createdAt: new Date().toISOString(),
      updatedAt: found?.updatedAt ?? new Date().toISOString(),
      completedAt: found?.completedAt ?? null,
    };
    const mockEvents: TaskEvent[] = [
      {
        id: `evt-${Date.now()}`,
        projectId: mockModel.projectId,
        taskId,
        runId: null,
        type: "created",
        summary: `创建任务：${mockModel.title}`,
        completedWork: null,
        currentStep: null,
        nextStep: null,
        blocker: null,
        requiredAction: null,
        handoffNote: null,
        actorLabel: "developer",
        createdAt: mockModel.createdAt,
      },
    ];

    return { task: mockModel, events: mockEvents };
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

  async confirmInboxTask(taskId: string, riskLevel?: import("../types").RiskLevel, projectId?: string): Promise<void> {
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
