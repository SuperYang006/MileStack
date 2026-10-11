import { statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { ProjectNotFoundError } from "../core/errors.js";
import { TaskService } from "../core/task-service.js";
import { ensureDatabase } from "../db/ensure-database.js";
import type { OpenDatabase } from "../db/open-database.js";
import { createSqliteRepository } from "../db/sqlite-repository.js";
import type { MileStackRepository, ProjectRecord } from "../core/repositories.js";

export type ProjectContext = {
  projectRoot: string;
  database: OpenDatabase;
  repository: MileStackRepository;
  project: ProjectRecord;
  service: TaskService;
};

export function resolveProjectRoot(projectPath?: string): string {
  const projectRoot = path.resolve(projectPath ?? process.cwd());
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(projectRoot);
  } catch {
    throw new Error(`Project path '${projectRoot}' does not exist.`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Project path '${projectRoot}' is not a directory.`);
  }
  return projectRoot;
}

export async function initializeProject(projectRoot: string): Promise<{
  projectRoot: string;
  database: OpenDatabase;
  project: ProjectRecord;
  created: boolean;
}> {
  const database = await ensureDatabase(projectRoot);
  try {
    const repository = createSqliteRepository(database);
    const existingProject = repository.findByRootPath(projectRoot);
    if (existingProject) {
      return { projectRoot, database, project: existingProject, created: false };
    }

    const now = new Date().toISOString();
    const project = repository.insert({
      id: randomUUID(),
      name: path.basename(projectRoot) || projectRoot,
      rootPath: projectRoot,
      goal: null,
      createdAt: now,
      updatedAt: now,
    });
    return { projectRoot, database, project, created: true };
  } catch (error) {
    database.close();
    throw error;
  }
}

export async function openProjectContext(
  projectRoot: string,
): Promise<ProjectContext> {
  const database = await ensureDatabase(projectRoot);
  const repository = createSqliteRepository(database);
  const project = repository.findByRootPath(projectRoot);
  if (!project) {
    database.close();
    throw new ProjectNotFoundError(projectRoot);
  }

  return {
    projectRoot,
    database,
    repository,
    project,
    service: new TaskService(repository),
  };
}
