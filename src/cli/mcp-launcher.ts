import { accessSync, constants, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { isInsideDirectory } from "./entry-path.js";

const launcherName = "milestack";

export type McpLauncher = {
  command: string;
  args: string[];
};

export type McpLauncherResolution =
  | { kind: "path"; launcher: McpLauncher }
  | { kind: "project-cli-entry"; cliEntryPath: string; launcher: McpLauncher }
  | { kind: "cli-entry"; cliEntryPath: string; launcher: McpLauncher }
  | { kind: "unresolved"; launcher: McpLauncher };

export type McpLauncherOptions = {
  projectRoot?: string | undefined;
};

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

function realPathOrSelf(candidatePath: string): string {
  try {
    return realpathSync(candidatePath);
  } catch {
    return candidatePath;
  }
}

// A CLI started from the target project's own node_modules is a deliberate
// version pin, so it wins over a global command of the same name.
function isProjectLocalEntry(entryPath: string, projectRoot: string): boolean {
  const nodeModulesDirectory = path.join(projectRoot, "node_modules");
  const entryPaths = [entryPath, realPathOrSelf(entryPath)];
  const directories = [nodeModulesDirectory, realPathOrSelf(nodeModulesDirectory)];
  return entryPaths.some((candidate) =>
    directories.some((directory) => isInsideDirectory(candidate, directory)),
  );
}

function cliEntryResolution(
  cliEntryPath: string,
  kind: "project-cli-entry" | "cli-entry",
): McpLauncherResolution {
  return {
    cliEntryPath,
    kind,
    launcher: { command: process.execPath, args: [cliEntryPath] },
  };
}

export function resolveMcpLauncher(
  options: McpLauncherOptions = {},
): McpLauncherResolution {
  const cliEntryPath = resolveCliEntryScript();
  if (
    cliEntryPath !== undefined &&
    options.projectRoot !== undefined &&
    isProjectLocalEntry(cliEntryPath, options.projectRoot)
  ) {
    return cliEntryResolution(cliEntryPath, "project-cli-entry");
  }

  if (findLauncherOnPath(process.env["PATH"])) {
    return { launcher: { command: launcherName, args: [] }, kind: "path" };
  }

  if (cliEntryPath !== undefined) {
    return cliEntryResolution(cliEntryPath, "cli-entry");
  }

  return { launcher: { command: launcherName, args: [] }, kind: "unresolved" };
}