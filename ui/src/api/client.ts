import type {
  ProjectStatus,
  TaskDetails,
  CreateTaskPayload,
  FindingClosureInput,
  TaskSummary,
  EditInboxTaskPayload,
  TaskPage,
  TaskStatus,
  RiskLevel,
  RuntimeHealth,
} from "../types.js";

/** Shown wherever a transport failure reaches the user, so a dead service never
 *  looks like a rejected request or like an empty project. */
const SERVICE_UNAVAILABLE_MESSAGE =
  "无法连接到 MileStack 服务，请确认 milestack serve 仍在运行后重试。";

const HEALTH_TIMEOUT_MS = 1000;
const READ_TIMEOUT_MS = 2000;
const WRITE_TIMEOUT_MS = 10_000;

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
}

/** Performs one API call. A transport failure always surfaces as an explicit
 *  error; there is no local data that could stand in for the service. */
async function send(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method, body, timeoutMs = READ_TIMEOUT_MS } = options;
  try {
    return await fetch(path, {
      ...(method ? { method } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
  }
}

/** Turns a non-success response into the server's own message when it has one. */
async function toRequestError(res: Response): Promise<Error> {
  const body: unknown = await res.json().catch(() => null);
  const message =
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
      ? body.error
      : `HTTP ${res.status}`;
  return new Error(message);
}

async function sendJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await send(path, options);
  if (!res.ok) throw await toRequestError(res);
  return (await res.json()) as T;
}

async function sendVoid(path: string, options: RequestOptions = {}): Promise<void> {
  const res = await send(path, options);
  if (!res.ok) throw await toRequestError(res);
}

export const apiClient = {
  // A reachable health endpoint means the service is online. The version is
  // reported separately so an older build without it still shows as online.
  // Null means unreachable or not successful, which the UI shows as offline.
  async getRuntimeHealth(): Promise<RuntimeHealth | null> {
    try {
      const res = await send("/api/health", { method: "GET", timeoutMs: HEALTH_TIMEOUT_MS });
      if (!res.ok) {
        return null;
      }
      const body = (await res.json().catch(() => ({}))) as Partial<RuntimeHealth>;
      return {
        status: typeof body.status === "string" ? body.status : "ok",
        timestamp: typeof body.timestamp === "string" ? body.timestamp : "",
        version: typeof body.version === "string" && body.version.length > 0 ? body.version : null,
      };
    } catch {
      return null;
    }
  },

  /** Resolves with the authoritative status, or null when the service reports
   *  nothing changed. Rejects when the status cannot be read at all. */
  async getProjectStatus(
    projectId?: string,
    since?: string,
  ): Promise<ProjectStatus | null> {
    const params = new URLSearchParams({ view: "full" });
    if (projectId) params.set("projectId", projectId);
    if (since) params.set("since", since);

    const res = await send(`/api/status?${params.toString()}`);
    if (res.status === 304) {
      return null;
    }
    if (!res.ok) throw await toRequestError(res);
    return (await res.json()) as ProjectStatus;
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

    return sendJson<TaskPage>(`/api/tasks?${params.toString()}`);
  },

  async getTaskDetails(taskId: string, projectId?: string): Promise<TaskDetails> {
    const path = projectId
      ? `/api/tasks/${encodeURIComponent(taskId)}?projectId=${encodeURIComponent(projectId)}`
      : `/api/tasks/${encodeURIComponent(taskId)}`;

    return sendJson<TaskDetails>(path);
  },

  async createTask(payload: CreateTaskPayload, projectId?: string): Promise<TaskSummary> {
    const data = await sendJson<unknown>("/api/tasks", {
      method: "POST",
      body: projectId ? { ...payload, projectId } : payload,
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return ((data as { task?: TaskSummary }).task || data) as TaskSummary;
  },

  async createTasks(payloads: CreateTaskPayload[], projectId?: string): Promise<TaskSummary[]> {
    const data = await sendJson<unknown>("/api/tasks/batch", {
      method: "POST",
      body: projectId ? { tasks: payloads, projectId } : { tasks: payloads },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return Array.isArray(data)
      ? data.map((entry: any) => entry.task || entry)
      : [];
  },

  async editInboxTask(
    taskId: string,
    payload: EditInboxTaskPayload,
    projectId?: string,
  ): Promise<TaskDetails> {
    const path = projectId
      ? `/api/tasks/${encodeURIComponent(taskId)}?projectId=${encodeURIComponent(projectId)}`
      : `/api/tasks/${encodeURIComponent(taskId)}`;

    return sendJson<TaskDetails>(path, {
      method: "PUT",
      body: { ...payload, projectId },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  },

  async confirmInboxTask(taskId: string, riskLevel?: RiskLevel, projectId?: string): Promise<void> {
    await sendVoid(`/api/tasks/${encodeURIComponent(taskId)}/confirm`, {
      method: "POST",
      body: {
        ...(projectId ? { projectId } : {}),
        ...(riskLevel ? { riskLevel } : {}),
      },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  },

  async deleteInboxTask(taskId: string, projectId?: string): Promise<void> {
    await sendVoid(`/api/tasks/${encodeURIComponent(taskId)}/delete`, {
      method: "POST",
      body: projectId ? { projectId } : {},
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  },

  async returnReadyTaskToInbox(taskId: string, projectId?: string): Promise<void> {
    await sendVoid(`/api/tasks/${encodeURIComponent(taskId)}/return-to-inbox`, {
      method: "POST",
      body: projectId ? { projectId } : {},
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  },

  async deleteReadyTask(taskId: string, projectId?: string): Promise<void> {
    await sendVoid(`/api/tasks/${encodeURIComponent(taskId)}/delete`, {
      method: "POST",
      body: projectId ? { projectId } : {},
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  },

  async reorderReadyTask(
    taskId: string,
    direction: "up" | "down",
    projectId?: string,
  ): Promise<void> {
    await sendVoid(`/api/tasks/${encodeURIComponent(taskId)}/reorder`, {
      method: "POST",
      body: projectId ? { direction, projectId } : { direction },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  },

  async releaseTask(taskId: string, reason?: string, projectId?: string): Promise<void> {
    await sendVoid(`/api/tasks/${encodeURIComponent(taskId)}/release`, {
      method: "POST",
      body: { reason, projectId },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  },

  async approveTask(taskId: string, projectId?: string): Promise<void> {
    await sendVoid(`/api/tasks/${encodeURIComponent(taskId)}/approve`, {
      method: "POST",
      body: projectId ? { projectId } : {},
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  },

  async setTaskIntegrationPolicy(
    taskId: string,
    policy: {
      integrationRequired: boolean;
      integrationTargetBranch: string;
      integrationNotRequiredReason?: string | null;
    },
    projectId?: string,
  ): Promise<TaskDetails> {
    return sendJson<TaskDetails>(`/api/tasks/${encodeURIComponent(taskId)}/integration-policy`, {
      method: "POST",
      body: { ...policy, projectId },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  },

  async checkTaskIntegration(
    taskId: string,
    expectedReviewId: string,
    projectId?: string,
  ): Promise<TaskDetails> {
    return sendJson<TaskDetails>(`/api/tasks/${encodeURIComponent(taskId)}/check-integration`, {
      method: "POST",
      body: { expectedReviewId, projectId },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  },

  async waiveTaskApproval(
    taskId: string,
    reason: string,
    projectId?: string,
  ): Promise<void> {
    await sendVoid(`/api/tasks/${encodeURIComponent(taskId)}/waive-approval`, {
      method: "POST",
      body: { reason, projectId },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  },

  async requestTaskChanges(
    taskId: string,
    feedback: string,
    findingClosures?: FindingClosureInput[],
    projectId?: string,
  ): Promise<void> {
    await sendVoid(`/api/tasks/${encodeURIComponent(taskId)}/request-changes`, {
      method: "POST",
      body: {
        feedback,
        ...(findingClosures && findingClosures.length > 0
          ? { findingClosures }
          : {}),
        projectId,
      },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  },

  async reopenCompletedTask(
    taskId: string,
    reason: string,
    projectId?: string,
  ): Promise<void> {
    await sendVoid(`/api/tasks/${encodeURIComponent(taskId)}/reopen`, {
      method: "POST",
      body: { reason, projectId },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  },
};
