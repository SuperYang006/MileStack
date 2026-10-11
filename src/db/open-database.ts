import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { DatabaseOpenError } from "./errors.js";
import { resolveDatabasePath } from "./paths.js";
import { schema } from "./schema.js";

export type MileStackDatabase = BetterSQLite3Database<typeof schema>;

export type OpenDatabase = {
  databasePath: string;
  sqlite: BetterSqlite3.Database;
  db: MileStackDatabase;
  close: () => void;
};

export function openDatabase(projectRoot: string): OpenDatabase {
  const databasePath = resolveDatabasePath(projectRoot);

  let sqlite: BetterSqlite3.Database | undefined;
  try {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    sqlite = new BetterSqlite3(databasePath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("foreign_keys = ON");
  } catch (error) {
    sqlite?.close();
    throw new DatabaseOpenError(
      `Unable to open MileStack database at ${databasePath}.`,
      { cause: error },
    );
  }

  if (!sqlite) {
    throw new DatabaseOpenError(
      `Unable to open MileStack database at ${databasePath}.`,
    );
  }

  const db = drizzle(sqlite, { schema });

  return {
    databasePath,
    sqlite,
    db,
    close: () => sqlite.close(),
  };
}
