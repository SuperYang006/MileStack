import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { randomUUID } from "node:crypto";

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
} from "../core/errors.js";

export type HttpServerOptions = {
  projectRoot?: string | undefined;
  port?: number | undefined;
  host?: string | undefined;
  staticDir?: string | undefined;
};

export async function createHttpServer(
  options: HttpServerOptions = {},
): Promise<{ app: FastifyInstance; context: ProjectContext; port: number; host: string }> {
  const rootPath = resolveProjectRoot(options.projectRoot);
  await initializeProject(rootPath);
  const context = await openProjectContext(rootPath);

  const app = Fastify({
    logger: false,
  });

  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  // Serve static UI assets if present
  const staticPath = options.staticDir
    ? path.resolve(options.staticDir)
    : path.resolve(rootPath, "dist/ui");

  if (existsSync(staticPath)) {
    await app.register(fastifyStatic, {
      root: staticPath,
      prefix: "/",
    });
  }

  // --- API Routes ---

  // Health check
  app.get("/api/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
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
    const query = request.query as { projectId?: string };
    const projectId = query.projectId || context.project.id;

    try {
      const status = context.service.getProjectStatus({ projectId });
      return status;
    } catch (err) {
      if (err instanceof ProjectNotFoundError) {
        return reply.status(404).send({ error: err.message });
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
      const task = context.service.getTask({ taskId: id, projectId });
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
        createdBy: body.createdBy || "developer",
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
          createdBy: t.createdBy || "developer",
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

  // Confirm Inbox Task -> Ready
  app.post("/api/tasks/:id/confirm", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as any;
    const projectId = body.projectId || context.project.id;

    try {
      context.repository.transaction((tx) => {
        const task = tx.findTaskById(id);
        if (!task || task.projectId !== projectId) {
          throw new TaskNotFoundError(id);
        }
        if (task.status !== "inbox") {
          return;
        }

        const projectTasks = tx.listByProjectId(projectId);
        const readyTasks = projectTasks.filter((t) => t.status === "ready");
        const nextQueuePos = readyTasks.length + 1;
        const now = new Date().toISOString();

        // Update task status and queue position
        (context.database.sqlite as any)
          .prepare(
            `UPDATE tasks SET status = 'ready', queue_position = ?, updated_at = ? WHERE id = ?`,
          )
          .run(nextQueuePos, now, id);

        tx.insertTaskEvent({
          id: randomUUID(),
          projectId,
          taskId: id,
          runId: null,
          type: "progress",
          summary: `确认为就绪任务 (排位 #${nextQueuePos})`,
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "developer",
          createdAt: now,
        });
      });

      return { success: true };
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      throw err;
    }
  });

  // Delete Inbox Task
  app.post("/api/tasks/:id/delete", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as any;
    const projectId = body.projectId || context.project.id;

    try {
      context.repository.transaction((tx) => {
        const task = tx.findTaskById(id);
        if (!task || task.projectId !== projectId) {
          throw new TaskNotFoundError(id);
        }

        const sqlite = context.database.sqlite as any;
        sqlite.prepare(`DELETE FROM task_events WHERE task_id = ?`).run(id);
        sqlite.prepare(`DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?`).run(id, id);
        sqlite.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
      });

      return { success: true };
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
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
      context.repository.transaction((tx) => {
        const task = tx.findTaskById(id);
        if (!task || task.projectId !== projectId) {
          throw new TaskNotFoundError(id);
        }
        if (task.status !== "ready") {
          return;
        }

        const allTasks = tx.listByProjectId(projectId);
        const readyTasks = allTasks
          .filter((t) => t.status === "ready")
          .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));

        const index = readyTasks.findIndex((t) => t.id === id);
        if (index === -1) return;

        const targetIndex = body.direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= readyTasks.length) return;

        const currentTask = readyTasks[index]!;
        const swapTask = readyTasks[targetIndex]!;

        readyTasks[index] = swapTask;
        readyTasks[targetIndex] = currentTask;

        const sqlite = context.database.sqlite as any;
        const stmt = sqlite.prepare(`UPDATE tasks SET queue_position = ? WHERE id = ?`);
        readyTasks.forEach((item, pos) => {
          stmt.run(pos + 1, item.id);
        });
      });

      return { success: true };
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      throw err;
    }
  });

  // Release in-progress/running task back to ready queue
  app.post("/api/tasks/:id/release", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { reason?: string; projectId?: string };
    const projectId = body.projectId || context.project.id;

    try {
      context.repository.transaction((tx) => {
        const task = tx.findTaskById(id);
        if (!task || task.projectId !== projectId) {
          throw new TaskNotFoundError(id);
        }

        const now = new Date().toISOString();
        const sqlite = context.database.sqlite as any;

        // Shift existing ready tasks down by 1
        sqlite.prepare(`UPDATE tasks SET queue_position = queue_position + 1 WHERE project_id = ? AND status = 'ready'`).run(projectId);

        // Put released task as #1 in ready queue
        sqlite.prepare(
          `UPDATE tasks SET status = 'ready', queue_position = 1, current_step = NULL, next_step = NULL, active_run_id = NULL, updated_at = ? WHERE id = ?`,
        ).run(now, id);

        tx.insertTaskEvent({
          id: randomUUID(),
          projectId,
          taskId: id,
          runId: task.activeRunId,
          type: "progress",
          summary: body.reason ? `释放任务: ${body.reason}` : "手动释放任务，回退至就绪队列",
          completedWork: null,
          currentStep: null,
          nextStep: null,
          blocker: null,
          requiredAction: null,
          handoffNote: null,
          actorLabel: "developer",
          createdAt: now,
        });
      });

      return { success: true };
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return reply.status(404).send({ error: err.message });
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
