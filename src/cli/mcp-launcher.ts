import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

const launcherName = "milestack";

export type McpLauncher = {
  command: string;
  args: string[];
};

export type McpLauncherResolution =
  | { kind: "path"; launcher: McpLauncher }
  | { kind: "cli-entry"; cliEntryPath: string; launcher: McpLauncher }
  | { kind: "unresolved"; launcher: McpLauncher };

function isRegularFile(candidatePath: string): boolean {
  try {
    return statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

function isExecutableFile(candidatePath: string): boolean {
  try {
    accessSync(candidatePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findLauncherOnPath(searchPath: string | undefined): boolean {
  if (searchPath === undefined || searchPath === "") {
    return false;
  }
  return searchPath
    .split(path.delimiter)
    .filter((directory) => directory !== "")
    .some((directory) => {
      const candidatePath = path.join(directory, launcherName);
      return isRegularFile(candidatePath) && isExecutableFile(candidatePath);
    });
}

function resolveCliEntryScript(): string | undefined {
  const entryArgument = process.argv[1];
  if (entryArgument === undefined || entryArgument === "") {
    return undefined;
  }
  const entryPath = path.resolve(entryArgument);
  return isRegularFile(entryPath) ? entryPath : undefined;
}

export function resolveMcpLauncher(): McpLauncherResolution {
  if (findLauncherOnPath(process.env["PATH"])) {
    return { launcher: { command: launcherName, args: [] }, kind: "path" };
  }

  const cliEntryPath = resolveCliEntryScript();
  if (cliEntryPath !== undefined) {
    return {
      cliEntryPath,
      kind: "cli-entry",
      launcher: { command: process.execPath, args: [cliEntryPath] },
    };
  }

  return { launcher: { command: launcherName, args: [] }, kind: "unresolved" };
}