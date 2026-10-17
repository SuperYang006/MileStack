import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * Absolute path of the running CLI entry (`process.argv[1]`) with symlinks
 * resolved, so a global bin link reports the real installed script.
 */
export function resolveEntryPath(): string {
  const entry = process.argv[1];
  if (entry === undefined || entry.length === 0) {
    return path.resolve("");
  }
  try {
    return realpathSync(entry);
  } catch {
    return path.resolve(entry);
  }
}

/** True when `candidatePath` is strictly inside `directory` (not the directory itself). */
export function isInsideDirectory(candidatePath: string, directory: string): boolean {
  const relative = path.relative(directory, candidatePath);
  return (
    relative !== "" &&
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`)
  );
}
