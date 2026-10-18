import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { runMcp } from "../mcp/server.js";
import { runtimeVersion } from "../server/runtime-version.js";
import { startHttpServer } from "../server/server.js";
import {
  formatAgentIntegrationInstructions,
  formatProjectAgentInstructions,
  projectAgentInstructionsPath,
  rootAgentInstructionSnippet,
  rootAgentInstructionsFile,
} from "../core/agent-instructions.js";
import type { ProjectStatus, TaskSummary } from "../core/query-contract.js";
import {
  discoverProjectRoot,
  initializeProject,
  openProjectContext,
  resolveProjectRoot,
} from "../project/project-context.js";
import { resolveEntryPath } from "./entry-path.js";
import { defaultOutput, type CliOutput } from "./output.js";
import {
  configureProjectMcpClients,
  projectMcpClientDisplayNames,
  projectMcpClientNames,
  type ProjectMcpClientName,
  type ProjectMcpConfigResult,
} from "./project-mcp-config.js";
import {
  defaultUpdateDependencies,
  runUpdate,
  type UpdateDependencies,
} from "./update.js";

export const helpText = `Usage: milestack <command> [options]

Commands:
  init                 Initialize MileStack for a project
  status               Show the current project status
  mcp                  Run the MCP stdio server
  serve                Run the HTTP web and API server
  update               Upgrade npm global and package.json-declared project-local installs, then refresh generated project files
Options:
  --project <path>     Project root (defaults to the current directory)
  --discover           Auto-discover the project by walking up from cwd (for mcp/status)
  --json               Output JSON format (for status command)
  --port <port>        Server port (for serve command)
  --check              Report versions and generated-file status without installing or writing (for update command)
  --client <name>      Project-only MCP config for init; repeatable or comma-separated (claude, cursor, grok, codex, opencode, agy)
  -v, --version        Print the version number and the resolved entry path, then exit
  -h, --help           Show this help message
`;

type ParsedCommand = {
  command: "init" | "status" | "mcp" | "serve" | "update";
  projectPath?: string | undefined;
  discover?: boolean | undefined;
  port?: number | undefined;
  json?: boolean | undefined;
  clients?: ProjectMcpClientName[] | undefined;
  check?: boolean | undefined;
};

function isProjectMcpClientName(value: string): value is ProjectMcpClientName {
  return (projectMcpClientNames as readonly string[]).includes(value);
}

function parseClientNames(value: string): ProjectMcpClientName[] {
  const names = value.split(",").map((name) => name.trim());
  if (names.some((name) => name.length === 0)) {
    throw new Error("--client requires one or more client names.");
  }

  const clients: ProjectMcpClientName[] = [];
  for (const name of names) {
    if (!isProjectMcpClientName(name)) {
      throw new Error(
        `Unknown MCP client '${name}'. Supported clients: ${projectMcpClientNames.join(", ")}.`,
      );
    }
    if (!clients.includes(name)) {
      clients.push(name);
    }
  }
  return clients;
}

