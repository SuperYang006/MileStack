import path from "node:path";

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
