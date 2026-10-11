import path from "node:path";

export function resolveDatabasePath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".milestack", "milestack.db");
}

export function resolveBackupDirectory(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".milestack", "backups");
}
