import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { runMcp } from "../mcp/server.js";
import type { ProjectStatus, TaskSummary } from "../core/query-contract.js";
import {
  initializeProject,
  openProjectContext,
  resolveProjectRoot,
} from "../project/project-context.js";

export const helpText = `Usage: milestack <command> [options]

Commands:
  init                 Initialize MileStack for a project
  status               Show the current project status
  mcp                  Run the MCP stdio server

Options:
  --project <path>     Project root (defaults to the current directory)
  -h, --help           Show this help message
`;

export type CliOutput = {
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
};

const defaultOutput: CliOutput = {
  writeStdout: (message) => process.stdout.write(message),
  writeStderr: (message) => process.stderr.write(message),
};

type ParsedCommand = {
  command: "init" | "status" | "mcp";
  projectPath?: string | undefined;
};

function parseCommand(args: readonly string[]): ParsedCommand {
  const [command, ...options] = args;
  if (command !== "init" && command !== "status" && command !== "mcp") {
    throw new Error(`Unknown command '${command ?? ""}'.`);
  }

  let projectPath: string | undefined;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--project") {
      const value = options[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--project requires a directory path.");
      }
      projectPath = value;
      index += 1;
      continue;
    }
    if (option?.startsWith("--project=")) {
      const value = option.slice("--project=".length);
      if (!value) {
        throw new Error("--project requires a directory path.");
      }
      projectPath = value;
      continue;
    }
    if (option === "--help" || option === "-h") {
      continue;
    }
    throw new Error(`Unknown option '${option}'.`);
  }

  return { command, projectPath };
}

function ensureGitignoreEntry(projectRoot: string): void {
  const gitignorePath = `${projectRoot}/.gitignore`;
  const existing = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf8")
    : "";
  const lines = existing.split(/\r?\n/);
  if (lines.some((line) => line.trim() === ".milestack/" || line.trim() === ".milestack")) {
    return;
  }

  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(gitignorePath, `${existing}${prefix}.milestack/\n`);
}

function formatTask(task: TaskSummary): string {
  let availability: string = task.status;
  if (task.status === "ready") {
    availability = task.runnable ? "可执行" : "等待依赖";
  }
  const waiting = task.waitingFor.length > 0
    ? `；等待：${task.waitingFor.map((dependency) => `${dependency.title} (${dependency.id})`).join(", ")}`
    : "";
  const details = [task.currentStep, task.nextStep, task.blocker]
    .filter((value): value is string => Boolean(value))
    .join("；");
  return `  - [${availability}] ${task.title} (${task.id})${waiting}${details ? `；${details}` : ""}`;
}

function formatTaskSection(
  title: string,
  tasks: TaskSummary[],
): string[] {
  return [
    `${title} (${tasks.length})`,
    ...(tasks.length > 0 ? tasks.map(formatTask) : ["  - 无"]),
  ];
}

function formatProjectStatus(status: ProjectStatus): string {
  const sections = [
    `项目：${status.project.name} (${status.project.id})`,
    ...formatTaskSection("当前", status.current),
    ...formatTaskSection("下一步", status.next),
    ...formatTaskSection("阻塞", status.blocked),
    ...formatTaskSection("Inbox", status.inbox),
    ...formatTaskSection("最近完成", status.recentlyCompleted),
  ];
  const runnableCount = status.next.filter((task) => task.runnable).length;
  if (runnableCount > 1) {
    sections.push(`可并行任务：${runnableCount}`);
  }
  return `${sections.join("\n")}\n`;
}

function integrationInstructions(): string {
  return `MILESTACK_START
- MileStack 是本项目任务和进度的事实源。不要新建或维护独立的 TODO、进度、计划或交接任务文档。
- 开始工作前调用 get_project_status，确认项目当前状态和下一任务。
- 处理具体任务前调用 get_task，读取目标、验收条件和历史进度。
- 按 next 的队列顺序选择 runnable 为 true 的任务；等待依赖的任务暂不领取。
- 执行中发现的新工作通过 create_task 记录到 inbox，不要写入新的任务文档。
MILESTACK_END`;
}

async function runInit(projectPath: string | undefined, output: CliOutput): Promise<void> {
  const projectRoot = resolveProjectRoot(projectPath);
  const context = await initializeProject(projectRoot);
  try {
    ensureGitignoreEntry(projectRoot);
    const configuration = {
      mcpServers: {
        milestack: {
          command: "milestack",
          args: ["mcp", "--project", projectRoot],
        },
      },
    };
    output.writeStdout(
      `${context.created ? "Initialized" : "Already initialized"} ${projectRoot}\n` +
        `Database: ${context.database.databasePath}\n\n` +
        `MCP configuration:\n${JSON.stringify(configuration, null, 2)}\n\n` +
        `AI integration instructions:\n${integrationInstructions()}\n`,
    );
  } finally {
    context.database.close();
  }
}

async function runStatus(projectPath: string | undefined, output: CliOutput): Promise<void> {
  const projectRoot = resolveProjectRoot(projectPath);
  const context = await openProjectContext(projectRoot);
  try {
    output.writeStdout(formatProjectStatus(context.service.getProjectStatus({ projectId: context.project.id })));
  } finally {
    context.database.close();
  }
}

export async function runCli(
  args: readonly string[],
  output: CliOutput = defaultOutput,
): Promise<number> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    output.writeStdout(helpText);
    return 0;
  }

  try {
    const parsed = parseCommand(args);
    if (parsed.command === "init") {
      await runInit(parsed.projectPath, output);
      return 0;
    }
    if (parsed.command === "status") {
      await runStatus(parsed.projectPath, output);
      return 0;
    }
    await runMcp(resolveProjectRoot(parsed.projectPath));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.writeStderr(`Error: ${message}\n`);
    return 1;
  }
}
