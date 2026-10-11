import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DatabaseBackupError,
  DatabaseMigrationError,
  DatabaseOpenError,
} from "./errors.js";
import { openDatabase, type OpenDatabase } from "./open-database.js";
import { resolveBackupDirectory, resolveDatabasePath } from "./paths.js";

const defaultMigrationsFolder = fileURLToPath(
  new URL("./migrations", import.meta.url),
);

export type EnsureDatabaseOptions = {
  migrationsFolder?: string;
  now?: () => Date;
};

type MigrationRecord = {
  createdAt: number;
};

function hasPendingMigrations(
  database: OpenDatabase,
  migrationsFolder: string,
): boolean {
  const migrations = readMigrationFiles({ migrationsFolder });
  if (migrations.length === 0) {
    return false;
  }

  const migrationTable = database.sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  if (!migrationTable) {
    return true;
  }

  const lastMigration = database.sqlite
    .prepare(
      "SELECT created_at AS createdAt FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
    )
    .get() as MigrationRecord | undefined;

  return (
    !lastMigration ||
    Number(lastMigration.createdAt) < migrations[migrations.length - 1]!.folderMillis
  );
}

function formatBackupTimestamp(now: Date): string {
  return now.toISOString().replace(/[.:]/g, "-");
}

function nextBackupPath(backupDirectory: string, timestamp: string): string {
  const basePath = path.join(backupDirectory, `${timestamp}.db`);
  if (!existsSync(basePath)) {
    return basePath;
  }

  for (let suffix = 1; ; suffix += 1) {
    const candidate = path.join(backupDirectory, `${timestamp}-${suffix}.db`);
    if (!existsSync(candidate)) {
      return candidate;
    }
  }
}

async function backupDatabase(
  database: OpenDatabase,
  projectRoot: string,
  now: () => Date,
): Promise<string> {
  const backupDirectory = resolveBackupDirectory(projectRoot);
  let backupPath = backupDirectory;

  try {
    mkdirSync(backupDirectory, { recursive: true });
    backupPath = nextBackupPath(
      backupDirectory,
      formatBackupTimestamp(now()),
    );
    await database.sqlite.backup(backupPath);
  } catch (error) {
    throw new DatabaseBackupError(
      `Unable to back up the existing database to ${backupPath}.`,
      { cause: error },
    );
  }

  return backupPath;
}

export async function ensureDatabase(
  projectRoot: string,
  options: EnsureDatabaseOptions = {},
): Promise<OpenDatabase> {
  const databasePath = resolveDatabasePath(projectRoot);
  const databaseExisted = existsSync(databasePath);
  const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder;
  const now = options.now ?? (() => new Date());
  let database: OpenDatabase | undefined;

  try {
    database = openDatabase(projectRoot);
    const hasExistingDataFile =
      databaseExisted && statSync(databasePath).size > 0;

    if (
      hasExistingDataFile &&
      hasPendingMigrations(database, migrationsFolder)
    ) {
      await backupDatabase(database, projectRoot, now);
    }

    migrate(database.db, { migrationsFolder });
    return database;
  } catch (error) {
    database?.close();
    if (
      error instanceof DatabaseBackupError ||
      error instanceof DatabaseMigrationError ||
      error instanceof DatabaseOpenError
    ) {
      throw error;
    }

    throw new DatabaseMigrationError(
      `Unable to migrate MileStack database at ${databasePath}.`,
      { cause: error },
    );
  }
}