function parseCommand(args: readonly string[]): ParsedCommand {
  const [command, ...options] = args;
  if (
    command !== "init" &&
    command !== "status" &&
    command !== "mcp" &&
    command !== "serve" &&
    command !== "update"
  ) {
    throw new Error(`Unknown command '${command ?? ""}'.`);
  }

  let projectPath: string | undefined;
  let discover: boolean | undefined;
  let port: number | undefined;
  let json: boolean | undefined;
  let clients: ProjectMcpClientName[] | undefined;
  let check: boolean | undefined;
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
    if (option === "--client") {
      const value = options[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--client requires one or more client names.");
      }
      clients ??= [];
      for (const client of parseClientNames(value)) {
        if (!clients.includes(client)) {
          clients.push(client);
        }
      }
      index += 1;
      continue;
    }
    if (option?.startsWith("--client=")) {
      const value = option.slice("--client=".length);
      if (!value) {
        throw new Error("--client requires one or more client names.");
      }
      clients ??= [];
      for (const client of parseClientNames(value)) {
        if (!clients.includes(client)) {
          clients.push(client);
        }
      }
      continue;
    }
    if (option === "--port") {
      const value = options[index + 1];
      if (!value || isNaN(Number(value))) {
        throw new Error("--port requires a valid port number.");
      }
      port = Number(value);
      index += 1;
      continue;
    }
    if (option?.startsWith("--port=")) {
      const value = option.slice("--port=".length);
      if (!value || isNaN(Number(value))) {
        throw new Error("--port requires a valid port number.");
      }
      port = Number(value);
      port = Number(value);
      continue;
    }
    if (option === "--json") {
      json = true;
      continue;
    }
    if (option === "--discover") {
      discover = true;
      continue;
    }
    if (option === "--check") {
      check = true;
      continue;
    }
    if (option === "--help" || option === "-h") {
      continue;
    }
    throw new Error(`Unknown option '${option}'.`);
  }


  if (clients !== undefined && command !== "init") {
    throw new Error("--client is only supported for the init command.");
  }
  if (check !== undefined && command !== "update") {
    throw new Error("--check is only supported for the update command.");
  }
  if (discover && projectPath !== undefined) {
    throw new Error("--discover and --project cannot be used together.");
  }
  if (discover && command !== "mcp" && command !== "status") {
    throw new Error("--discover is only supported for the mcp and status commands.");
  }

  return { command, projectPath, discover, port, json, clients, check };
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

function shouldEnableColor(): boolean {
  if (process.env.NO_COLOR && process.env.NO_COLOR !== "") {
    return false;
  }
  return true;
}

function createStyler(enableColor: boolean) {
  const wrap = (code: string) => (text: string) => (enableColor ? `\x1b[${code}m${text}\x1b[0m` : text);
  return {
    bold: wrap("1"),
    cyan: wrap("36"),
    green: wrap("32"),
    yellow: wrap("33"),
    red: wrap("31"),
    dim: wrap("90"),
    boldGreen: wrap("1;32"),
    boldYellow: wrap("1;33"),
    boldCyan: wrap("1;36"),
    boldRed: wrap("1;31"),
  };
}

function formatTask(task: TaskSummary, styler: ReturnType<typeof createStyler>): string {
  let availability: string = task.status;
  if (task.status === "ready") {
    availability = task.runnable ? styler.boldGreen("[可执行]") : styler.yellow("[等待依赖]");
  } else if (task.status === "running") {
    availability = styler.boldCyan(`[${task.status}]`);
  } else if (task.status === "blocked") {
    availability = styler.boldRed(`[${task.status}]`);
  } else if (task.status === "in_review") {
    availability = styler.boldYellow(`[${task.status}]`);
  } else if (task.status === "completed") {
    availability = styler.green(`[${task.status}]`);
  } else if (task.status === "inbox") {
    availability = styler.dim(`[${task.status}]`);
  } else {
    availability = `[${task.status}]`;
  }
  const waiting = task.waitingFor.length > 0
    ? `；等待：${task.waitingFor.map((dependency) => `${dependency.title} (${dependency.id})`).join(", ")}`
    : "";
  const details = [task.currentStep, task.nextStep, task.blocker]
    .filter((value): value is string => Boolean(value))
    .join("；");
  return `  - ${availability} ${task.title} (${task.id})${waiting}${details ? `；${details}` : ""}`;
}

function formatTaskSection(
  title: string,
  tasks: TaskSummary[],
  styler: ReturnType<typeof createStyler>,
): string[] {
  return [
    styler.bold(`${title} (${tasks.length})`),
    ...(tasks.length > 0 ? tasks.map((t) => formatTask(t, styler)) : ["  - 无"]),
  ];
}

