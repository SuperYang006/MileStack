import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import type {
  IntegrationChecker,
  IntegrationCheckInput,
  IntegrationCheckResult,
} from "../core/integration-checker.js";

type GitResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
  signal: NodeJS.Signals | null;
};

export type GitIntegrationCheckerOptions = {
  timeoutMs?: number;
};

const defaultTimeoutMs = 5_000;
const maxBufferBytes = 64 * 1024;

export class GitIntegrationChecker implements IntegrationChecker {
  private readonly projectRoot: string;
  private readonly timeoutMs: number;

  constructor(projectRoot: string, options: GitIntegrationCheckerOptions = {}) {
    this.projectRoot = path.resolve(projectRoot);
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  }

  check(input: IntegrationCheckInput): IntegrationCheckResult {
    if (!/^[0-9a-f]{40}$/i.test(input.commitSha)) {
      return unavailable("审核提交 SHA 格式无效，无法检查本地集成。");
    }

    let projectRoot: string;
    try {
      projectRoot = realpathSync(this.projectRoot);
    } catch {
      return unavailable(`项目目录不可访问：${this.projectRoot}`);
    }

    const targetRef = `refs/heads/${input.targetBranch}`;
    const refFormat = this.run(projectRoot, ["check-ref-format", targetRef]);
    if (!refFormat.ok) {
      return unavailable(`本地目标分支名无效：${input.targetBranch}`);
    }

    const repositoryRoot = this.run(projectRoot, ["rev-parse", "--show-toplevel"]);
    if (!repositoryRoot.ok) {
      return unavailable(this.gitFailure("绑定项目目录不是可用的 Git 仓库。", repositoryRoot));
    }

    const reviewCommit = this.run(projectRoot, ["cat-file", "-e", `${input.commitSha}^{commit}`]);
    if (!reviewCommit.ok) {
      return unavailable(
        this.gitFailure(`本地仓库中找不到审核提交 ${input.commitSha}。`, reviewCommit),
      );
    }

    const targetCommit = this.run(projectRoot, ["rev-parse", "--verify", `${targetRef}^{commit}`]);
    if (!targetCommit.ok) {
      return unavailable(
        this.gitFailure(`本地目标分支 '${input.targetBranch}' 不存在或无法读取。`, targetCommit),
      );
    }
    const targetCommitSha = targetCommit.stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(targetCommitSha)) {
      return unavailable(`本地目标分支 '${input.targetBranch}' 未解析为 commit。`);
    }

    const shallow = this.run(projectRoot, ["rev-parse", "--is-shallow-repository"]);
    if (!shallow.ok || !["true", "false"].includes(shallow.stdout.trim())) {
      return unavailable(this.gitFailure("无法确认仓库历史是否完整。", shallow), targetCommitSha);
    }

    const ancestry = this.run(projectRoot, [
      "merge-base",
      "--is-ancestor",
      input.commitSha,
      targetCommitSha,
    ]);
    const currentTarget = this.run(projectRoot, ["rev-parse", "--verify", `${targetRef}^{commit}`]);
    if (!currentTarget.ok || currentTarget.stdout.trim() !== targetCommitSha) {
      return unavailable(
        `本地目标分支 '${input.targetBranch}' 在检查期间发生变化；请刷新后重试。`,
        targetCommitSha,
      );
    }

    if (ancestry.status === 0 && !ancestry.error) {
      return { status: "integrated", targetCommitSha };
    }
    if (ancestry.status === 1 && !ancestry.error) {
      if (shallow.stdout.trim() === "true") {
        return unavailable(
          `仓库历史不完整，无法确认审核提交是否进入 '${input.targetBranch}'。`,
          targetCommitSha,
        );
      }
      return {
        status: "not_integrated",
        targetCommitSha,
        message: `未检测到审核提交进入本地 '${input.targetBranch}'。若使用 squash 或 rebase，本检查无法通过原审核 SHA 证明集成。`,
      };
    }

    return unavailable(this.gitFailure("Git 无法完成审核提交的包含关系检查。", ancestry), targetCommitSha);
  }

  private run(cwd: string, args: string[]): GitResult & { ok: boolean } {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("GIT_")) delete env[key];
    }

    const result = spawnSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: this.timeoutMs,
      maxBuffer: maxBufferBytes,
      windowsHide: true,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      ...(result.error ? { error: result.error } : {}),
      signal: result.signal,
      ok: result.status === 0 && !result.error,
    };
  }

  private gitFailure(fallback: string, result: GitResult): string {
    if (result.error?.message.includes("ETIMEDOUT") || result.signal === "SIGTERM") {
      return `Git 检查超时：${fallback}`;
    }
    if (result.error?.message.includes("ENOENT")) {
      return "找不到 Git 可执行程序，无法检查本地集成。";
    }
    const detail = result.stderr.trim() || result.error?.message;
    return detail ? `${fallback} ${detail}` : fallback;
  }
}

function unavailable(message: string, targetCommitSha: string | null = null): IntegrationCheckResult {
  return { status: "unavailable", message, targetCommitSha };
}
