import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
  openProjectContext,
  initializeProject,
  resolveProjectRoot,
  type ProjectContext,
} from "../project/project-context.js";
import {
  ProjectNotFoundError,
  TaskNotFoundError,
  InvalidTaskError,
  InvalidTaskDependencyError,
  InvalidTaskStateError,
  TaskHasDependentsError,
  TaskRunOwnershipError,
  ReviewRunOwnershipError,
  ReviewEvidenceIncompleteError,
} from "../core/errors.js";
import {
  getProjectStatusInputSchema,
  listTasksInputSchema,
} from "../core/query-contract.js";
import type { ReviewFinding, VerificationEvidence } from "../core/review-model.js";
import { runtimeVersion } from "./runtime-version.js";

export type HttpServerOptions = {
  projectRoot?: string | undefined;
  port?: number | undefined;
  host?: string | undefined;
  staticDir?: string | undefined;
};

function resolveDefaultStaticPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  // The compiled CLI keeps the Vite output beside its entrypoint.
  const compiledPath = path.resolve(moduleDir, "ui");
  if (existsSync(path.join(compiledPath, "index.html"))) {
    return compiledPath;
  }

  // Source-based execution (for example, tests) resolves back to the
  // repository's build output.
  const sourcePath = path.resolve(moduleDir, "../../dist/ui");
  return existsSync(path.join(sourcePath, "index.html")) ? sourcePath : compiledPath;
}

