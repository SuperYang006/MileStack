import { spawn } from "node:child_process";

export type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export type CommandInvocation = {
  command: string;
  args: readonly string[];
  cwd?: string | undefined;
  // Aborts a long-running query when the owner is shutting down.
  signal?: AbortSignal | undefined;
};

export type CommandRunner = (invocation: CommandInvocation) => Promise<CommandResult>;

const queryTimeoutMs = 60_000;
const installTimeoutMs = 300_000;
const maxCommandOutputChars = 1024 * 1024;

export function npmExecutable(platform: NodeJS.Platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function pnpmExecutable(platform: NodeJS.Platform): string {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

const failureOutputLineLimit = 20;

// The package manager's own words, last lines first-class: the cause of a
// failure is almost always at the end.
export function failureOutputLines(result: CommandResult): string[] {
  if (result.error?.message !== undefined) {
    return [result.error.message];
  }
  const lines = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return [`退出码 ${result.status ?? "unknown"}`];
  }
  return lines.slice(-failureOutputLineLimit);
}

// Runs without blocking the event loop so progress displays and the HTTP
// service stay responsive while the package manager works.
export function defaultRunCommand(invocation: CommandInvocation): Promise<CommandResult> {
  const isQuery = invocation.args[0] === "prefix" || invocation.args[0] === "view";
  const timeoutMs = isQuery ? queryTimeoutMs : installTimeoutMs;
  const signal = invocation.signal;
  if (signal?.aborted) {
    return Promise.resolve({
      status: null,
      stdout: "",
      stderr: "",
      error: new Error("命令已取消"),
    });
  }
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let abortHandler: (() => void) | undefined;
    const settle = (status: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (abortHandler !== undefined) {
        signal?.removeEventListener("abort", abortHandler);
      }
      resolve({ status, stdout, stderr, ...(failure ? { error: failure } : {}) });
    };
    const keepTail = (current: string, chunk: Buffer) =>
      (current + chunk.toString("utf8")).slice(-maxCommandOutputChars);

    const child = spawn(invocation.command, [...invocation.args], {
      ...(invocation.cwd !== undefined ? { cwd: invocation.cwd } : {}),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    abortHandler = () => {
      failure = new Error("命令已取消");
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      settle(null);
    };
    timer = setTimeout(() => {
      failure = new Error(`命令超过 ${timeoutMs / 1000} 秒未结束，已终止`);
      child.kill();
    }, timeoutMs);
    if (signal?.aborted) {
      abortHandler();
    } else {
      signal?.addEventListener("abort", abortHandler, { once: true });
    }
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = keepTail(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = keepTail(stderr, chunk);
    });
    child.on("error", (error) => {
      failure = error;
      settle(null);
    });
    child.on("close", (status) => settle(status));
  });
}