export function formatProjectStatus(status: ProjectStatus, enableColor = shouldEnableColor()): string {
  const styler = createStyler(enableColor);
  const sections = [
    styler.bold(`项目：${status.project.name} (${status.project.id})`),
    ...formatTaskSection("当前", status.current, styler),
    ...formatTaskSection("下一步", status.next, styler),
    ...formatTaskSection("阻塞", status.blocked, styler),
    ...formatTaskSection("待审核", status.inReview, styler),
    ...formatTaskSection("Inbox", status.inbox, styler),
    ...formatTaskSection("最近完成", status.recentlyCompleted, styler),
  ];
  const runnableCount = status.next.filter((task) => task.runnable).length;
  if (runnableCount > 1) {
    sections.push(styler.cyan(`可并行任务：${runnableCount}`));
  }
  return `${sections.join("\n")}\n`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function codexMcpInstructions(projectRoot: string): string {
  const startupCommand = ["milestack", "mcp", "--project", projectRoot]
    .map(shellQuote)
    .join(" ");

  return [
    "Codex CLI MCP 注册（请手动执行）：",
    `  codex mcp add milestack -- ${startupCommand}`,
    "",
    "验证配置：",
    "  codex mcp list",
    "  codex mcp get milestack",
    "",
    "新增配置只会在新的 Codex CLI 会话中进入工具清单。",
    "milestack init 只输出命令，不会修改 ~/.codex/config.toml，也不会覆盖已有的同名 MCP 配置。",
    "如果当前环境找不到 milestack，请先在 MileStack 仓库完成构建和全局链接：",
    "  pnpm build",
    "  pnpm link --global",
  ].join("\n");
}

function agyMcpInstructions(): string {
  return [
    "AGY CLI（Gemini CLI）MCP 注册（请手动执行）：",
    "  agy mcp add milestack -- milestack mcp --discover",
    "",
    "验证配置：",
    "  agy mcp list",
    "",
    "新增配置只会在新的 AGY CLI 会话中生效。",
    "如果已有绑定到固定路径旧项目的全局条目，上述命令会自动将其更新为 --discover 模式。",
    "milestack init 只输出命令，不会修改 ~/.gemini/config/mcp_config.json 或 ~/.gemini/settings.json。",
  ].join("\n");
}

function projectMcpInstructions(
  projectRoot: string,
  results: readonly ProjectMcpConfigResult[],
): string {
  const fileResults = results.filter((configuration) => configuration.client !== "agy");
  const agyResult = results.find((configuration) => configuration.client === "agy");

  const sections: string[] = [];

  if (fileResults.length > 0) {
    sections.push(
      [
        "项目级 MCP 配置（仅当前项目）：",
        ...fileResults.map((configuration) => `  ${configuration.client}: ${configuration.detail}`),
        "",
        "上述文件只写入当前项目目录，不会修改用户主目录中的全局配置。",
        `--project 使用当前 checkout 的绝对路径：${projectRoot}`,
        "写入后请重新打开对应客户端会话。",
      ].join("\n"),
    );
  }

  if (agyResult) {
    sections.push(
      [
        "用户级 MCP 配置（AGY 全局生效）：",
        `  agy: ${agyResult.detail}`,
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}

type RootAgentInstructionLink = "missing" | "unlinked" | "linked";

function readRootAgentInstructionLink(projectRoot: string): RootAgentInstructionLink {
  const agentsPath = path.join(projectRoot, rootAgentInstructionsFile);
  if (!existsSync(agentsPath)) {
    return "missing";
  }
  try {
    return readFileSync(agentsPath, "utf8").includes(projectAgentInstructionsPath)
      ? "linked"
      : "unlinked";
  } catch {
    return "unlinked";
  }
}

function mcpSummaryLine(configuration: ProjectMcpConfigResult): string {
  const client = projectMcpClientDisplayNames[configuration.client];
  if (configuration.client === "agy") {
    return `⚠ ${client} MCP 配置需手动注册：milestack init 不修改用户级配置`;
  }
  if (configuration.action === "skipped") {
    return `⚠ ${client} MCP 配置未写入 ${configuration.relativePath}`;
  }
  if (configuration.action === "updated") {
    return `✓ ${client} MCP 配置已更新 ${configuration.relativePath}`;
  }
  if (configuration.action === "unchanged") {
    return `✓ ${client} MCP 配置已是最新（${configuration.relativePath} 未修改）`;
  }
  return `✓ ${client} MCP 配置已写入 ${configuration.relativePath}`;
}

type ReopenAdvice = {
  configured: ProjectMcpClientName[];
  skipped: ProjectMcpClientName[];
  manual: ProjectMcpClientName[];
};

function planReopenAdvice(
  results: readonly ProjectMcpConfigResult[] | undefined,
): ReopenAdvice {
  const advice: ReopenAdvice = { configured: [], skipped: [], manual: [] };
  for (const configuration of results ?? []) {
    if (configuration.client === "agy") {
      advice.manual.push(configuration.client);
    } else if (configuration.action === "skipped") {
      advice.skipped.push(configuration.client);
    } else {
      advice.configured.push(configuration.client);
    }
  }
  return advice;
}

function displayClients(clients: readonly ProjectMcpClientName[]): string {
  return clients.map((client) => projectMcpClientDisplayNames[client]).join("、");
}

function formatNextStepLines(
  results: readonly ProjectMcpConfigResult[] | undefined,
  hasClients: boolean,
  linked: boolean,
): string[] {
  if (!hasClients) {
    return [
      linked
        ? "下一步：手动配置 MCP 后，重新打开相应的 Coding Agent 会话。"
        : "下一步：完成项目指令配置后，手动配置 MCP 后重新打开相应的 Coding Agent 会话。",
    ];
  }

  const advice = planReopenAdvice(results);
  const lines: string[] = [];
  if (advice.configured.length > 0) {
    lines.push(
      linked
        ? "下一步：重新打开本次已成功配置的客户端会话："
        : "下一步：完成项目指令配置后，重新打开本次已成功配置的客户端会话：",
    );
    lines.push(displayClients(advice.configured));
  } else {
    lines.push(
      linked
        ? "下一步：本次没有已成功配置的项目级客户端会话，请先完成下面的待办。"
        : "下一步：完成项目指令配置后，本次没有已成功配置的项目级客户端会话，请先完成下面的待办。",
    );
  }
  if (advice.skipped.length > 0) {
    lines.push(
      `⚠ 以下客户端的 MCP 配置未写入，请先解决冲突或手动完成配置，再重新打开其会话：${displayClients(advice.skipped)}`,
    );
  }
  if (advice.manual.length > 0) {
    lines.push(
      `⚠ ${displayClients(advice.manual)} 需要先执行上面给出的注册或更新命令，再重新打开其会话。`,
    );
  }
  return lines;
}

function formatInitSummary(
  created: boolean,
  results: readonly ProjectMcpConfigResult[] | undefined,
  agentInstructionLink: RootAgentInstructionLink,
  hasClients: boolean,
  styler: ReturnType<typeof createStyler>,
): string {
  const lines: string[] = [styler.bold("MileStack 初始化完成"), ""];
  lines.push(
    styler.green(created ? "✓ 数据库已创建" : "✓ 数据库已就绪（此前已初始化）"),
  );
  for (const configuration of results ?? []) {
    const line = mcpSummaryLine(configuration);
    lines.push(line.startsWith("⚠") ? styler.yellow(line) : styler.green(line));
  }

  const linked = agentInstructionLink === "linked";
  if (linked) {
    lines.push(
      styler.green(
        `✓ ${rootAgentInstructionsFile} 已包含 MileStack instructions 路径引用`,
      ),
    );
  } else {
    lines.push(styler.yellow("⚠ 还需手动完成 1 个项目级步骤"));
    lines.push("");
    lines.push(
      agentInstructionLink === "missing"
        ? `项目根目录还没有 ${rootAgentInstructionsFile}，请创建该文件并加入下面这一行：`
        : `请在项目根目录已有的 ${rootAgentInstructionsFile} 中加入下面这一行，不要覆盖原有内容：`,
    );
    lines.push("");
    lines.push(`  ${rootAgentInstructionSnippet}`);
    lines.push("");
    lines.push("如果不添加，Coding Agent 可能不会读取 MileStack 工作流规则。");
    lines.push(`MileStack 不会自动修改 ${rootAgentInstructionsFile}，以免覆盖已有内容。`);
  }

  lines.push("");
  for (const line of formatNextStepLines(results, hasClients, linked)) {
    lines.push(line.startsWith("⚠") ? styler.yellow(line) : line);
  }

  return `${lines.join("\n")}\n`;
}

async function runInit(
  projectPath: string | undefined,
  clients: readonly ProjectMcpClientName[] | undefined,
  output: CliOutput,
): Promise<void> {
  const projectRoot = resolveProjectRoot(projectPath);
  const context = await initializeProject(projectRoot);
  try {
    ensureGitignoreEntry(projectRoot);
    const agentInstructionsPath = path.join(projectRoot, projectAgentInstructionsPath);
    writeFileSync(
      agentInstructionsPath,
      formatProjectAgentInstructions(runtimeVersion),
      "utf8",
    );
    const projectConfiguration = {
      mcpServers: {
        milestack: {
          command: "milestack",
          args: ["mcp", "--project", projectRoot],
        },
      },
    };
    const discoverConfiguration = {
      mcpServers: {
        milestack: {
          command: "milestack",
          args: ["mcp", "--discover"],
        },
      },
    };
    const mcpResults = clients === undefined
      ? undefined
      : configureProjectMcpClients(projectRoot, clients);
    const mcpOutput = mcpResults === undefined
      ? `MCP configuration (project-level, fixed path):\n${JSON.stringify(projectConfiguration, null, 2)}\n\n` +
        `MCP configuration (user-level, auto-discover, for agy/gemini):\n${JSON.stringify(discoverConfiguration, null, 2)}\n\n` +
        agyMcpInstructions() + "\n\n" +
        codexMcpInstructions(projectRoot)
      : projectMcpInstructions(projectRoot, mcpResults);
    output.writeStdout(
      `${context.created ? "Initialized" : "Already initialized"} ${projectRoot}\n` +
        `Database: ${context.database.databasePath}\n\n` +
        `Agent instructions: ${agentInstructionsPath}\n\n` +
        `${mcpOutput}\n\n` +
        `AI integration instructions:\n${formatAgentIntegrationInstructions()}\n\n` +
        formatInitSummary(
          context.created,
          mcpResults,
          readRootAgentInstructionLink(projectRoot),
          clients !== undefined,
          createStyler(shouldEnableColor()),
        ),
    );
  } finally {
    context.database.close();
  }
}

async function runStatus(
  projectPath: string | undefined,
  discover: boolean | undefined,
  json: boolean | undefined,
  output: CliOutput,
): Promise<void> {
  const projectRoot = discover ? discoverProjectRoot() : resolveProjectRoot(projectPath);
  const context = await openProjectContext(projectRoot);
  try {
    const status = context.service.getProjectStatus({
      projectId: context.project.id,
      view: "full",
    });
    if (json) {
      output.writeStdout(`${JSON.stringify(status, null, 2)}\n`);
    } else {
      output.writeStdout(formatProjectStatus(status));
    }
  } finally {
    context.database.close();
  }
}

export async function runCli(
  args: readonly string[],
  output: CliOutput = defaultOutput,
  updateDependencies: UpdateDependencies = defaultUpdateDependencies,
): Promise<number> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    output.writeStdout(helpText);
    return 0;
  }

  try {
    if (args.includes("--version") || args.includes("-v")) {
      if (args.length > 1) {
        throw new Error("-v/--version must be used alone, without a command or other options.");
      }
      output.writeStdout(`${runtimeVersion} (${resolveEntryPath()})\n`);
      return 0;
    }

    const parsed = parseCommand(args);
    if (parsed.command === "init") {
      await runInit(parsed.projectPath, parsed.clients, output);
      return 0;
    }
    if (parsed.command === "status") {
      await runStatus(parsed.projectPath, parsed.discover, parsed.json, output);
      return 0;
    }
    if (parsed.command === "update") {
      return runUpdate(
        { projectPath: parsed.projectPath, check: parsed.check === true },
        output,
        updateDependencies,
      );
    }
    if (parsed.command === "serve") {
      const { app, url } = await startHttpServer({
        projectRoot: parsed.projectPath,
        port: parsed.port ?? 7331,
      });
      output.writeStdout(`MileStack HTTP service running at ${url}\n`);
      await new Promise<void>((resolve) => {
        const handleSignal = () => {
          process.off("SIGINT", handleSignal);
          process.off("SIGTERM", handleSignal);
          app.close().finally(resolve);
        };
        process.on("SIGINT", handleSignal);
        process.on("SIGTERM", handleSignal);
      });
      return 0;
    }
    if (parsed.discover) {
      await runMcp({ discover: true });
    } else {
      await runMcp(resolveProjectRoot(parsed.projectPath));
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.writeStderr(`Error: ${message}\n`);
    return 1;
  }
}
