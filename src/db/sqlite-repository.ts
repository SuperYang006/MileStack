import type BetterSqlite3 from "better-sqlite3";
import { asc, eq } from "drizzle-orm";

import type {
  MileStackRepository,
  ProjectRecord,
  TaskEventRecord,
  TaskRecord,
  TaskRepositoryTransaction,
} from "../core/repositories.js";
import { taskEvents, projects, tasks } from "./schema.js";
import type { MileStackDatabase } from "./open-database.js";

function mapProject(project: typeof projects.$inferSelect): ProjectRecord {
  return project;
}

function mapTask(task: typeof tasks.$inferSelect): TaskRecord {
  return task;
}

function mapTaskEvent(event: typeof taskEvents.$inferSelect): TaskEventRecord {
  return event;
}

export class SqliteRepository implements MileStackRepository {
  constructor(
    private readonly db: MileStackDatabase,
    private readonly sqlite: BetterSqlite3.Database,
  ) {}

  findProjectById(id: string): ProjectRecord | null {
    const project = this.db.select().from(projects).where(eq(projects.id, id)).get();
    return project ? mapProject(project) : null;
  }

  findByRootPath(rootPath: string): ProjectRecord | null {
    const project = this.db
      .select()
      .from(projects)
      .where(eq(projects.rootPath, rootPath))
      .get();
    return project ? mapProject(project) : null;
  }

  insert(project: ProjectRecord): ProjectRecord {
    return mapProject(this.db.insert(projects).values(project).returning().get());
  }

  findTaskById(id: string): TaskRecord | null {
    const task = this.db.select().from(tasks).where(eq(tasks.id, id)).get();
    return task ? mapTask(task) : null;
  }

  listByProjectId(projectId: string): TaskRecord[] {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.createdAt))
      .all()
      .map(mapTask);
  }

  listByTaskId(taskId: string): TaskEventRecord[] {
    return this.db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, taskId))
      .orderBy(asc(taskEvents.createdAt))
      .all()
      .map(mapTaskEvent);
  }

  transaction<T>(work: (transaction: TaskRepositoryTransaction) => T): T {
    return this.sqlite.transaction(() => {
      const transaction: TaskRepositoryTransaction = {
        insertTask: (task) =>
          mapTask(this.db.insert(tasks).values(task).returning().get()),
        insertTaskEvent: (event) =>
          mapTaskEvent(this.db.insert(taskEvents).values(event).returning().get()),
      };
      return work(transaction);
    })();
  }
}

export function createSqliteRepository(database: {
  db: MileStackDatabase;
  sqlite: BetterSqlite3.Database;
}): SqliteRepository {
  return new SqliteRepository(database.db, database.sqlite);
}
