import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type RepositoryWithLinkedWorktree = {
  mainRoot: string;
  worktreeRoot: string;
  cleanup: () => void;
};

function runGit(directory: string, args: readonly string[]): void {
  execFileSync(
    "git",
    ["-c", "user.name=MileStack Test", "-c", "user.email=test@example.invalid", ...args],
    { cwd: directory, stdio: "ignore" },
  );
}

/**
 * Creates a git repository and a linked worktree beside it, the layout that
 * `git worktree add ../repo-task` produces. Paths are canonical so they can be
 * compared with what MileStack resolves.
 */
export function createRepositoryWithLinkedWorktree(): RepositoryWithLinkedWorktree {
  const sandbox = path.join(os.tmpdir(), `milestack-worktree-${randomUUID()}`);
  mkdirSync(sandbox, { recursive: true });
  const canonicalSandbox = realpathSync(sandbox);
  const mainRoot = path.join(canonicalSandbox, "repo");
  const worktreeRoot = path.join(canonicalSandbox, "repo-task");
  mkdirSync(mainRoot);

  runGit(mainRoot, ["init", "--initial-branch=main"]);
  runGit(mainRoot, ["commit", "--allow-empty", "-m", "initial"]);
  runGit(mainRoot, ["worktree", "add", worktreeRoot, "-b", "task"]);

  return {
    mainRoot,
    worktreeRoot,
    cleanup: () => rmSync(canonicalSandbox, { recursive: true, force: true }),
  };
}
