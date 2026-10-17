import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { helpText, runCli } from "../src/cli/command.js";
import {
  formatAgentIntegrationInstructions,
  formatKnownTaskBriefInstructions,
  formatMcpInstructions,
} from "../src/core/agent-instructions.js";
import {
  configureProjectMcpClients,
  projectMcpClientNames,
} from "../src/cli/project-mcp-config.js";
import {
  discoverProjectRoot,
  openProjectContext,
  resolveWorkspaceProjectRoot,
} from "../src/project/project-context.js";

const temporaryProjects: string[] = [];

function createTemporaryProject(): string {
  const projectRoot = path.join(os.tmpdir(), `milestack-cli-${randomUUID()}`);
  mkdirSync(projectRoot, { recursive: true });
  temporaryProjects.push(projectRoot);
  return projectRoot;
}

function outputCapture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    output: {
      writeStdout: (message: string) => stdout.push(message),
      writeStderr: (message: string) => stderr.push(message),
    },
  };
}

type LauncherEnvironmentOptions = {
  launcherOnPath: boolean;
  cliEntryExists?: boolean;
  cliEntryDirectory?: string;
};

type LauncherEnvironment = {
  cliEntryPath: string;
  restore: () => void;
};

function useLauncherEnvironment(options: LauncherEnvironmentOptions): LauncherEnvironment {
  const environmentRoot = createTemporaryProject();
  const binDirectory = path.join(environmentRoot, "bin");
  mkdirSync(binDirectory, { recursive: true });
  if (options.launcherOnPath) {
    const launcherPath = path.join(binDirectory, "milestack");
    writeFileSync(launcherPath, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(launcherPath, 0o755);
  }

  const entryDirectory = options.cliEntryDirectory ?? path.join(environmentRoot, "dist");
  const cliEntryPath = path.join(entryDirectory, "index.js");
  if (options.cliEntryExists !== false) {
    mkdirSync(path.dirname(cliEntryPath), { recursive: true });
    writeFileSync(cliEntryPath, "// fake MileStack CLI entry\n", "utf8");
  }

  const originalPath = process.env["PATH"];
  const originalEntry = process.argv[1];
  process.env["PATH"] = binDirectory;
  process.argv[1] = options.cliEntryExists === false ? path.join(environmentRoot, "missing.js") : cliEntryPath;

  return {
    cliEntryPath,
    restore: () => {
      if (originalPath === undefined) {
        delete process.env["PATH"];
      } else {
        process.env["PATH"] = originalPath;
      }
      if (originalEntry === undefined) {
        process.argv.splice(1, 1);
      } else {
        process.argv[1] = originalEntry;
      }
    },
  };
}

afterEach(() => {
  for (const projectRoot of temporaryProjects.splice(0)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

describe("CLI entry point", () => {
  it("prints help and exits successfully", async () => {
    const capture = outputCapture();

    const exitCode = await runCli(["--help"], capture.output);

    expect(exitCode).toBe(0);
    expect(capture.stdout.join("")).toBe(helpText);
    expect(helpText).toContain("--client <name>");
    expect(helpText).toContain("claude, cursor, grok, codex, opencode, agy");
    expect(helpText).toContain("Project-only MCP config for init");
    expect(capture.stderr).toHaveLength(0);
  });

  it("initializes idempotently and preserves existing gitignore content", async () => {
    const projectRoot = createTemporaryProject();
    writeFileSync(path.join(projectRoot, ".gitignore"), "dist/\n.milestack/\n");
    const rootAgentsContent = "# Existing project instructions\nKeep this file unchanged.\n";
    const clientConfigContent = '{"mcpServers":{"existing":{"command":"preserve-me"}}}\n';
    writeFileSync(path.join(projectRoot, "AGENTS.md"), rootAgentsContent);
    writeFileSync(path.join(projectRoot, ".mcp.json"), clientConfigContent);
    const first = outputCapture();

    expect(await runCli(["init", "--project", projectRoot], first.output)).toBe(0);
    expect(first.stderr).toEqual([]);
    expect(readFileSync(path.join(projectRoot, ".gitignore"), "utf8")).toBe(
      "dist/\n.milestack/\n",
    );
    const firstOutput = first.stdout.join("");
    expect(firstOutput).toContain('"command": "milestack"');
    expect(firstOutput).toContain("--discover");
    expect(firstOutput).toContain("auto-discover");
    expect(firstOutput).toContain(
      `codex mcp add milestack -- milestack mcp --project ${projectRoot}`,
    );
    expect(firstOutput).toContain("codex mcp list");
    expect(firstOutput).toContain("codex mcp get milestack");
    expect(firstOutput).toContain("新的 Codex CLI 会话");
    expect(firstOutput).toContain("~/.codex/config.toml");
    expect(firstOutput).toContain("pnpm link --global");
    expect(firstOutput).toContain(
      "Before working on tasks, read and follow .milestack/agent-instructions.md",
    );
    expect(firstOutput).toContain("Agent instructions:");
    expect(readFileSync(path.join(projectRoot, ".mcp.json"), "utf8")).toBe(
      clientConfigContent,
    );
    for (const relativePath of [
      ".cursor/mcp.json",
      ".grok/config.toml",
      ".codex/config.toml",
    ]) {
      expect(existsSync(path.join(projectRoot, relativePath))).toBe(false);
    }

    const agentInstructionsPath = path.join(
      projectRoot,
      ".milestack",
      "agent-instructions.md",
    );
    const generatedInstructions = readFileSync(agentInstructionsPath, "utf8");
    expect(generatedInstructions).toContain(
      "Generated by MileStack milestack init; source: MileStack 0.1.0",
    );
    expect(generatedInstructions).toContain("create_task");
    expect(generatedInstructions).toContain("create_tasks");
    expect(generatedInstructions).toContain("a verifiable objective, complete acceptance criteria");
    expect(generatedInstructions).toContain("dependencyIds");
    expect(generatedInstructions).toContain(
      "files or modules owned by the task, explicitly excluded areas",
    );
    expect(generatedInstructions).toContain("non-overlapping file or module ownership");
    expect(generatedInstructions).toContain(
      "Do not copy the general workflow, review, risk, or Git rules",
    );
    expect(generatedInstructions).toContain("## Preserve concrete task constraints");
    expect(generatedInstructions).toContain(
      "When creating or updating a MileStack task, preserve developer-confirmed concrete examples as part of the task definition.",
    );
    expect(generatedInstructions).toContain(
      "- Do not replace an approved wireframe, layout sketch, field mapping, workflow, example input/output, ordering rule, or state-specific behavior with only an abstract summary.",
    );
    expect(generatedInstructions).toContain("- Record both:");
    expect(generatedInstructions).toContain("1. the design intent; and");
    expect(generatedInstructions).toContain(
      "2. the observable example or concrete structure that constrains implementation.",
    );
    expect(generatedInstructions).toContain(
      "- For UI work, explicitly preserve information hierarchy, element ordering, grouping, conditional visibility, responsive behavior, and permitted deviations.",
    );
    expect(generatedInstructions).toContain(
      "- Treat developer-confirmed examples as acceptance constraints unless the developer says they are illustrative only.",
    );
    expect(generatedInstructions).toContain(
      "- Before creating the task, check that every material constraint from the approved proposal appears in the objective or acceptance criteria.",
    );
    expect(generatedInstructions).toContain(
      "- Keep concrete examples concise, but prefer slight duplication over losing a requirement through abstraction.",
    );
    expect(generatedInstructions).toContain("## Calibrate task specificity");
    expect(generatedInstructions).toContain(
      "- Make task definitions concrete about observable behavior, developer-confirmed examples, external contracts, architectural boundaries, compatibility requirements, and verification outcomes.",
    );
    expect(generatedInstructions).toContain(
      "- Do not invent or prescribe internal file lists, private functions, helper types, algorithms, test fixture names, or implementation steps unless the developer confirmed them, an existing public contract requires them, or they are necessary for architecture or safety.",
    );
    expect(generatedInstructions).toContain(
      "- Prefer “scenario → expected result → verification” over a step-by-step implementation blueprint.",
    );
    expect(generatedInstructions).toContain(
      "- Distinguish acceptance constraints from implementation suggestions. Put only confirmed constraints in the objective and acceptance criteria; omit unconfirmed implementation ideas or label them explicitly as non-binding.",
    );
    expect(generatedInstructions).toContain(
      "- Treat developer-confirmed UI layouts, field order, workflows, state behavior, and API/protocol fields as mandatory acceptance constraints. Do not lock down unconfirmed file lists, private function boundaries, internal JSON nesting, matching algorithms, or test fixture names.",
    );
    expect(generatedInstructions.indexOf("## Create well-scoped tasks")).toBeLessThan(
      generatedInstructions.indexOf("## Preserve concrete task constraints"),
    );
    expect(generatedInstructions.indexOf("## Preserve concrete task constraints")).toBeLessThan(
      generatedInstructions.indexOf("## Calibrate task specificity"),
    );
    expect(generatedInstructions.indexOf("## Calibrate task specificity")).toBeLessThan(
      generatedInstructions.indexOf("## Discover, claim, and execute work"),
    );
    expect(generatedInstructions).toContain("start_task");
    expect(generatedInstructions).toContain(
      "After reading the task details and confirming that its status is ready, call start_task",
    );
    expect(generatedInstructions).toContain(
      "start_task is the final atomic claim boundary",
    );
    expect(generatedInstructions).toContain("Do not expect get_task to expose runnable");
    expect(generatedInstructions).not.toContain(
      "确认任务状态为 ready 且 runnable=true 后调用 start_task",
    );
    expect(generatedInstructions).toContain(
      "Give every concurrently executing task its own local branch and worktree",
    );
    expect(generatedInstructions).toContain(
      "Never run two writing agents in the same working tree",
    );
    expect(generatedInstructions).toContain("submit_for_review");
    expect(generatedInstructions).toContain("start_review");
    expect(generatedInstructions).toContain("reviewRunId");
    expect(generatedInstructions).toContain("request_changes");
    expect(generatedInstructions).toContain("approve_review");
    expect(generatedInstructions).toContain("complete_review");
    expect(generatedInstructions).toContain("low");
    expect(generatedInstructions).toContain("medium");
    expect(generatedInstructions).toContain("high");
    expect(generatedInstructions).toContain("git cat-file -e");
    expect(generatedInstructions).toContain("full 40-character commit SHA");
    expect(generatedInstructions).toContain(
      "For tasks whose confirmed delivery condition requires local Git integration, review or approval alone is not delivery. Completion requires the fixed reviewed commit to be verifiably present on the developer-confirmed local target branch, or the developer to explicitly record that Git integration is not required. This proves local integration only, not push, release, or deployment.",
    );
    expect(generatedInstructions).toContain(
      "If the current task workflow cannot record or verify a required integration check, state the missing evidence and next action instead of claiming integration or completion. Do not merge, fetch, push, or deploy without explicit developer authorization.",
    );
    expect(generatedInstructions).toContain("commands actually run and their results");
    expect(generatedInstructions).toContain("a concrete issue, an actionable suggestion");
    expect(generatedInstructions).toContain("Use agent when no model label is available");
    expect(generatedInstructions).toContain(
      "Do not push, merge, or modify a shared remote branch",
    );
    expect(generatedInstructions).toContain(
      "Before working on tasks, read and follow .milestack/agent-instructions.md",
    );
    expect(generatedInstructions).not.toMatch(/[\u3400-\u9fff]/u);

    expect(readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8")).toBe(rootAgentsContent);

    writeFileSync(agentInstructionsPath, "stale generated content\n");

    const second = outputCapture();
    expect(await runCli(["init", "--project", projectRoot], second.output)).toBe(0);
    const gitignore = readFileSync(path.join(projectRoot, ".gitignore"), "utf8");
    expect(gitignore.match(/^\.milestack\/$/gm)).toHaveLength(1);
    expect(second.stdout.join("")).toContain("Already initialized");
    const regeneratedInstructions = readFileSync(agentInstructionsPath, "utf8");
    expect(regeneratedInstructions).toBe(generatedInstructions);
    expect(regeneratedInstructions.match(/## Preserve concrete task constraints/g)).toHaveLength(
      1,
    );
    expect(regeneratedInstructions.match(/## Calibrate task specificity/g)).toHaveLength(1);
    expect(readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8")).toBe(rootAgentsContent);
    expect(readFileSync(path.join(projectRoot, ".mcp.json"), "utf8")).toBe(
      clientConfigContent,
    );
  });

  it("writes only selected project MCP clients and preserves their order", async () => {
    const projectRoot = createTemporaryProject();
    const capture = outputCapture();

    expect(
      await runCli(
        [
          "init",
          "--project",
          projectRoot,
          "--client",
          "codex,claude",
          "--client",
          "codex,claude",
        ],
        capture.output,
      ),
    ).toBe(0);

    const output = capture.stdout.join("");
    expect(output).toContain("  codex: 已写入 .codex/config.toml");
    expect(output).toContain("  claude: 已写入 .mcp.json");
    expect(output.indexOf("  codex: 已写入 .codex/config.toml")).toBeLessThan(
      output.indexOf("  claude: 已写入 .mcp.json"),
    );
    expect(output).not.toContain("codex mcp add");
    expect(output).not.toContain("~/.codex/config.toml");
    expect(output).toContain("上述文件只写入当前项目目录，不会修改用户主目录中的全局配置。");
    expect(output).toContain(`--project 使用当前 checkout 的绝对路径：${path.resolve(projectRoot)}`);
    expect(output).toContain("写入后请重新打开对应客户端会话。");

    expect(existsSync(path.join(projectRoot, ".codex", "config.toml"))).toBe(true);
    expect(existsSync(path.join(projectRoot, ".mcp.json"))).toBe(true);
    expect(existsSync(path.join(projectRoot, ".cursor", "mcp.json"))).toBe(false);
    expect(existsSync(path.join(projectRoot, ".grok", "config.toml"))).toBe(false);
  });

  it("formats user-level AGY guidance separately without project-level footer when --client agy is specified", async () => {
    const projectRoot = createTemporaryProject();
    const capture = outputCapture();

    expect(
      await runCli(
        [
          "init",
          "--project",
          projectRoot,
          "--client",
          "agy",
        ],
        capture.output,
      ),
    ).toBe(0);

    const output = capture.stdout.join("");
    expect(output).toContain("用户级 MCP 配置（AGY 全局生效）：");
    expect(output).toContain("agy mcp add milestack -- milestack mcp --discover");
    expect(output).toContain("agy mcp list");
    expect(output).toContain("~/.gemini/config/mcp_config.json");
    expect(output).not.toContain("项目级 MCP 配置（仅当前项目）：");
    expect(output).not.toContain("上述文件只写入当前项目目录，不会修改用户主目录中的全局配置。");
    expect(output).not.toContain("--project 使用当前 checkout 的绝对路径");
  });

  it("formats both project-level and user-level sections when --client has mixed clients", async () => {
    const projectRoot = createTemporaryProject();
    const capture = outputCapture();

    expect(
      await runCli(
        [
          "init",
          "--project",
          projectRoot,
          "--client",
          "claude,agy",
        ],
        capture.output,
      ),
    ).toBe(0);

    const output = capture.stdout.join("");
    expect(output).toContain("项目级 MCP 配置（仅当前项目）：");
    expect(output).toContain("  claude: 已写入 .mcp.json");
    expect(output).toContain("上述文件只写入当前项目目录，不会修改用户主目录中的全局配置。");
    expect(output).toContain("用户级 MCP 配置（AGY 全局生效）：");
    expect(output).toContain("agy mcp add milestack -- milestack mcp --discover");
    expect(output).toContain("agy mcp list");
  });

  it("rejects invalid or misplaced --client before initialization side effects", async () => {
    const invalidCases: readonly (readonly string[])[] = [
      ["init", "--project", createTemporaryProject(), "--client", "unknown"],
      ["init", "--project", createTemporaryProject(), "--client"],
      ["status", "--project", createTemporaryProject(), "--client", "claude"],
      ["mcp", "--project", createTemporaryProject(), "--client", "claude"],
      ["serve", "--project", createTemporaryProject(), "--client", "claude"],
    ];

    for (const args of invalidCases) {
      const capture = outputCapture();
      expect(await runCli(args, capture.output)).toBe(1);
      expect(capture.stderr.join("")).toContain("Error:");
      const projectRoot = args[args.indexOf("--project") + 1];
      if (projectRoot === undefined) {
        throw new Error("test case must include a project path");
      }
      expect(existsSync(path.join(projectRoot, ".milestack"))).toBe(false);
      for (const relativePath of [
        ".mcp.json",
        ".cursor/mcp.json",
        ".grok/config.toml",
        ".codex/config.toml",
      ]) {
        expect(existsSync(path.join(projectRoot, relativePath))).toBe(false);
      }
    }
  });

  it("renders every generated agent prompt in English", () => {
    const taskId = "11111111-2222-4333-8444-555555555555";
    const integrationInstructions = formatAgentIntegrationInstructions();
    const mcpInstructions = formatMcpInstructions();
    const knownTaskInstructions = formatKnownTaskBriefInstructions(taskId);

    for (const prompt of [
      integrationInstructions,
      mcpInstructions,
      knownTaskInstructions,
    ]) {
      expect(prompt).not.toMatch(/[\u3400-\u9fff]/u);
    }
    expect(integrationInstructions).toContain("Run milestack init in every local checkout");
    expect(mcpInstructions).toContain("Task discovery:");
    expect(mcpInstructions).toContain("Known task:");
    expect(mcpInstructions).toContain("start_task is the final atomic claim boundary");
    expect(knownTaskInstructions).toContain(`Call get_task directly with taskId \`${taskId}\``);
    expect(knownTaskInstructions).toContain("If the claim fails, do not modify the project");
    expect(knownTaskInstructions).toContain("full 40-character commit SHA");
    expect(knownTaskInstructions).toContain(
      "A verified low-risk task may complete automatically after review",
    );
    expect(knownTaskInstructions).toContain(
      "medium- and high-risk tasks stay in in_review until a developer approves",
    );
    for (const step of [1, 2, 3, 4, 5, 6, 7]) {
      expect(knownTaskInstructions.split(`\n${step}. `).length - 1).toBe(1);
    }
  });

  it("prints status through TaskService and distinguishes runnable work", async () => {
    const projectRoot = createTemporaryProject();
    const init = outputCapture();
    expect(await runCli(["init", "--project", projectRoot], init.output)).toBe(0);

    const context = await openProjectContext(projectRoot);
    const prerequisite = context.service.createTask({
      projectId: context.project.id,
      title: "Prerequisite",
      createdBy: "developer",
      queuePosition: 1,
    });
    context.service.createTask({
      projectId: context.project.id,
      title: "Waiting task",
      createdBy: "developer",
      queuePosition: 2,
      dependencyIds: [prerequisite.task.id],
    });
    context.database.close();

    const status = outputCapture();
    expect(await runCli(["status", "--project", projectRoot], status.output)).toBe(0);
    expect(status.stdout.join("")).toContain("[可执行]");
    expect(status.stdout.join("")).toContain("[等待依赖]");
    expect(status.stdout.join("")).toContain("Prerequisite");
    expect(status.stdout.join("")).toContain("Waiting task");
  });

  it("outputs structured JSON format when --json is provided", async () => {
    const projectRoot = createTemporaryProject();
    const init = outputCapture();
    expect(await runCli(["init", "--project", projectRoot], init.output)).toBe(0);

    const context = await openProjectContext(projectRoot);
    context.service.createTask({
      projectId: context.project.id,
      title: "Json Task",
      status: "inbox",
      createdBy: "developer",
    });
    context.database.close();

    const status = outputCapture();
    expect(await runCli(["status", "--project", projectRoot, "--json"], status.output)).toBe(0);
    const parsed = JSON.parse(status.stdout.join(""));
    expect(parsed.project.id).toBeDefined();
    expect(parsed.inbox.length).toBe(1);
    expect(parsed.inbox[0].title).toBe("Json Task");
  });

  it("strips ANSI color escape codes when NO_COLOR environment variable is set", async () => {
    const projectRoot = createTemporaryProject();
    const init = outputCapture();
    expect(await runCli(["init", "--project", projectRoot], init.output)).toBe(0);

    const originalNoColor = process.env.NO_COLOR;
    try {
      process.env.NO_COLOR = "1";
      const statusNoColor = outputCapture();
      expect(await runCli(["status", "--project", projectRoot], statusNoColor.output)).toBe(0);
      const text = statusNoColor.stdout.join("");
      expect(text).not.toContain("\x1b[");
      expect(text).toContain("项目：");
    } finally {
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }
    }
  });
});

describe("init AGENTS.md instruction reminder", () => {
  let restoreLauncherEnvironment = (): void => {};

  beforeEach(() => {
    restoreLauncherEnvironment = useLauncherEnvironment({ launcherOnPath: true }).restore;
  });

  afterEach(() => {
    restoreLauncherEnvironment();
  });

  const rootAgentsPath = (projectRoot: string): string => path.join(projectRoot, "AGENTS.md");
  const copyableInstruction =
    "  Before working on tasks, read and follow `.milestack/agent-instructions.md`.";

  it("asks the user to create AGENTS.md when it does not exist and never creates it", async () => {
    const projectRoot = createTemporaryProject();
    const capture = outputCapture();

    expect(
      await runCli(
        ["init", "--project", projectRoot, "--client", "claude,cursor,codex"],
        capture.output,
      ),
    ).toBe(0);

    const output = capture.stdout.join("");
    expect(output).toContain("MileStack 初始化完成");
    expect(output).toContain("✓ 数据库已创建");
    expect(output).toContain("✓ Claude MCP 配置已写入 .mcp.json");
    expect(output).toContain("✓ Cursor MCP 配置已写入 .cursor/mcp.json");
    expect(output).toContain("✓ Codex MCP 配置已写入 .codex/config.toml");
    expect(output).toContain("⚠ 还需手动完成 1 个项目级步骤");
    expect(output).toContain("项目根目录还没有 AGENTS.md，请创建该文件并加入下面这一行：");
    expect(output).toContain(copyableInstruction);
    expect(output).toContain("如果不添加，Coding Agent 可能不会读取 MileStack 工作流规则。");
    expect(output).toContain("MileStack 不会自动修改 AGENTS.md，以免覆盖已有内容。");
    expect(output).toContain(
      "下一步：完成项目指令配置后，重新打开本次已成功配置的客户端会话：",
    );
    expect(output).toContain("Claude、Cursor、Codex");
    expect(existsSync(rootAgentsPath(projectRoot))).toBe(false);
  });

  it("asks the user to append to an existing AGENTS.md and preserves its content", async () => {
    const projectRoot = createTemporaryProject();
    const existing = "# Project rules\nKeep this content.\n";
    writeFileSync(rootAgentsPath(projectRoot), existing, "utf8");
    const capture = outputCapture();

    expect(
      await runCli(["init", "--project", projectRoot, "--client", "claude"], capture.output),
    ).toBe(0);

    const output = capture.stdout.join("");
    expect(output).toContain("⚠ 还需手动完成 1 个项目级步骤");
    expect(output).toContain(
      "请在项目根目录已有的 AGENTS.md 中加入下面这一行，不要覆盖原有内容：",
    );
    expect(output).toContain(copyableInstruction);
    expect(output).not.toContain("已包含 MileStack instructions 路径引用");
    expect(readFileSync(rootAgentsPath(projectRoot), "utf8")).toBe(existing);
  });

  it("reports the detected path reference without claiming to validate the wording", async () => {
    const projectRoot = createTemporaryProject();
    writeFileSync(
      rootAgentsPath(projectRoot),
      "# Project rules\n\nBefore working on tasks, read and follow `.milestack/agent-instructions.md`.\n",
      "utf8",
    );
    const capture = outputCapture();

    expect(
      await runCli(["init", "--project", projectRoot, "--client", "claude,codex"], capture.output),
    ).toBe(0);

    const output = capture.stdout.join("");
    expect(output).toContain("✓ AGENTS.md 已包含 MileStack instructions 路径引用");
    expect(output).not.toContain("已验证");
    expect(output).not.toContain("语义有效");
    expect(output).not.toContain("还需手动完成 1 个项目级步骤");
    expect(output).not.toContain(copyableInstruction);
    expect(output).toContain("下一步：重新打开本次已成功配置的客户端会话：");
    expect(output).toContain("Claude、Codex");
  });

  it("treats any custom wording that contains the instructions path as referenced", async () => {
    const projectRoot = createTemporaryProject();
    writeFileSync(
      rootAgentsPath(projectRoot),
      "# Project rules\n\n任务开始前请先阅读 .milestack/agent-instructions.md 中的规则。\n",
      "utf8",
    );
    const capture = outputCapture();

    expect(
      await runCli(["init", "--project", projectRoot, "--client", "claude"], capture.output),
    ).toBe(0);

    const output = capture.stdout.join("");
    expect(output).toContain("✓ AGENTS.md 已包含 MileStack instructions 路径引用");
    expect(output).not.toContain("还需手动完成 1 个项目级步骤");
  });

  it("names only the successfully configured client in the next step", async () => {
    const projectRoot = createTemporaryProject();
    const capture = outputCapture();

    expect(
      await runCli(["init", "--project", projectRoot, "--client", "cursor"], capture.output),
    ).toBe(0);

    const output = capture.stdout.join("");
    expect(output).toContain("重新打开本次已成功配置的客户端会话：\nCursor\n");
    expect(output).not.toContain("Claude、Cursor、Codex");
    expect(output).not.toContain("Codex");
  });

  it("uses client-neutral wording when no client is selected", async () => {
    const projectRoot = createTemporaryProject();
    const capture = outputCapture();

    expect(await runCli(["init", "--project", projectRoot], capture.output)).toBe(0);

    const output = capture.stdout.join("");
    expect(output).toContain("⚠ 还需手动完成 1 个项目级步骤");
    expect(output).toContain(copyableInstruction);
    expect(output).toContain(
      "下一步：完成项目指令配置后，手动配置 MCP 后重新打开相应的 Coding Agent 会话。",
    );
    expect(output).not.toContain("本次已成功配置的客户端会话");
  });

  it("does not claim a file write for skipped or unchanged client results", async () => {
    const conflictingProject = createTemporaryProject();
    writeFileSync(
      path.join(conflictingProject, ".mcp.json"),
      `${JSON.stringify(
        { mcpServers: { milestack: { command: "other", args: ["mcp"] } } },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const conflicting = outputCapture();

    expect(
      await runCli(
        ["init", "--project", conflictingProject, "--client", "claude,codex"],
        conflicting.output,
      ),
    ).toBe(0);

    const conflictingOutput = conflicting.stdout.join("");
    expect(conflictingOutput).toContain("⚠ Claude MCP 配置未写入 .mcp.json");
    expect(conflictingOutput).not.toContain("✓ Claude MCP 配置已写入 .mcp.json");
    expect(conflictingOutput).toContain("✓ Codex MCP 配置已写入 .codex/config.toml");

    const idempotentProject = createTemporaryProject();
    expect(
      await runCli(
        ["init", "--project", idempotentProject, "--client", "claude"],
        outputCapture().output,
      ),
    ).toBe(0);
    const second = outputCapture();

    expect(
      await runCli(["init", "--project", idempotentProject, "--client", "claude"], second.output),
    ).toBe(0);

    const secondOutput = second.stdout.join("");
    expect(secondOutput).toContain("✓ 数据库已就绪（此前已初始化）");
    expect(secondOutput).toContain("✓ Claude MCP 配置已是最新（.mcp.json 未修改）");
    expect(secondOutput).not.toContain("✓ Claude MCP 配置已写入 .mcp.json");
    expect(secondOutput).toContain("  claude: 已有相同的 .mcp.json 配置，未修改");
  });

  const writeConflictingEntry = (projectRoot: string, relativePath: string): void => {
    const filePath = path.join(projectRoot, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      `${JSON.stringify(
        { mcpServers: { milestack: { command: "other", args: ["mcp"] } } },
        null,
        2,
      )}\n`,
      "utf8",
    );
  };

  it("reports no configured session when every selected client is skipped", async () => {
    const projectRoot = createTemporaryProject();
    writeConflictingEntry(projectRoot, ".mcp.json");
    writeConflictingEntry(projectRoot, ".cursor/mcp.json");
    const capture = outputCapture();

    expect(
      await runCli(
        ["init", "--project", projectRoot, "--client", "claude,cursor"],
        capture.output,
      ),
    ).toBe(0);

    const output = capture.stdout.join("");
    expect(output).toContain("⚠ Claude MCP 配置未写入 .mcp.json");
    expect(output).toContain("⚠ Cursor MCP 配置未写入 .cursor/mcp.json");
    expect(output).toContain(
      "下一步：完成项目指令配置后，本次没有已成功配置的项目级客户端会话，请先完成下面的待办。",
    );
    expect(output).toContain(
      "⚠ 以下客户端的 MCP 配置未写入，请先解决冲突或手动完成配置，再重新打开其会话：Claude、Cursor",
    );
    expect(output).not.toContain("本次已成功配置的客户端会话：\nClaude");
  });

  it("groups successful and skipped clients separately in the next step", async () => {
    const projectRoot = createTemporaryProject();
    writeConflictingEntry(projectRoot, ".mcp.json");
    const capture = outputCapture();

    expect(
      await runCli(
        ["init", "--project", projectRoot, "--client", "claude,cursor,codex"],
        capture.output,
      ),
    ).toBe(0);

    const output = capture.stdout.join("");
    expect(output).toContain(
      "下一步：完成项目指令配置后，重新打开本次已成功配置的客户端会话：\nCursor、Codex",
    );
    expect(output).toContain(
      "⚠ 以下客户端的 MCP 配置未写入，请先解决冲突或手动完成配置，再重新打开其会话：Claude",
    );
    expect(output).not.toContain("重新打开本次已成功配置的客户端会话：\nClaude");
  });

  it("asks for the AGY registration command instead of calling AGY configured", async () => {
    const projectRoot = createTemporaryProject();
    const capture = outputCapture();

    expect(
      await runCli(["init", "--project", projectRoot, "--client", "agy"], capture.output),
    ).toBe(0);

    const output = capture.stdout.join("");
    expect(output).toContain("⚠ AGY MCP 配置需手动注册：milestack init 不修改用户级配置");
    expect(output).toContain(
      "下一步：完成项目指令配置后，本次没有已成功配置的项目级客户端会话，请先完成下面的待办。",
    );
    expect(output).toContain(
      "⚠ AGY 需要先执行上面给出的注册或更新命令，再重新打开其会话。",
    );
    expect(output).not.toContain("已成功配置的客户端会话：\nAGY");
  });

  it("keeps AGY outside the configured list when it is selected together with a file client", async () => {
    const projectRoot = createTemporaryProject();
    const capture = outputCapture();

    expect(
      await runCli(["init", "--project", projectRoot, "--client", "claude,agy"], capture.output),
    ).toBe(0);

    const output = capture.stdout.join("");
    expect(output).toContain("重新打开本次已成功配置的客户端会话：\nClaude");
    expect(output).toContain(
      "⚠ AGY 需要先执行上面给出的注册或更新命令，再重新打开其会话。",
    );
    expect(output).not.toContain("客户端会话：\nClaude、AGY");
  });
});

describe("project MCP configuration", () => {
  let restoreLauncherEnvironment = (): void => {};

  beforeEach(() => {
    restoreLauncherEnvironment = useLauncherEnvironment({ launcherOnPath: true }).restore;
  });

  afterEach(() => {
    restoreLauncherEnvironment();
  });

  it("creates project files for all supported clients and is idempotent", () => {
    const projectRoot = createTemporaryProject();
    const absoluteProjectRoot = path.resolve(projectRoot);

    expect(projectMcpClientNames).toEqual([
      "claude",
      "cursor",
      "grok",
      "codex",
      "opencode",
      "agy",
    ]);
    const fileClients = projectMcpClientNames.filter((name) => name !== "agy");
    const firstResults = configureProjectMcpClients(projectRoot, projectMcpClientNames);
    const fileResults = firstResults.filter((item) => item.client !== "agy");
    const agyResult = firstResults.find((item) => item.client === "agy");
    expect(fileResults.map((item) => item.action)).toEqual([
      "created",
      "created",
      "created",
      "created",
      "created",
    ]);
    expect(fileResults.map((item) => item.relativePath)).toEqual([
      ".mcp.json",
      ".cursor/mcp.json",
      ".grok/config.toml",
      ".codex/config.toml",
      "opencode.json",
    ]);
    expect(fileResults.every((item) => item.detail.startsWith("已写入 "))).toBe(true);
    expect(agyResult?.action).toBe("skipped");
    expect(agyResult?.relativePath).toBe("~/.gemini/config/mcp_config.json");
    expect(agyResult?.detail).toContain("--discover");
    expect(agyResult?.detail).toContain("~/.gemini/config/mcp_config.json");
    expect(agyResult?.detail).toContain("agy mcp add milestack -- milestack mcp --discover");
    expect(agyResult?.detail).toContain("agy mcp list");

    const snapshots = fileResults.map((item) => readFileSync(path.join(projectRoot, item.relativePath), "utf8"));
    expect(JSON.parse(snapshots[0] ?? "{}")).toMatchObject({
      mcpServers: {
        milestack: {
          command: "milestack",
          args: ["mcp", "--project", absoluteProjectRoot],
        },
      },
    });
    expect(snapshots[1]).toContain(`"--project",\n        "${absoluteProjectRoot}"`);
    expect(snapshots[2]).toContain(`[mcp_servers.milestack]`);
    expect(snapshots[3]).toContain(`"${absoluteProjectRoot}"`);
    expect(JSON.parse(snapshots[4] ?? "{}")).toMatchObject({
      $schema: "https://opencode.ai/config.json",
      mcp: {
        milestack: {
          type: "local",
          command: ["milestack", "mcp", "--project", absoluteProjectRoot],
          enabled: true,
        },
      },
    });

    const secondResults = configureProjectMcpClients(projectRoot, projectMcpClientNames);
    const secondFileResults = secondResults.filter((item) => item.client !== "agy");
    expect(secondFileResults.map((item) => item.action)).toEqual([
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
    expect(secondFileResults.every((item, index) => {
      const relativePath = fileResults[index]?.relativePath;
      return relativePath !== undefined && readFileSync(path.join(projectRoot, relativePath), "utf8") === snapshots[index];
    })).toBe(true);
  });

  it("merges JSON configs, preserves matching bytes, and skips invalid or conflicting files", () => {
    const projectRoot = createTemporaryProject();
    const jsonPath = path.join(projectRoot, ".mcp.json");
    const existing = JSON.stringify({
      custom: "preserve",
      mcpServers: {
        other: { command: "other-tool", args: [] },
      },
    }, null, 2);
    writeFileSync(jsonPath, existing, "utf8");

    const [updated] = configureProjectMcpClients(projectRoot, ["claude"]);
    expect(updated).toMatchObject({
      client: "claude",
      relativePath: ".mcp.json",
      action: "updated",
    });
    expect(updated?.detail).toContain("保留原有其他配置");
    expect(JSON.parse(readFileSync(jsonPath, "utf8"))).toMatchObject({
      custom: "preserve",
      mcpServers: {
        other: { command: "other-tool", args: [] },
        milestack: {
          command: "milestack",
          args: ["mcp", "--project", path.resolve(projectRoot)],
        },
      },
    });

    const matching = JSON.stringify({
      mcpServers: {
        milestack: {
          command: "milestack",
          args: ["mcp", "--project", path.resolve(projectRoot)],
          env: { KEEP: "1" },
          cwd: "/tmp/keep",
          enabled: false,
        },
      },
    }, null, 2);
    writeFileSync(jsonPath, matching, "utf8");
    const matchingBytes = readFileSync(jsonPath, "utf8");
    const [unchanged] = configureProjectMcpClients(projectRoot, ["claude"]);
    expect(unchanged?.action).toBe("unchanged");
    expect(readFileSync(jsonPath, "utf8")).toBe(matchingBytes);

    const conflicting = JSON.stringify({
      mcpServers: {
        milestack: { command: "different", args: [] },
      },
    }, null, 2);
    writeFileSync(jsonPath, conflicting, "utf8");
    const conflictingBytes = readFileSync(jsonPath, "utf8");
    const [conflict] = configureProjectMcpClients(projectRoot, ["claude"]);
    expect(conflict?.action).toBe("skipped");
    expect(readFileSync(jsonPath, "utf8")).toBe(conflictingBytes);

    for (const invalid of ["{ invalid", "[]", JSON.stringify({ mcpServers: [] })]) {
      writeFileSync(jsonPath, invalid, "utf8");
      const invalidBytes = readFileSync(jsonPath, "utf8");
      const [skipped] = configureProjectMcpClients(projectRoot, ["claude"]);
      expect(skipped?.action).toBe("skipped");
      expect(readFileSync(jsonPath, "utf8")).toBe(invalidBytes);
    }
  });

  it("creates and merges OpenCode JSON configs without replacing existing entries", () => {
    const projectRoot = createTemporaryProject();
    const absoluteProjectRoot = path.resolve(projectRoot);
    const opencodePath = path.join(projectRoot, "opencode.json");

    const [created] = configureProjectMcpClients(projectRoot, ["opencode"]);
    expect(created).toMatchObject({
      client: "opencode",
      relativePath: "opencode.json",
      action: "created",
    });
    const createdBytes = readFileSync(opencodePath, "utf8");
    expect(JSON.parse(createdBytes)).toEqual({
      $schema: "https://opencode.ai/config.json",
      mcp: {
        milestack: {
          type: "local",
          command: ["milestack", "mcp", "--project", absoluteProjectRoot],
          enabled: true,
        },
      },
    });

    const [unchanged] = configureProjectMcpClients(projectRoot, ["opencode"]);
    expect(unchanged?.action).toBe("unchanged");
    expect(readFileSync(opencodePath, "utf8")).toBe(createdBytes);

    writeFileSync(
      opencodePath,
      JSON.stringify(
        {
          $schema: "https://example.test/opencode.json",
          model: "keep-me",
          mcp: {
            other: { type: "local", command: ["other"] },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const [updated] = configureProjectMcpClients(projectRoot, ["opencode"]);
    expect(updated?.action).toBe("updated");
    expect(JSON.parse(readFileSync(opencodePath, "utf8"))).toMatchObject({
      $schema: "https://example.test/opencode.json",
      model: "keep-me",
      mcp: {
        other: { type: "local", command: ["other"] },
        milestack: {
          type: "local",
          command: ["milestack", "mcp", "--project", absoluteProjectRoot],
          enabled: true,
        },
      },
    });

    const matching = JSON.stringify(
      {
        mcp: {
          milestack: {
            type: "local",
            command: ["milestack", "mcp", "--project", absoluteProjectRoot],
            enabled: true,
            timeout: 10000,
          },
        },
      },
      null,
      2,
    );
    writeFileSync(opencodePath, matching, "utf8");
    const matchingBytes = readFileSync(opencodePath, "utf8");
    const [matchingResult] = configureProjectMcpClients(projectRoot, ["opencode"]);
    expect(matchingResult?.action).toBe("unchanged");
    expect(readFileSync(opencodePath, "utf8")).toBe(matchingBytes);

    const conflicting = JSON.stringify(
      {
        mcp: {
          milestack: {
            type: "remote",
            url: "https://example.test/mcp",
          },
        },
      },
      null,
      2,
    );
    writeFileSync(opencodePath, conflicting, "utf8");
    const conflictingBytes = readFileSync(opencodePath, "utf8");
    const [conflict] = configureProjectMcpClients(projectRoot, ["opencode"]);
    expect(conflict?.action).toBe("skipped");
    expect(readFileSync(opencodePath, "utf8")).toBe(conflictingBytes);

    for (const invalid of ["{ invalid", "[]", JSON.stringify({ mcp: [] })]) {
      writeFileSync(opencodePath, invalid, "utf8");
      const invalidBytes = readFileSync(opencodePath, "utf8");
      const [skipped] = configureProjectMcpClients(projectRoot, ["opencode"]);
      expect(skipped?.action).toBe("skipped");
      expect(readFileSync(opencodePath, "utf8")).toBe(invalidBytes);
    }
  });

  it("leaves opencode.jsonc alone and explains the manual configuration path", () => {
    const projectRoot = createTemporaryProject();
    const jsoncPath = path.join(projectRoot, "opencode.jsonc");
    const jsoncBytes = "// keep comments\n{\n  \"model\": \"keep-me\"\n}\n";
    writeFileSync(jsoncPath, jsoncBytes, "utf8");

    const [jsoncOnly] = configureProjectMcpClients(projectRoot, ["opencode"]);
    expect(jsoncOnly?.action).toBe("skipped");
    expect(jsoncOnly?.detail).toContain("opencode.jsonc");
    expect(jsoncOnly?.detail).toContain("手写");
    expect(existsSync(path.join(projectRoot, "opencode.json"))).toBe(false);
    expect(readFileSync(jsoncPath, "utf8")).toBe(jsoncBytes);

    const opencodePath = path.join(projectRoot, "opencode.json");
    writeFileSync(
      opencodePath,
      JSON.stringify({ mcp: { other: { type: "local", command: ["other"] } } }, null, 2),
      "utf8",
    );
    const [updated] = configureProjectMcpClients(projectRoot, ["opencode"]);
    expect(updated?.action).toBe("updated");
    expect(updated?.detail).toContain("opencode.jsonc");
    expect(updated?.detail).toContain("未修改");
    expect(readFileSync(jsoncPath, "utf8")).toBe(jsoncBytes);
  });

  it("accepts opencode through init and writes only the project config", async () => {
    const projectRoot = createTemporaryProject();
    const capture = outputCapture();

    expect(await runCli(["init", "--project", projectRoot, "--client", "opencode"], capture.output)).toBe(0);
    expect(capture.stdout.join(" ")).toContain("opencode.json");
    expect(JSON.parse(readFileSync(path.join(projectRoot, "opencode.json"), "utf8"))).toMatchObject({
      mcp: {
        milestack: {
          type: "local",
          command: ["milestack", "mcp", "--project", path.resolve(projectRoot)],
          enabled: true,
        },
      },
    });
  });

  it("appends TOML configs without rewriting existing content and skips conflicts", () => {
    const projectRoot = createTemporaryProject();
    const tomlPath = path.join(projectRoot, ".grok", "config.toml");
    const existing = "# keep this comment\n[other]\nvalue = 1\n";
    mkdirSync(path.dirname(tomlPath), { recursive: true });
    writeFileSync(tomlPath, existing, "utf8");

    const [updated] = configureProjectMcpClients(projectRoot, ["grok"]);
    const appended = readFileSync(tomlPath, "utf8");
    expect(updated?.action).toBe("updated");
    expect(appended.startsWith(existing)).toBe(true);
    expect(appended).toContain("[mcp_servers.milestack]");
    expect(appended).toContain(`args = ["mcp", "--project", "${path.resolve(projectRoot)}"]`);

    const matching = [
      "[mcp_servers.milestack]",
      "command = \"milestack\"",
      `args = ["mcp", "--project", "${path.resolve(projectRoot)}"]`,
      "enabled = false",
      "",
    ].join("\n");
    const codexPath = path.join(projectRoot, ".codex", "config.toml");
    mkdirSync(path.dirname(codexPath), { recursive: true });
    writeFileSync(codexPath, matching, "utf8");
    const matchingBytes = readFileSync(codexPath, "utf8");
    const [unchanged] = configureProjectMcpClients(projectRoot, ["codex"]);
    expect(unchanged?.action).toBe("unchanged");
    expect(readFileSync(codexPath, "utf8")).toBe(matchingBytes);

    const conflicting = matching.replace('command = "milestack"', 'command = "different"');
    writeFileSync(codexPath, conflicting, "utf8");
    const conflictingBytes = readFileSync(codexPath, "utf8");
    const [conflict] = configureProjectMcpClients(projectRoot, ["codex"]);
    expect(conflict?.action).toBe("skipped");
    expect(readFileSync(codexPath, "utf8")).toBe(conflictingBytes);
  });

  it("skips symlink targets that resolve outside the project and preserves external bytes", () => {
    const projectRoot = createTemporaryProject();
    const externalRoot = path.join(os.tmpdir(), `milestack-cli-external-${randomUUID()}`);
    mkdirSync(externalRoot, { recursive: true });
    temporaryProjects.push(externalRoot);

    const externalParentTarget = path.join(externalRoot, "config.toml");
    const externalParentBytes = "[other]\nvalue = 1\n";
    writeFileSync(externalParentTarget, externalParentBytes, "utf8");
    symlinkSync(externalRoot, path.join(projectRoot, ".codex"), "dir");

    const [parentSymlinkResult] = configureProjectMcpClients(projectRoot, ["codex"]);
    expect(parentSymlinkResult?.action).toBe("skipped");
    expect(readFileSync(externalParentTarget, "utf8")).toBe(externalParentBytes);

    const externalFileTarget = path.join(externalRoot, "mcp.json");
    const externalFileBytes = JSON.stringify({
      custom: "outside",
      mcpServers: { other: { command: "other-tool", args: [] } },
    }, null, 2);
    writeFileSync(externalFileTarget, externalFileBytes, "utf8");
    symlinkSync(externalFileTarget, path.join(projectRoot, ".mcp.json"));

    const [fileSymlinkResult] = configureProjectMcpClients(projectRoot, ["claude"]);
    expect(fileSymlinkResult?.action).toBe("skipped");
    expect(readFileSync(externalFileTarget, "utf8")).toBe(externalFileBytes);
  });

  it("recognizes equivalent TOML mcp_servers.milestack table headers", () => {
    const projectRoot = createTemporaryProject();
    const tomlPath = path.join(projectRoot, ".codex", "config.toml");
    mkdirSync(path.dirname(tomlPath), { recursive: true });

    for (const header of [
      '[mcp_servers."milestack"]',
      '[mcp_servers . "milestack"]',
      "[mcp_servers.'milestack']",
    ]) {
      const matching = [
        header,
        'command = "milestack"',
        `args = ["mcp", "--project", "${path.resolve(projectRoot)}"]`,
        "enabled = false",
        "",
      ].join("\n");
      writeFileSync(tomlPath, matching, "utf8");
      const matchingBytes = readFileSync(tomlPath, "utf8");
      const [unchanged] = configureProjectMcpClients(projectRoot, ["codex"]);
      expect(unchanged?.action).toBe("unchanged");
      expect(readFileSync(tomlPath, "utf8")).toBe(matchingBytes);

      const conflicting = matching.replace('command = "milestack"', 'command = "different"');
      writeFileSync(tomlPath, conflicting, "utf8");
      const conflictingBytes = readFileSync(tomlPath, "utf8");
      const [skipped] = configureProjectMcpClients(projectRoot, ["codex"]);
      expect(skipped?.action).toBe("skipped");
      expect(readFileSync(tomlPath, "utf8")).toBe(conflictingBytes);
    }
  });
});

describe("project MCP entries without a globally installed CLI", () => {
  it("keeps the bare milestack command when the CLI resolves through PATH", () => {
    const projectRoot = createTemporaryProject();
    const { restore } = useLauncherEnvironment({ launcherOnPath: true });
    try {
      const [created] = configureProjectMcpClients(projectRoot, ["opencode"]);

      expect(created?.action).toBe("created");
      expect(created?.detail).not.toContain("PATH 中未找到");
      expect(JSON.parse(readFileSync(path.join(projectRoot, "opencode.json"), "utf8"))).toMatchObject({
        mcp: {
          milestack: {
            type: "local",
            command: ["milestack", "mcp", "--project", path.resolve(projectRoot)],
            enabled: true,
          },
        },
      });
    } finally {
      restore();
    }
  });

  it("writes node plus the current CLI entry for every file client when PATH has no milestack", () => {
    const projectRoot = createTemporaryProject();
    const absoluteProjectRoot = path.resolve(projectRoot);
    const { cliEntryPath, restore } = useLauncherEnvironment({ launcherOnPath: false });
    try {
      const [created] = configureProjectMcpClients(projectRoot, ["opencode"]);
      expect(created?.action).toBe("created");
      expect(created?.detail).toContain("PATH 中未找到 milestack");
      expect(created?.detail).toContain(cliEntryPath);

      const opencodePath = path.join(projectRoot, "opencode.json");
      const createdBytes = readFileSync(opencodePath, "utf8");
      expect(JSON.parse(createdBytes)).toEqual({
        $schema: "https://opencode.ai/config.json",
        mcp: {
          milestack: {
            type: "local",
            command: [
              process.execPath,
              cliEntryPath,
              "mcp",
              "--project",
              absoluteProjectRoot,
            ],
            enabled: true,
          },
        },
      });

      const [unchanged] = configureProjectMcpClients(projectRoot, ["opencode"]);
      expect(unchanged?.action).toBe("unchanged");
      expect(readFileSync(opencodePath, "utf8")).toBe(createdBytes);

      configureProjectMcpClients(projectRoot, ["claude", "codex"]);
      expect(JSON.parse(readFileSync(path.join(projectRoot, ".mcp.json"), "utf8"))).toMatchObject({
        mcpServers: {
          milestack: {
            command: process.execPath,
            args: [cliEntryPath, "mcp", "--project", absoluteProjectRoot],
          },
        },
      });
      expect(readFileSync(path.join(projectRoot, ".codex", "config.toml"), "utf8")).toContain(
        `command = "${process.execPath}"\nargs = ["${cliEntryPath}", "mcp", "--project", "${absoluteProjectRoot}"]`,
      );
    } finally {
      restore();
    }
  });

  it("merges the fallback entry into an existing opencode.json without losing its content", () => {
    const projectRoot = createTemporaryProject();
    const absoluteProjectRoot = path.resolve(projectRoot);
    const opencodePath = path.join(projectRoot, "opencode.json");
    writeFileSync(
      opencodePath,
      JSON.stringify({ model: "keep-me", mcp: { other: { type: "local", command: ["other"] } } }, null, 2),
      "utf8",
    );
    const { cliEntryPath, restore } = useLauncherEnvironment({ launcherOnPath: false });
    try {
      const [updated] = configureProjectMcpClients(projectRoot, ["opencode"]);
      expect(updated?.action).toBe("updated");
      expect(JSON.parse(readFileSync(opencodePath, "utf8"))).toMatchObject({
        model: "keep-me",
        mcp: {
          other: { type: "local", command: ["other"] },
          milestack: {
            type: "local",
            command: [
              process.execPath,
              cliEntryPath,
              "mcp",
              "--project",
              absoluteProjectRoot,
            ],
            enabled: true,
          },
        },
      });
    } finally {
      restore();
    }
  });

  it("preserves an existing bare-command entry instead of replacing it with the fallback", () => {
    const projectRoot = createTemporaryProject();
    const absoluteProjectRoot = path.resolve(projectRoot);
    const installed = useLauncherEnvironment({ launcherOnPath: true });
    configureProjectMcpClients(projectRoot, ["opencode"]);
    installed.restore();

    const opencodePath = path.join(projectRoot, "opencode.json");
    const installedBytes = readFileSync(opencodePath, "utf8");
    expect(JSON.parse(installedBytes)).toMatchObject({
      mcp: { milestack: { command: ["milestack", "mcp", "--project", absoluteProjectRoot] } },
    });

    const { restore } = useLauncherEnvironment({ launcherOnPath: false });
    try {
      const [skipped] = configureProjectMcpClients(projectRoot, ["opencode"]);
      expect(skipped?.action).toBe("skipped");
      expect(skipped?.detail).toContain("未覆盖 opencode.json");
      // Nothing was written, so the detail must not claim the command changed.
      expect(skipped?.detail).not.toContain("PATH 中未找到");
      expect(readFileSync(opencodePath, "utf8")).toBe(installedBytes);

      const jsonPath = path.join(projectRoot, ".mcp.json");
      writeFileSync(
        jsonPath,
        JSON.stringify({ mcpServers: { milestack: { command: "different", args: [] } } }, null, 2),
        "utf8",
      );
      const [jsonSkipped] = configureProjectMcpClients(projectRoot, ["claude"]);
      expect(jsonSkipped?.action).toBe("skipped");
      expect(jsonSkipped?.detail).not.toContain("PATH 中未找到");
    } finally {
      restore();
    }
  });

  it("prints a manual opencode.jsonc entry that uses the fallback command", () => {
    const projectRoot = createTemporaryProject();
    const jsoncPath = path.join(projectRoot, "opencode.jsonc");
    const jsoncBytes = "// keep comments\n{\n  \"model\": \"keep-me\"\n}\n";
    writeFileSync(jsoncPath, jsoncBytes, "utf8");
    const { cliEntryPath, restore } = useLauncherEnvironment({ launcherOnPath: false });
    try {
      const [jsoncOnly] = configureProjectMcpClients(projectRoot, ["opencode"]);
      expect(jsoncOnly?.action).toBe("skipped");
      const detail = jsoncOnly?.detail ?? "";
      expect(detail).toContain("手写");
      expect(detail).toContain(
        JSON.stringify(
          {
            mcp: {
              milestack: {
                type: "local",
                command: [
                  process.execPath,
                  cliEntryPath,
                  "mcp",
                  "--project",
                  path.resolve(projectRoot),
                ],
                enabled: true,
              },
            },
          },
          null,
          2,
        ),
      );
      expect(existsSync(path.join(projectRoot, "opencode.json"))).toBe(false);
      expect(readFileSync(jsoncPath, "utf8")).toBe(jsoncBytes);
    } finally {
      restore();
    }
  });

  it("keeps the bare command and explains the global install step when no CLI entry file exists", () => {
    const projectRoot = createTemporaryProject();
    const { restore } = useLauncherEnvironment({ launcherOnPath: false, cliEntryExists: false });
    try {
      const [created] = configureProjectMcpClients(projectRoot, ["opencode"]);
      expect(created?.action).toBe("created");
      expect(created?.detail).toContain("pnpm link --global");
      expect(JSON.parse(readFileSync(path.join(projectRoot, "opencode.json"), "utf8"))).toMatchObject({
        mcp: {
          milestack: {
            command: ["milestack", "mcp", "--project", path.resolve(projectRoot)],
          },
        },
      });
    } finally {
      restore();
    }
  });

  it("reports the fallback entry through init when the CLI is not installed", async () => {
    const projectRoot = createTemporaryProject();
    const capture = outputCapture();
    const { cliEntryPath, restore } = useLauncherEnvironment({ launcherOnPath: false });
    try {
      expect(
        await runCli(
          ["init", "--project", projectRoot, "--client", "opencode", "--client", "claude"],
          capture.output,
        ),
      ).toBe(0);
      expect(capture.stderr).toEqual([]);

      const output = capture.stdout.join("");
      expect(output).toContain("PATH 中未找到 milestack");
      expect(output).toContain(cliEntryPath);
      expect(JSON.parse(readFileSync(path.join(projectRoot, "opencode.json"), "utf8"))).toMatchObject({
        mcp: {
          milestack: {
            type: "local",
            command: [
              process.execPath,
              cliEntryPath,
              "mcp",
              "--project",
              path.resolve(projectRoot),
            ],
            enabled: true,
          },
        },
      });
    } finally {
      restore();
    }
  });
});

describe("project MCP entries started from the project dependency", () => {
  it("pins every client to the project entry even when a global CLI is on PATH", () => {
    const projectRoot = createTemporaryProject();
    const absoluteProjectRoot = path.resolve(projectRoot);
    const { cliEntryPath, restore } = useLauncherEnvironment({
      launcherOnPath: true,
      cliEntryDirectory: path.join(absoluteProjectRoot, "node_modules", "milestack", "dist"),
    });
    try {
      const results = configureProjectMcpClients(projectRoot, [
        "claude",
        "cursor",
        "grok",
        "codex",
        "opencode",
      ]);

      expect(results.map((item) => item.action)).toEqual([
        "created",
        "created",
        "created",
        "created",
        "created",
      ]);
      for (const result of results) {
        expect(result.detail).toContain("已固定到项目 node_modules");
        expect(result.detail).not.toContain("PATH 中未找到");
      }

      const expectedEntry = {
        command: process.execPath,
        args: [cliEntryPath, "mcp", "--project", absoluteProjectRoot],
      };
      for (const relativePath of [".mcp.json", ".cursor/mcp.json"]) {
        expect(JSON.parse(readFileSync(path.join(projectRoot, relativePath), "utf8"))).toMatchObject({
          mcpServers: { milestack: expectedEntry },
        });
      }
      for (const relativePath of [".grok/config.toml", ".codex/config.toml"]) {
        expect(readFileSync(path.join(projectRoot, relativePath), "utf8")).toContain(
          `command = "${process.execPath}"\nargs = ["${cliEntryPath}", "mcp", "--project", "${absoluteProjectRoot}"]`,
        );
      }
      expect(JSON.parse(readFileSync(path.join(projectRoot, "opencode.json"), "utf8"))).toMatchObject({
        mcp: {
          milestack: {
            type: "local",
            command: [process.execPath, cliEntryPath, "mcp", "--project", absoluteProjectRoot],
            enabled: true,
          },
        },
      });
    } finally {
      restore();
    }
  });
});

describe("project discovery", () => {
  it("discovers a MileStack project from a subdirectory", async () => {
    const projectRoot = createTemporaryProject();
    const init = outputCapture();
    expect(await runCli(["init", "--project", projectRoot], init.output)).toBe(0);

    const subdir = path.join(projectRoot, "src", "deep", "nested");
    mkdirSync(subdir, { recursive: true });

    const discovered = discoverProjectRoot(subdir);
    expect(discovered).toBe(path.resolve(projectRoot));
  });

  it("throws a clear error when no .milestack database is found", () => {
    const emptyDir = createTemporaryProject();
    expect(() => discoverProjectRoot(emptyDir)).toThrow(
      /no \.milestack\/milestack\.db found/,
    );
  });

  it("throws when the start directory does not exist", () => {
    const nonExistent = path.join(os.tmpdir(), `milestack-nonexistent-${randomUUID()}`);
    expect(() => discoverProjectRoot(nonExistent)).toThrow(/does not exist/);
  });

  it("uses cwd when no argument is provided", async () => {
    const projectRoot = createTemporaryProject();
    const init = outputCapture();
    expect(await runCli(["init", "--project", projectRoot], init.output)).toBe(0);

    const originalCwd = process.cwd();
    try {
      process.chdir(projectRoot);
      const discovered = discoverProjectRoot();
      // On macOS /var -> /private/var, so cwd may differ from the original
      // path used during init.  Verify the discovered root contains the db.
      expect(existsSync(path.join(discovered, ".milestack", "milestack.db"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("status --discover finds the project from a subdirectory", async () => {
    const projectRoot = createTemporaryProject();
    const init = outputCapture();
    expect(await runCli(["init", "--project", projectRoot], init.output)).toBe(0);

    const subdir = path.join(projectRoot, "src");
    mkdirSync(subdir, { recursive: true });

    const originalCwd = process.cwd();
    try {
      process.chdir(subdir);
      const status = outputCapture();
      expect(await runCli(["status", "--discover"], status.output)).toBe(0);
      expect(status.stdout.join("")).toContain("项目：");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("rejects --discover combined with --project", async () => {
    const capture = outputCapture();
    expect(await runCli(["mcp", "--discover", "--project", "/tmp"], capture.output)).toBe(1);
    expect(capture.stderr.join("")).toContain("--discover and --project cannot be used together");
  });

  it("rejects --discover on init and serve commands", async () => {
    for (const command of ["init", "serve"]) {
      const capture = outputCapture();
      expect(await runCli([command, "--discover"], capture.output)).toBe(1);
      expect(capture.stderr.join("")).toContain("--discover is only supported for the mcp and status commands");
    }
  });

  describe("resolveWorkspaceProjectRoot", () => {
    it("resolves single root to discovered project", async () => {
      const projectRoot = createTemporaryProject();
      const init = outputCapture();
      expect(await runCli(["init", "--project", projectRoot], init.output)).toBe(0);

      const subdir = path.join(projectRoot, "src", "sub");
      mkdirSync(subdir, { recursive: true });

      expect(resolveWorkspaceProjectRoot([subdir])).toBe(path.resolve(projectRoot));
    });

    it("falls back to cwd when roots list is empty", async () => {
      const projectRoot = createTemporaryProject();
      const init = outputCapture();
      expect(await runCli(["init", "--project", projectRoot], init.output)).toBe(0);

      const originalCwd = process.cwd();
      try {
        process.chdir(projectRoot);
        const resolved = resolveWorkspaceProjectRoot([]);
        expect(existsSync(path.join(resolved, ".milestack", "milestack.db"))).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("resolves multiple roots belonging to the same project", async () => {
      const projectRoot = createTemporaryProject();
      const init = outputCapture();
      expect(await runCli(["init", "--project", projectRoot], init.output)).toBe(0);

      const dir1 = path.join(projectRoot, "pkg1");
      const dir2 = path.join(projectRoot, "pkg2");
      mkdirSync(dir1, { recursive: true });
      mkdirSync(dir2, { recursive: true });

      expect(resolveWorkspaceProjectRoot([dir1, dir2])).toBe(path.resolve(projectRoot));
    });

    it("rejects multi-root workspace with conflicting projects", async () => {
      const projectA = createTemporaryProject();
      const projectB = createTemporaryProject();
      const initA = outputCapture();
      const initB = outputCapture();
      expect(await runCli(["init", "--project", projectA], initA.output)).toBe(0);
      expect(await runCli(["init", "--project", projectB], initB.output)).toBe(0);

      expect(() => resolveWorkspaceProjectRoot([projectA, projectB])).toThrow(
        /Cannot start MileStack in multi-root workspace: found multiple different MileStack projects/,
      );
    });

    it("rejects multi-root workspace when a root is not an initialized project", async () => {
      const projectA = createTemporaryProject();
      const uninitDir = createTemporaryProject();
      const initA = outputCapture();
      expect(await runCli(["init", "--project", projectA], initA.output)).toBe(0);

      expect(() => resolveWorkspaceProjectRoot([projectA, uninitDir])).toThrow(
        /cannot be mapped to an initialized MileStack project/,
      );
    });

    it("rejects when database path is not a regular file", async () => {
      const projectRoot = createTemporaryProject();
      const dbDir = path.join(projectRoot, ".milestack", "milestack.db");
      mkdirSync(dbDir, { recursive: true });

      expect(() => discoverProjectRoot(projectRoot)).toThrow(/not a regular file/);
    });
  });
});
