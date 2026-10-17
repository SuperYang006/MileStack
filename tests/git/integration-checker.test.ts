import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { GitIntegrationChecker } from "../../src/git/integration-checker.js";

const temporaryRepositories: string[] = [];

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
}

function commit(repository: string, filename: string, content: string, message: string): string {
  writeFileSync(path.join(repository, filename), content);
  git(repository, "add", filename);
  git(repository, "commit", "-m", message);
  return git(repository, "rev-parse", "HEAD");
}

function createRepository(): string {
  const repository = path.join(os.tmpdir(), `milestack-git-check-${randomUUID()}`);
  mkdirSync(repository, { recursive: true });
  temporaryRepositories.push(repository);
  git(repository, "init", "-b", "main");
  git(repository, "config", "user.name", "MileStack Test");
  git(repository, "config", "user.email", "milestack-test@example.invalid");
  git(repository, "config", "core.hooksPath", "/dev/null");
  commit(repository, "README.md", "base\n", "initial commit");
  return repository;
}

afterEach(() => {
  for (const repository of temporaryRepositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe("GitIntegrationChecker", () => {
  it("recognizes a fast-forward integration after the source branch is deleted", () => {
    const repository = createRepository();
    git(repository, "checkout", "-b", "feature/fast-forward");
    const reviewedCommit = commit(repository, "feature.txt", "reviewed\n", "reviewed commit");
    const checker = new GitIntegrationChecker(repository);

    expect(checker.check({ commitSha: reviewedCommit, targetBranch: "main" }).status)
      .toBe("not_integrated");
    git(repository, "checkout", "main");
    git(repository, "merge", "--ff-only", "feature/fast-forward");
    git(repository, "branch", "-d", "feature/fast-forward");

    expect(checker.check({ commitSha: reviewedCommit, targetBranch: "main" })).toEqual({
      status: "integrated",
      targetCommitSha: reviewedCommit,
    });
  });

  it("recognizes a reviewed commit made directly on the target branch", () => {
    const repository = createRepository();
    const reviewedCommit = commit(repository, "direct.txt", "reviewed\n", "reviewed on main");
    const checker = new GitIntegrationChecker(repository);

    expect(checker.check({ commitSha: reviewedCommit, targetBranch: "main" })).toEqual({
      status: "integrated",
      targetCommitSha: reviewedCommit,
    });
  });

  it("recognizes a normal merge but does not treat squash as the reviewed commit", () => {
    const repository = createRepository();
    git(repository, "checkout", "-b", "feature/normal-merge");
    const reviewedCommit = commit(repository, "reviewed.txt", "reviewed\n", "reviewed commit");
    git(repository, "checkout", "main");
    commit(repository, "main.txt", "main change\n", "main change");
    git(repository, "merge", "--no-ff", "-m", "merge reviewed branch", "feature/normal-merge");
    const checker = new GitIntegrationChecker(repository);

    expect(checker.check({ commitSha: reviewedCommit, targetBranch: "main" }).status)
      .toBe("integrated");
    git(repository, "branch", "-d", "feature/normal-merge");
    expect(checker.check({ commitSha: reviewedCommit, targetBranch: "main" }).status)
      .toBe("integrated");

    git(repository, "checkout", "-b", "feature/squash");
    const squashedReview = commit(repository, "squashed.txt", "same patch\n", "review before squash");
    git(repository, "checkout", "main");
    git(repository, "merge", "--squash", "feature/squash");
    git(repository, "commit", "-m", "squash reviewed patch");
    const squashResult = checker.check({ commitSha: squashedReview, targetBranch: "main" });

    if (squashResult.status !== "not_integrated") {
      throw new Error(`Expected squash result to be not_integrated, got ${squashResult.status}.`);
    }
    expect(squashResult.message).toContain("squash 或 rebase");
  });

  it("fails closed for an unavailable local target and invalid commit identifier", () => {
    const repository = createRepository();
    const checker = new GitIntegrationChecker(repository);

    expect(checker.check({ commitSha: "not-a-commit", targetBranch: "main" })).toMatchObject({
      status: "unavailable",
    });
    expect(checker.check({ commitSha: git(repository, "rev-parse", "HEAD"), targetBranch: "missing" })).toMatchObject({
      status: "unavailable",
      message: expect.stringContaining("本地目标分支 'missing'"),
    });
  });
});