export async function createHttpServer(
  options: HttpServerOptions = {},
): Promise<{ app: FastifyInstance; context: ProjectContext; port: number; host: string }> {
  const rootPath = resolveProjectRoot(options.projectRoot);

  const staticPath = options.staticDir
    ? path.resolve(options.staticDir)
    : resolveDefaultStaticPath();
  const staticIndexPath = path.join(staticPath, "index.html");
  if (!existsSync(staticIndexPath)) {
    throw new Error(
      `UI build output is missing at '${staticPath}'. Run 'pnpm build' before 'pnpm serve', or run 'pnpm build:ui' if the backend is already built.`,
    );
  }

  const initialized = await initializeProject(rootPath);
  initialized.database.close();
  const context = await openProjectContext(rootPath);

  const app = Fastify({
    logger: false,
  });

  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  // Serve static UI assets.
  await app.register(fastifyStatic, {
    root: staticPath,
    prefix: "/",
  });

  // --- API Routes ---

  // Health check
  app.get("/api/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString(), version: runtimeVersion };
  });

  // Project Info
  app.get("/api/project", async () => {
    return {
      id: context.project.id,
      name: context.project.name,
      goal: context.project.goal,
      rootPath: context.project.rootPath,
    };
  });

  // Project Status
  app.get("/api/status", async (request, reply) => {
    const query = request.query as {
      projectId?: string;
      view?: string;
      since?: string;
    };

    try {
      const status = context.service.getProjectStatusIfChanged(
        getProjectStatusInputSchema.parse({
          projectId: query.projectId || context.project.id,
          view: query.view || "full",
          since: query.since,
        }),
      );
      if (status === null) {
        return reply.code(304).send();
      }
      return status;
    } catch (err) {
      if (err instanceof ProjectNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: err.issues });
      }
      throw err;
    }
  });

  // Paginated Task List
  app.get("/api/tasks", async (request, reply) => {
    const query = request.query as {
      projectId?: string;
      status?: string;
      limit?: string;
      cursor?: string;
    };

    try {
      return context.service.listTasks(
        listTasksInputSchema.parse({
          projectId: query.projectId || context.project.id,
          status: query.status,
          limit: query.limit === undefined ? undefined : Number(query.limit),
          cursor: query.cursor,
        }),
      );
    } catch (err) {
      if (err instanceof ProjectNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof InvalidTaskError || err instanceof z.ZodError) {
        return reply.status(400).send({ error: err instanceof z.ZodError ? err.issues : err.message });
      }
      throw err;
    }
  });

  // Task Details
  app.get("/api/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { projectId?: string };
    const projectId = query.projectId || context.project.id;

    try {
      const task = context.service.getTask({ taskId: id, projectId, view: "full" });
      return task;
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof ProjectNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      throw err;
    }
  });

  // Create Task (Single)
  app.post("/api/tasks", async (request, reply) => {
    const body = request.body as any;
    const projectId = body.projectId || context.project.id;

    try {
      const created = context.service.createTask({
        projectId,
        title: body.title,
        objective: body.objective,
        acceptanceCriteria: body.acceptanceCriteria,
        dependencyIds: body.dependencyIds,
        status: body.status,
        riskLevel: body.riskLevel,
        createdBy: "developer",
        actorLabel: "developer",
      });
      return reply.status(201).send(created);
    } catch (err) {
      if (err instanceof InvalidTaskError || err instanceof InvalidTaskDependencyError) {
        return reply.status(400).send({ error: err.message });
      }
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: err.issues });
      }
      throw err;
    }
  });

  // Create Tasks (Batch)
  app.post("/api/tasks/batch", async (request, reply) => {
    const body = request.body as any;
    const projectId = body.projectId || context.project.id;
    const tasks = Array.isArray(body.tasks) ? body.tasks : [];

    try {
      const created = context.service.createTasks({
        projectId,
        tasks: tasks.map((t: any) => ({
          title: t.title,
          objective: t.objective,
          acceptanceCriteria: t.acceptanceCriteria,
          dependencyIds: t.dependencyIds,
          status: t.status,
          riskLevel: t.riskLevel,
          createdBy: "developer",
          actorLabel: "developer",
        })),
      });
      return reply.status(201).send(created);
    } catch (err) {
      if (err instanceof InvalidTaskError || err instanceof InvalidTaskDependencyError) {
        return reply.status(400).send({ error: err.message });
      }
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: err.issues });
      }
      throw err;
    }
  });
  // Edit Inbox Task
  app.put("/api/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as any;
    const projectId = body.projectId || context.project.id;

    try {
      const updated = context.service.editInboxTask({
        projectId,
        taskId: id,
        title: body.title,
        objective: body.objective,
        acceptanceCriteria: body.acceptanceCriteria,
        dependencyIds: body.dependencyIds,
        riskLevel: body.riskLevel,
        actorLabel: "developer",
      });
      return updated;
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof ProjectNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (
        err instanceof InvalidTaskStateError ||
        err instanceof InvalidTaskDependencyError ||
        err instanceof InvalidTaskError ||
        err instanceof z.ZodError
      ) {
        return reply
          .status(400)
          .send({ error: err instanceof z.ZodError ? err.issues : err.message });
      }
      throw err;
    }
  });

  // Confirm Inbox Task -> Ready
  app.post("/api/tasks/:id/confirm", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as any;
    const projectId = body.projectId || context.project.id;

    try {
      context.service.confirmTask({
        projectId,
        taskId: id,
        riskLevel: body.riskLevel,
        actorLabel: "developer",
      });
      return { success: true };
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (
        err instanceof InvalidTaskStateError ||
        err instanceof z.ZodError
      ) {
        return reply.status(400).send({ error: err instanceof z.ZodError ? err.issues : err.message });
      }
      throw err;
    }
  });

  // Approve In-review Task -> Completed
  app.post("/api/tasks/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { projectId?: string };
    const projectId = body.projectId || context.project.id;

    try {
      context.service.approveTask({
        projectId,
        taskId: id,
        actorLabel: "developer",
      });
      return { success: true };
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (
        err instanceof InvalidTaskStateError ||
        err instanceof z.ZodError
      ) {
        return reply
          .status(400)
          .send({ error: err instanceof z.ZodError ? err.issues : err.message });
      }
      throw err;
    }
  });

  // Developer waiver: complete an in-review task without an AI passed conclusion.
  app.post("/api/tasks/:id/waive-approval", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as {
      reason?: string;
      projectId?: string;
    };
    const projectId = body.projectId || context.project.id;

    try {
      context.service.waiveTaskApproval({
        projectId,
        taskId: id,
        reason: body.reason ?? "",
        actorLabel: "developer",
      });
      return { success: true };
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (
        err instanceof InvalidTaskStateError ||
        err instanceof z.ZodError
      ) {
        return reply
          .status(400)
          .send({ error: err instanceof z.ZodError ? err.issues : err.message });
      }
      throw err;
    }
  });

  // Request changes In-review Task -> Ready
  app.post("/api/tasks/:id/request-changes", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as {
      feedback?: string;
      findings?: ReviewFinding[];
      reviewRunId?: string;
      projectId?: string;
    };
    const projectId = body.projectId || context.project.id;

    try {
      context.service.requestTaskChanges({
        projectId,
        taskId: id,
        reviewRunId: body.reviewRunId,
        feedback: body.feedback ?? "",
        findings: body.findings,
        actorLabel: "developer",
      });
      return { success: true };
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (
        err instanceof InvalidTaskStateError ||
        err instanceof ReviewRunOwnershipError ||
        err instanceof z.ZodError
      ) {
        return reply
          .status(400)
          .send({ error: err instanceof z.ZodError ? err.issues : err.message });
      }
      throw err;
    }
  });

  // Start an AI review session for the latest submitted artifact.
  app.post("/api/tasks/:id/start-review", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { projectId?: string; actorLabel?: string };
    const projectId = body.projectId || context.project.id;

    try {
      return context.service.startReview({
        projectId,
        taskId: id,
        actorLabel: body.actorLabel,
      });
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (
        err instanceof InvalidTaskStateError ||
        err instanceof ReviewRunOwnershipError ||
        err instanceof z.ZodError
      ) {
        return reply
          .status(400)
          .send({ error: err instanceof z.ZodError ? err.issues : err.message });
      }
      throw err;
    }
  });

  // Record an AI review conclusion and apply the risk-based decision policy.
  app.post("/api/tasks/:id/complete-review", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as {
      projectId?: string;
      reviewRunId?: string;
      decision?: "passed" | "changes_requested";
      summary?: string;
      findings?: ReviewFinding[];
      verificationEvidence?: VerificationEvidence[];
      actorLabel?: string;
    };
    const projectId = (body.projectId as string | undefined) || context.project.id;

    try {
      return context.service.completeReview({
        projectId,
        taskId: id,
        reviewRunId: body.reviewRunId as string,
        decision: body.decision as "passed" | "changes_requested",
        summary: body.summary as string,
        findings: body.findings,
        verificationEvidence: body.verificationEvidence,
        actorLabel: body.actorLabel as string | undefined,
      });
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (
        err instanceof InvalidTaskStateError ||
        err instanceof ReviewRunOwnershipError ||
        err instanceof ReviewEvidenceIncompleteError ||
        err instanceof z.ZodError
      ) {
        return reply
          .status(400)
          .send({ error: err instanceof z.ZodError ? err.issues : err.message });
      }
      throw err;
    }
  });

  // Reopen Completed Task -> Ready
  app.post("/api/tasks/:id/reopen", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { reason?: string; projectId?: string };
    const projectId = body.projectId || context.project.id;

    try {
      context.service.reopenTask({
        projectId,
        taskId: id,
        reason: body.reason ?? "",
        actorLabel: "developer",
      });
      return { success: true };
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof InvalidTaskStateError || err instanceof z.ZodError) {
        return reply
          .status(400)
          .send({ error: err instanceof z.ZodError ? err.issues : err.message });
      }
      throw err;
    }
  });

  // Return Ready Task -> Inbox
  app.post("/api/tasks/:id/return-to-inbox", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { projectId?: string };
    const projectId = body.projectId || context.project.id;

    try {
      context.service.returnTaskToInbox({
        projectId,
        taskId: id,
        actorLabel: "developer",
      });
      return { success: true };
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof InvalidTaskStateError || err instanceof z.ZodError) {
        return reply
          .status(400)
          .send({ error: err instanceof z.ZodError ? err.issues : err.message });
      }
      throw err;
    }
  });

  // Delete Inbox or Ready Task
  app.post("/api/tasks/:id/delete", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as any;
    const projectId = body.projectId || context.project.id;

    try {
      context.service.deleteTask({ projectId, taskId: id });
      return { success: true };
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof TaskHasDependentsError) {
        return reply.status(400).send({
          error: err.message,
          code: err.code,
          dependentTaskIds: err.dependentTaskIds,
        });
      }
      if (err instanceof InvalidTaskStateError || err instanceof z.ZodError) {
        return reply
          .status(400)
          .send({ error: err instanceof z.ZodError ? err.issues : err.message });
      }
      throw err;
    }
  });

  // Reorder Ready Task (up / down)
  app.post("/api/tasks/:id/reorder", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { direction: "up" | "down"; projectId?: string };
    const projectId = body.projectId || context.project.id;

    try {
      context.service.reorderTask({
        projectId,
        taskId: id,
        direction: body.direction,
      });
      return { success: true };
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof InvalidTaskStateError || err instanceof z.ZodError) {
        return reply.status(400).send({ error: err instanceof z.ZodError ? err.issues : err.message });
      }
      throw err;
    }
  });

  // Release running task back to ready queue
  app.post("/api/tasks/:id/release", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { reason?: string; handoffNote?: string; runId?: string; projectId?: string };
    const projectId = body.projectId || context.project.id;

    try {
      const current = context.service.getTask({ projectId, taskId: id, view: "full" });
      context.service.releaseTask({
        projectId,
        taskId: id,
        runId: body.runId ?? current.task.activeRunId ?? "",
        reason: body.reason,
        handoffNote: body.handoffNote,
        actorLabel: "developer",
      });
      return { success: true };
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof InvalidTaskStateError || err instanceof TaskRunOwnershipError || err instanceof z.ZodError) {
        return reply.status(400).send({ error: err instanceof z.ZodError ? err.issues : err.message });
      }
      throw err;
    }
  });

  const port = options.port ?? 7331;
  const host = options.host ?? "127.0.0.1";

  return { app, context, port, host };
}

export async function startHttpServer(options: HttpServerOptions = {}): Promise<{
  app: FastifyInstance;
  context: ProjectContext;
  url: string;
}> {
  const { app, context, port, host } = await createHttpServer(options);
  await app.listen({ port, host });
  const url = `http://${host}:${port}`;
  return { app, context, url };
}
