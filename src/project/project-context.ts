import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { resolveDatabasePath } from "../db/paths.js";

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

/**
 * Walk up from `startDirectory` (resolved to an absolute path) to find the
 * nearest ancestor that contains an initialized MileStack database at
 * `.milestack/milestack.db`.  Returns the absolute project root, consistent
 * with `resolveProjectRoot` (uses `path.resolve`, not `realpathSync`).
 *
 * Throws when:
 * - `startDirectory` does not exist or is not a directory
 * - no `.milestack/milestack.db` is found before reaching the filesystem root
 */
export function discoverProjectRoot(startDirectory?: string): string {
  const resolved = path.resolve(startDirectory ?? process.cwd());
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(resolved);
  } catch {
    throw new Error(
      `Cannot discover MileStack project: '${resolved}' does not exist or is not accessible.`,
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(
      `Cannot discover MileStack project: '${resolved}' is not a directory.`,
    );
  }

  let current = resolved;
  const visited = new Set<string>();
  while (true) {
    if (visited.has(current)) {
      throw new Error(
        `Cannot discover MileStack project: cyclic directory structure detected at '${current}'.`,
      );
    }
    visited.add(current);

    const databasePath = resolveDatabasePath(current);
    if (existsSync(databasePath)) {
      try {
        const stats = statSync(databasePath);
        if (!stats.isFile()) {
          throw new Error(
            `Cannot discover MileStack project: database path '${databasePath}' is not a regular file.`,
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("not a regular file")) {
          throw error;
        }
        throw new Error(
          `Cannot discover MileStack project: database path '${databasePath}' is not accessible or unsafe.`,
        );
      }
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new Error(
    `Cannot discover MileStack project from '${resolved}': no .milestack/milestack.db found in any ancestor directory. ` +
      `Run 'milestack init --project <project-root>' to initialize, then retry.`,
  );
}

function parseRootUri(uriOrPath: string): string {
  if (uriOrPath.startsWith("file://")) {
    try {
      return fileURLToPath(uriOrPath);
    } catch {
      return uriOrPath.replace(/^file:\/\//, "");
    }
  }
  return uriOrPath;
}

/**
 * Resolves the unique MileStack project root from a collection of candidate
 * workspace roots (e.g. from an MCP client's roots/list or environment).
 *
 * Rules:
 * - If roots is empty: falls back to discoverProjectRoot() from cwd.
 * - If roots has 1 element: discovers project root from that element.
 * - If roots has > 1 elements: discovers project root for each element.
 *   - If any root does not belong to an initialized MileStack project, throws.
 *   - If the roots map to multiple DIFFERENT MileStack projects, throws,
 *     refusing to silently pick one.
 *   - If all roots map to the same MileStack project, returns that project root.
 */
export function resolveWorkspaceProjectRoot(roots?: readonly string[]): string {
  if (!roots || roots.length === 0) {
    return discoverProjectRoot();
  }

  const normalizedRoots = roots.map(parseRootUri);

  if (normalizedRoots.length === 1) {
    return discoverProjectRoot(normalizedRoots[0]!);
  }

  const discoveredMap = new Map<string, string>();
  for (const root of normalizedRoots) {
    let projectRoot: string;
    try {
      projectRoot = discoverProjectRoot(root);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Cannot start MileStack in multi-root workspace: workspace root '${root}' cannot be mapped to an initialized MileStack project (${message}). ` +
          `Multi-root workspaces must uniquely map to a single MileStack project.`,
      );
    }
    let canonical = projectRoot;
    try {
      canonical = realpathSync(projectRoot);
    } catch {
      // ignore
    }
    discoveredMap.set(canonical, projectRoot);
  }

  if (discoveredMap.size > 1) {
    const projectList = Array.from(discoveredMap.values());
    throw new Error(
      `Cannot start MileStack in multi-root workspace: found multiple different MileStack projects (${projectList.join(", ")}). ` +
        `A session cannot be uniquely mapped to a single MileStack project. Please open a single-project workspace or use --project.`,
    );
  }

  return Array.from(discoveredMap.values())[0]!;
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
  let project = repository.findByRootPath(projectRoot);

  // On systems where temp/var paths have symlinks (e.g. macOS /var -> /private/var),
  // the stored rootPath may differ from the path discovered via process.cwd().
  // Try the canonical path, then verify if the single project in the database matches canonical path.
  if (!project) {
    try {
      const canonical = realpathSync(projectRoot);
      if (canonical !== projectRoot) {
        project = repository.findByRootPath(canonical);
      }
    } catch {
      // realpathSync failure is not fatal here
    }
  }
  if (!project) {
    const single = repository.findSingleProject();
    if (single && single.rootPath) {
      try {
        if (realpathSync(single.rootPath) === realpathSync(projectRoot)) {
          project = single;
        }
      } catch {
        // realpathSync failure is not fatal here
      }
    }
  }

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
