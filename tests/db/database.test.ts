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
  taskReviews,
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

  it("migrates legacy task data to review statuses without losing history", async () => {
    const projectRoot = createTemporaryProject();
    const legacyMigrationsFolder = path.join(projectRoot, "legacy-migrations");
    cpSync(migrationsFolder, legacyMigrationsFolder, { recursive: true });
    rmSync(path.join(legacyMigrationsFolder, "0002_productive_bruce_banner.sql"));
    rmSync(path.join(legacyMigrationsFolder, "meta", "0002_snapshot.json"));
    const legacyJournalPath = path.join(legacyMigrationsFolder, "meta", "_journal.json");
    const legacyJournal = JSON.parse(readFileSync(legacyJournalPath, "utf8")) as {
      entries: Array<Record<string, boolean | number | string>>;
    };
    legacyJournal.entries = legacyJournal.entries.slice(0, 2);
    writeFileSync(legacyJournalPath, `${JSON.stringify(legacyJournal, null, 2)}\n`);

    const legacyDatabase = await ensureDatabase(projectRoot, {
      migrationsFolder: legacyMigrationsFolder,
    });
    legacyDatabase.db
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
    legacyDatabase.sqlite
      .prepare(
        "INSERT INTO tasks (id, project_id, title, status, queue_position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "task-1",
        "project-1",
        "Persist data",
        "ready",
        1,
        "developer",
        "2026-10-11T00:00:00.000Z",
        "2026-10-11T00:00:00.000Z",
      );
    legacyDatabase.sqlite
      .prepare(
        "INSERT INTO task_events (id, project_id, task_id, type, summary, completed_work, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "event-1",
        "project-1",
        "task-1",
        "created",
        "Task created",
        JSON.stringify(["Defined the task"]),
        "2026-10-11T00:00:00.000Z",
      );
    legacyDatabase.sqlite
      .prepare(
        "INSERT INTO tasks (id, project_id, title, status, queue_position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "task-2",
        "project-1",
        "Preserve dependency",
        "ready",
        2,
        "developer",
        "2026-10-11T00:01:00.000Z",
        "2026-10-11T00:01:00.000Z",
      );
    legacyDatabase.db
      .insert(taskDependencies)
      .values({ taskId: "task-2", dependsOnTaskId: "task-1" })
      .run();
    legacyDatabase.close();

    const migrated = await ensureDatabase(projectRoot, {
      now: () => new Date("2026-10-11T13:00:00.000Z"),
    });
    expect(migrated.db.select().from(projects).all()).toHaveLength(1);
    expect(migrated.db.select().from(tasks).all()).toHaveLength(2);
    expect(migrated.db.select().from(taskEvents).all()).toHaveLength(1);
    expect(migrated.db.select().from(taskDependencies).all()).toEqual([
      { taskId: "task-2", dependsOnTaskId: "task-1" },
    ]);

    migrated.db
      .update(tasks)
      .set({ status: "in_review", completedAt: null })
      .where(eq(tasks.id, "task-1"))
      .run();
    migrated.db
      .insert(taskEvents)
      .values({
        id: "event-review",
        projectId: "project-1",
        taskId: "task-1",
        type: "submitted_for_review",
        summary: "Submitted for review",
        createdAt: "2026-10-11T13:00:00.000Z",
      })
      .run();
    expect(migrated.db.select().from(tasks).get()?.status).toBe("in_review");
    expect(migrated.db.select().from(taskEvents).all()).toHaveLength(2);
    migrated.close();
  });

  it("applies review migration after a closed 0002 database and recovers legacy reviews", async () => {
    const projectRoot = createTemporaryProject();
    const migrationsAt0002 = path.join(projectRoot, "migrations-at-0002");
    cpSync(migrationsFolder, migrationsAt0002, { recursive: true });
    rmSync(path.join(migrationsAt0002, "0003_elite_tombstone.sql"));
    rmSync(path.join(migrationsAt0002, "0004_recover_legacy_review_tasks.sql"));
    rmSync(path.join(migrationsAt0002, "meta", "0003_snapshot.json"));
    rmSync(path.join(migrationsAt0002, "meta", "0004_snapshot.json"));
    const journalPath = path.join(migrationsAt0002, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<Record<string, boolean | number | string>>;
    };
    journal.entries = journal.entries.slice(0, 3);
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

    const legacy = await ensureDatabase(projectRoot, {
      migrationsFolder: migrationsAt0002,
    });
    legacy.sqlite
      .prepare(
        "INSERT INTO projects (id, name, root_path, goal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "project-1",
        "MileStack",
        projectRoot,
        "Track review migrations",
        "2026-10-12T00:00:00.000Z",
        "2026-10-12T00:00:00.000Z",
      );
    legacy.sqlite
      .prepare(
        "INSERT INTO tasks (id, project_id, title, status, queue_position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "task-legacy-review",
        "project-1",
        "Recover old review",
        "in_review",
        null,
        "developer",
        "2026-10-12T00:01:00.000Z",
        "2026-10-12T00:01:00.000Z",
      );
    legacy.sqlite
      .prepare(
        "INSERT INTO tasks (id, project_id, title, status, queue_position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "task-ready",
        "project-1",
        "Keep dependency",
        "ready",
        1,
        "developer",
        "2026-10-12T00:02:00.000Z",
        "2026-10-12T00:02:00.000Z",
      );
    legacy.sqlite
      .prepare(
        "INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)",
      )
      .run("task-ready", "task-legacy-review");
    legacy.sqlite
      .prepare(
        "INSERT INTO task_events (id, project_id, task_id, type, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "legacy-created",
        "project-1",
        "task-legacy-review",
        "created",
        "Task created",
        "2026-10-12T00:01:00.000Z",
      );
    legacy.sqlite
      .prepare(
        "INSERT INTO task_events (id, project_id, task_id, type, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "legacy-submitted",
        "project-1",
        "task-legacy-review",
        "submitted_for_review",
        "Submitted before review records existed",
        "2026-10-12T00:03:00.000Z",
      );
    legacy.close();

    const migrated = await ensureDatabase(projectRoot, {
      now: () => new Date("2026-10-12T00:04:00.000Z"),
    });
    expect(migrated.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    const recoveredTask = migrated.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, "task-legacy-review"))
      .get();
    expect(recoveredTask).toMatchObject({
      status: "ready",
      queuePosition: 2,
      activeRunId: null,
      activeReviewRunId: null,
      riskLevel: "medium",
      riskConfirmed: true,
    });
    expect(recoveredTask?.handoffNote).toContain(
      "fresh submission with a real commit SHA",
    );
    expect(migrated.db.select().from(taskReviews).all()).toEqual([]);
    expect(
      migrated.db
        .select()
        .from(taskDependencies)
        .all(),
    ).toEqual([{ taskId: "task-ready", dependsOnTaskId: "task-legacy-review" }]);
    expect(
      migrated.db
        .select()
        .from(taskEvents)
        .all()
        .filter((event) => event.taskId === "task-legacy-review")
        .map((event) => event.type),
    ).toEqual(["created", "submitted_for_review", "progress"]);
    const eventCount = migrated.db.select().from(taskEvents).all().length;
    migrated.close();

    const reopened = await ensureDatabase(projectRoot);
    expect(reopened.db.select().from(taskEvents).all()).toHaveLength(eventCount);
    reopened.close();
  });

  it("recovers a legacy in_review task from a database that already applied 0003", async () => {
    const projectRoot = createTemporaryProject();
    const migrationsAt0003 = path.join(projectRoot, "migrations-at-0003");
    cpSync(migrationsFolder, migrationsAt0003, { recursive: true });
    rmSync(path.join(migrationsAt0003, "0004_recover_legacy_review_tasks.sql"));
    rmSync(path.join(migrationsAt0003, "meta", "0004_snapshot.json"));
    const journalPath = path.join(migrationsAt0003, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<Record<string, boolean | number | string>>;
    };
    journal.entries = journal.entries.slice(0, 4);
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

    const databaseAt0003 = await ensureDatabase(projectRoot, {
      migrationsFolder: migrationsAt0003,
    });
    databaseAt0003.db
      .insert(projects)
      .values({
        id: "project-1",
        name: "MileStack",
        rootPath: projectRoot,
        goal: "Recover legacy review state",
        createdAt: "2026-10-12T01:00:00.000Z",
        updatedAt: "2026-10-12T01:00:00.000Z",
      })
      .run();
    databaseAt0003.db
      .insert(tasks)
      .values({
        id: "task-legacy-0003",
        projectId: "project-1",
        title: "Recover already migrated review",
        status: "in_review",
        createdBy: "developer",
        createdAt: "2026-10-12T01:01:00.000Z",
        updatedAt: "2026-10-12T01:01:00.000Z",
      })
      .run();
    databaseAt0003.db
      .insert(taskEvents)
      .values({
        id: "legacy-0003-submitted",
        projectId: "project-1",
        taskId: "task-legacy-0003",
        type: "submitted_for_review",
        summary: "Submitted before review recovery existed",
        createdAt: "2026-10-12T01:02:00.000Z",
      })
      .run();
    databaseAt0003.close();

    const recovered = await ensureDatabase(projectRoot);
    expect(
      recovered.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, "task-legacy-0003"))
        .get(),
    ).toMatchObject({
      status: "ready",
      activeReviewRunId: null,
      riskLevel: "medium",
      riskConfirmed: true,
    });
    expect(
      recovered.db
        .select()
        .from(taskEvents)
        .all()
        .map((event) => event.type),
    ).toEqual(["submitted_for_review", "progress"]);
    recovered.close();
  });
});
