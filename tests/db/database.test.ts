import BetterSqlite3 from "better-sqlite3";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { ensureDatabase } from "../../src/db/ensure-database.js";
import {
  projects,
  taskDependencies,
  taskEvents,
  tasks,
} from "../../src/db/schema.js";
import {
  resolveBackupDirectory,
  resolveDatabasePath,
} from "../../src/db/paths.js";

const migrationsFolder = fileURLToPath(
  new URL("../../src/db/migrations", import.meta.url),
);
const temporaryProjects: string[] = [];

function createTemporaryProject(): string {
  const projectRoot = path.join(os.tmpdir(), `milestack-db-${randomUUID()}`);
  mkdirSync(projectRoot, { recursive: true });
  temporaryProjects.push(projectRoot);
  return projectRoot;
}

function insertProjectData(
  database: Awaited<ReturnType<typeof ensureDatabase>>,
): void {
  database.db
    .insert(projects)
    .values({
      id: "project-1",
      name: "MileStack",
      rootPath: "/tmp/milestack",
      goal: "Track project progress",
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
    })
    .run();
  database.db
    .insert(tasks)
    .values({
      id: "task-1",
      projectId: "project-1",
      title: "Persist data",
      acceptanceCriteria: ["Data survives restart"],
      status: "ready",
      queuePosition: 1,
      createdBy: "developer",
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
    })
    .run();
  database.db
    .insert(taskEvents)
    .values({
      id: "event-1",
      projectId: "project-1",
      taskId: "task-1",
      type: "created",
      summary: "Task created",
      completedWork: ["Defined the task"],
      createdAt: "2026-10-11T00:00:00.000Z",
    })
    .run();
}

afterEach(() => {
  for (const projectRoot of temporaryProjects.splice(0)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

describe("SQLite database foundation", () => {
  it("creates the schema, configures SQLite, and preserves data on re-open", async () => {
    const projectRoot = createTemporaryProject();
    const database = await ensureDatabase(projectRoot);

    const tableRows = database.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('projects', 'tasks', 'task_events', 'task_dependencies') ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    expect(tableRows.map((row) => row.name)).toEqual([
      "projects",
      "task_dependencies",
      "task_events",
      "tasks",
    ]);
    expect(database.databasePath).toBe(resolveDatabasePath(projectRoot));
    expect(database.sqlite.pragma("journal_mode", { simple: true })).toBe(
      "wal",
    );
    expect(database.sqlite.pragma("busy_timeout", { simple: true })).toBe(
      5000,
    );
    expect(database.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);

    insertProjectData(database);
    database.close();

    const reopened = await ensureDatabase(projectRoot);
    const storedTask = reopened.db.select().from(tasks).get();
    const storedEvent = reopened.db.select().from(taskEvents).get();

    expect(storedTask?.acceptanceCriteria).toEqual(["Data survives restart"]);
    expect(storedEvent?.completedWork).toEqual(["Defined the task"]);
    reopened.close();
  });

  it("enforces foreign keys and does not depend on the sqlite CLI", async () => {
    const projectRoot = createTemporaryProject();
    const database = await ensureDatabase(projectRoot);

    expect(() =>
      database.db
        .insert(tasks)
        .values({
          id: "orphan-task",
          projectId: "missing-project",
          title: "Invalid",
          createdBy: "agent",
          createdAt: "2026-10-11T00:00:00.000Z",
          updatedAt: "2026-10-11T00:00:00.000Z",
        })
        .run(),
    ).toThrow();

    database.close();
  });

  it("cascades dependency-owner deletion and restricts prerequisite deletion", async () => {
    const projectRoot = createTemporaryProject();
    const database = await ensureDatabase(projectRoot);
    insertProjectData(database);
    database.db
      .insert(tasks)
      .values({
        id: "task-2",
        projectId: "project-1",
        title: "Use persisted data",
        status: "ready",
        queuePosition: 2,
        createdBy: "developer",
        createdAt: "2026-10-11T00:01:00.000Z",
        updatedAt: "2026-10-11T00:01:00.000Z",
      })
      .run();
    database.db
      .insert(taskDependencies)
      .values({ taskId: "task-2", dependsOnTaskId: "task-1" })
      .run();

    database.db.delete(tasks).where(eq(tasks.id, "task-2")).run();
    expect(database.db.select().from(taskDependencies).all()).toEqual([]);

    database.db
      .insert(tasks)
      .values({
        id: "task-2",
        projectId: "project-1",
        title: "Use persisted data again",
        status: "ready",
        queuePosition: 2,
        createdBy: "developer",
        createdAt: "2026-10-11T00:01:00.000Z",
        updatedAt: "2026-10-11T00:01:00.000Z",
      })
      .run();
    database.db
      .insert(taskDependencies)
      .values({ taskId: "task-2", dependsOnTaskId: "task-1" })
      .run();

    expect(() => database.db.delete(tasks).where(eq(tasks.id, "task-1")).run()).toThrow();
    expect(database.db.select().from(tasks).all()).toHaveLength(2);
    database.close();
  });

  it("backs up an existing database before applying a new migration", async () => {
    const projectRoot = createTemporaryProject();
    const database = await ensureDatabase(projectRoot);
    insertProjectData(database);
    database.close();

    const customMigrationsFolder = path.join(projectRoot, "test-migrations");
    cpSync(migrationsFolder, customMigrationsFolder, { recursive: true });
    const journalPath = path.join(customMigrationsFolder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<Record<string, boolean | number | string>>;
    };
    journal.entries.push({
      idx: journal.entries.length,
      version: "7",
      when: Number(journal.entries.at(-1)?.when ?? 0) + 1,
      tag: "0002_test_marker",
      breakpoints: false,
    });
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
    writeFileSync(
      path.join(customMigrationsFolder, "0002_test_marker.sql"),
      "CREATE TABLE migration_marker (id text PRIMARY KEY NOT NULL);\n",
    );

    const migrated = await ensureDatabase(projectRoot, {
      migrationsFolder: customMigrationsFolder,
      now: () => new Date("2026-10-11T12:34:56.789Z"),
    });

    const marker = migrated.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_marker'",
      )
      .get() as { name: string } | undefined;
    expect(marker?.name).toBe("migration_marker");
    expect(migrated.db.select().from(projects).all()).toHaveLength(1);
    expect(migrated.db.select().from(taskEvents).all()).toHaveLength(1);
    migrated.close();

    const backupNames = readdirSync(resolveBackupDirectory(projectRoot)).filter(
      (entry) => entry.endsWith(".db"),
    );
    expect(backupNames).toHaveLength(1);

    const backup = new BetterSqlite3(
      path.join(resolveBackupDirectory(projectRoot), backupNames[0]!),
    );
    const backupTask = backup
      .prepare("SELECT id FROM tasks WHERE id = 'task-1'")
      .get() as { id: string } | undefined;
    expect(backupTask?.id).toBe("task-1");
    backup.close();

    expect(resolveDatabasePath(projectRoot)).toContain(
      path.join(".milestack", "milestack.db"),
    );
    expect(readFileSync(resolveDatabasePath(projectRoot)).byteLength).toBeGreaterThan(
      0,
    );
  });
});
