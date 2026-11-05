import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

export type LinkedWorktree = {
  /** Root directory of the linked worktree containing the starting directory. */
  worktreeRoot: string;
  /** Root directory of the repository's main worktree. */
  mainWorktreeRoot: string;
};

const gitTimeoutMs = 5_000;

function runGit(directory: string, args: readonly string[]): string | undefined {
  const result = spawnSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    timeout: gitTimeoutMs,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0) {
    return undefined;
  }
  return result.stdout;
}

function canonicalPath(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
}

/**
 * Returns the worktree pair when `directory` is inside a linked git worktree,
 * and `undefined` for a main worktree, a bare repository, a directory outside
 * git, or an environment without git.
 */
export function findLinkedWorktree(directory: string): LinkedWorktree | undefined {
  const toplevel = runGit(directory, ["rev-parse", "--show-toplevel"])?.trim();
  const worktreeList = runGit(directory, ["worktree", "list", "--porcelain"]);
  if (!toplevel || worktreeList === undefined) {
    return undefined;
  }

  // The first entry of `git worktree list` is always the main worktree.
  const [mainEntry] = worktreeList.split(/\r?\n\r?\n/);
  const mainLines = mainEntry?.split(/\r?\n/) ?? [];
  const mainLine = mainLines.find((line) => line.startsWith("worktree "));
  if (!mainLine || mainLines.includes("bare")) {
    return undefined;
  }

  const mainWorktreeRoot = canonicalPath(mainLine.slice("worktree ".length));
  const worktreeRoot = canonicalPath(toplevel);
  if (worktreeRoot === mainWorktreeRoot) {
    return undefined;
  }
  return { worktreeRoot, mainWorktreeRoot };
}
