// Serves the built Web UI on a throwaway project seeded with tasks in every
// dashboard state. Ctrl+C stops the server and deletes the temporary project.
// Developer actions go through the HTTP API and agent actions through MCP, so
// the seeded history matches what real use produces.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(checkout, "dist/index.js");
if (!existsSync(cli)) {
  console.error("dist/index.js is missing; run pnpm build first.");
  process.exit(1);
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), "milestack-demo-"));
const projectDir = path.join(tempDir, "demo-project");
mkdirSync(projectDir);

let server;
let client;
async function cleanup() {
  await client?.close().catch(() => {});
  server?.kill();
  rmSync(tempDir, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup().finally(() => process.exit(0));
  });
}

const git = (...args) =>
  execFileSync("git", args, { cwd: projectDir, encoding: "utf8" }).trim();

function startServer() {
  server = spawn("node", [cli, "serve", "--project", projectDir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let output = "";
    const onData = (chunk) => {
      output += chunk;
      const url = output.match(/https?:\/\/[\d.:]+/)?.[0];
      if (url) resolve(url);
    };
    server.stdout.on("data", onData);
    server.stderr.on("data", onData);
    server.on("exit", (code) => reject(new Error(`serve exited with ${code}:\n${output}`)));
  });
}

async function main() {
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "Initial commit");
  execFileSync("node", [cli, "init", "--project", projectDir], { stdio: "ignore" });
  const baseUrl = await startServer();

  client = new Client({ name: "milestack-demo", version: "0" });
  await client.connect(
    new StdioClientTransport({ command: "node", args: [cli, "mcp", "--project", projectDir] }),
  );

  console.log("Seeding demo tasks...");
  await seed(baseUrl);
  const { counts } = await mcp("get_project_status", { view: "compact" });
  console.log(`Tasks: ${JSON.stringify(counts)}`);
  console.log(`\nMileStack demo running at ${baseUrl}`);
  console.log(`Project: ${projectDir}`);
  console.log("Press Ctrl+C to stop and delete the demo project.");
}

async function mcp(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "";
  if (result.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}

async function seed(baseUrl) {
  async function http(method, url, body) {
    const res = await fetch(baseUrl + url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${method} ${url}: ${JSON.stringify(json)}`);
    return json;
  }

  const task = (topic, criteriaCount, extra = {}) => ({
    title: topic,
    objective:
      `现状：${topic}目前依赖手工处理，开发者需要在多个页面之间来回切换，容易遗漏状态变化；多个代理并行时，信息分散在各自的会话里，交接成本高。\n\n` +
      `完成后：${topic}在首页和任务详情里都能直接看到，状态变化即时反映；代理通过 MCP 读取同一份数据，不再依赖会话上下文。\n\n` +
      "不在范围内：云端同步、权限系统、桌面打包，以及与本任务无关的界面重排。",
    acceptanceCriteria: Array.from(
      { length: criteriaCount },
      (_, i) =>
        `场景：${topic}的第 ${i + 1} 种情况（例如数据为空、数据很多、并发修改或升级旧数据）。预期：界面和 MCP 返回一致，且不会丢失已有记录。验证：在临时数据库上运行对应测试，并检查持久化结果。`,
    ),
    ...extra,
  });

  async function createInbox(definition) {
    const { task: created } = await http("POST", "/api/tasks", { ...definition, status: "inbox" });
    return created.id;
  }

  async function createReady(definition, riskLevel = "low") {
    const id = await createInbox(definition);
    await http("POST", `/api/tasks/${id}/confirm`, { riskLevel });
    return id;
  }

  const finding = (k) => ({
    issue: `第 ${k} 处边界情况没有处理：并发提交时可能读到旧快照`,
    suggestion: "在同一事务内重新读取任务状态后再写入",
    severity: k % 2 ? "medium" : "high",
    trigger: "两个代理在同一秒内对同一任务调用写操作",
    impact: "任务快照与事件历史不一致，首页显示过期状态",
    evidence: "在临时数据库上用两个并发写入复现 3 次中 2 次失败",
    location: `src/core/task-service.ts:${400 + k * 37}`,
  });

  let branchCounter = 0;

  // Each plan entry is one submission followed by its review outcome:
  // "changes", "pass", or "pending" (submitted, not yet reviewed).
  async function runRounds(taskId, plan) {
    const branch = `task/demo-${++branchCounter}`;
    let openFindings = 0;
    for (const [round, outcome] of plan.entries()) {
      const { runId } = await mcp("start_task", { taskId, actorLabel: "claude" });
      git("checkout", "-q", "-B", branch, round === 0 ? "main" : branch);
      git("commit", "-q", "--allow-empty", "-m", `Round ${round + 1}`);
      const commitSha = git("rev-parse", "HEAD");
      git("checkout", "-q", "main");
      const { task: current } = await mcp("get_task", { taskId, view: "working" });
      await mcp("submit_for_review", {
        taskId,
        runId,
        commitSha,
        branch,
        summary: `第 ${round + 1} 轮提交：${round === 0 ? "完成主体实现" : "修复上一轮审核问题"}`,
        criteriaResults: current.acceptanceCriteria.map((criterion) => ({
          criterionId: criterion.id,
          status: "met",
          evidence: [{ command: "pnpm test", result: "全部通过" }],
        })),
        actorLabel: "claude",
      });
      if (outcome === "pending") break;

      const { reviewRunId } = await mcp("start_review", { taskId, actorLabel: "grok" });
      const findingClosures = Array.from({ length: openFindings }, (_, findingIndex) => ({
        findingIndex,
        status: "fixed",
        evidence: [{ command: "pnpm vitest run tests/core", result: "复现用例通过" }],
      }));
      if (outcome === "changes") {
        openFindings = 1 + (round % 3);
        await mcp("request_changes", {
          taskId,
          reviewRunId,
          findingClosures,
          summary: `需修改。第 ${round + 1} 轮发现 ${openFindings} 个问题，详见审核意见。`,
          findings: Array.from({ length: openFindings }, (_, k) => finding(k + 1)),
          actorLabel: "grok",
        });
      } else {
        openFindings = 0;
        await mcp("approve_review", {
          taskId,
          reviewRunId,
          findingClosures,
          summary: `通过。第 ${round + 1} 轮提交 ${commitSha} 修复了全部问题，所有验收标准独立复测通过。`,
          findings: [],
          verificationEvidence: [
            { command: "pnpm typecheck", result: "无错误" },
            { command: "pnpm test", result: "全部通过" },
            { command: "pnpm build", result: "成功" },
          ],
          actorLabel: "grok",
        });
      }
    }
    return branch;
  }

  // Completed: passed, then merged into main and verified as integrated.
  for (const [topic, plan] of [
    ["初始化命令幂等，不覆盖已有文件", ["pass"]],
    ["任务事件历史按时间倒序分页加载", ["pass"]],
    ["MCP 返回的错误信息统一为领域错误", ["changes", "pass"]],
    ["升级命令同时刷新项目内的生成文件", ["changes", "changes", "pass"]],
    ["审核记录保存每条验收标准的复测证据", ["pass"]],
    ["并发领取同一任务时只有一个代理成功", ["changes", "pass"]],
  ]) {
    const id = await createReady(task(topic, 3));
    const branch = await runRounds(id, plan);
    git("merge", "-q", "--no-ff", branch, "-m", `Merge ${branch}`);
    const { reviews } = await mcp("get_task", { taskId: id, view: "full" });
    await http("POST", `/api/tasks/${id}/check-integration`, {
      expectedReviewId: reviews.find((review) => review.status === "passed").id,
    });
  }

  // In review, developer side: passed and awaiting developer approval.
  for (const [topic, risk, plan] of [
    ["数据库从单表任务快照迁移到快照加事件双表结构，并在迁移前自动备份", "high", ["changes", "changes", "pass"]],
    ["审核通过后按风险等级决定是否需要开发者批准", "medium", ["changes", "pass"]],
    ["页面评论书签工具在跨域页面上也能提交评论", "medium", ["pass"]],
  ]) {
    await runRounds(await createReady(task(topic, 5), risk), plan);
  }

  // In review, developer side: low risk passed but not merged into main.
  for (const topic of ["状态命令的 JSON 输出包含集成状态", "草稿任务支持编辑依赖关系"]) {
    await runRounds(await createReady(task(topic, 2)), ["pass"]);
  }

  // In review, AI side: first submissions and re-submissions after changes requested.
  for (const [topic, risk, plan] of [
    ["首页队列在窄屏下改为单列堆叠并保持各队列可独立滚动", "low", ["pending"]],
    ["就绪队列显示每个任务正在等待的依赖", "low", ["changes", "pending"]],
    ["任务完成后自动检查审核提交是否已经进入目标分支", "high", ["changes", "changes", "pending"]],
    ["提交审核时校验每条验收标准都有交付结果", "medium", ["pending"]],
    ["草稿箱支持批量确认", "low", ["pending"]],
  ]) {
    await runRounds(await createReady(task(topic, 4), risk), plan);
  }

  // Ready after changes requested.
  await runRounds(await createReady(task("队列拖拽排序", 2)), ["changes"]);

  // Running: long progress, two with blockers that need the developer.
  for (const [topic, blocker] of [
    ["首页队列高度按内容分配", null],
    ["MCP 服务器说明按项目版本自动刷新", null],
    ["导出项目状态为 Markdown 并附带最近 20 条事件", "等待开发者确认导出文件的目录结构（docs/ 还是 .milestack/exports/）"],
    ["迁移脚本在磁盘空间不足时安全回滚", "本机磁盘空间不足以复现该场景，需要开发者提供一台测试机器或允许使用临时卷"],
  ]) {
    const id = await createReady(task(topic, 3));
    const { runId } = await mcp("start_task", { taskId: id, actorLabel: "codex" });
    await mcp("update_task", {
      taskId: id,
      runId,
      summary: `${topic}：主体实现完成，正在处理边界情况。`,
      completedWork: Array.from(
        { length: 8 },
        (_, i) => `完成第 ${i + 1} 部分：实现、补测试，并在临时数据库上验证持久化结果和事件历史保持一致。`,
      ),
      currentStep: "处理并发写入与旧数据兼容的边界情况，确认事务内先读后写。",
      nextStep: "补充回归测试，运行 typecheck、test、build 后提交审核。",
      blocker,
      requiredAction: blocker ? "请开发者在任务详情里回复决定后，代理继续执行。" : null,
      handoffNote: "如果需要换人接手：分支 task/demo-wip 上已有完整实现，只差最后两项测试。",
      actorLabel: "codex",
    });
  }

  // Ready: a dependency chain plus independent tasks of mixed risk.
  const templates = await createReady(task("定义任务模板的数据结构和存储格式", 3), "medium");
  const fromTemplate = await createReady(task("在草稿箱中从模板创建任务", 3, { dependencyIds: [templates] }));
  await createReady(task("模板支持预填验收标准和依赖", 4, { dependencyIds: [templates, fromTemplate] }));
  for (const [topic, risk] of [
    ["任务卡片显示风险等级和审核轮次", "low"],
    ["首页支持按关键词过滤任务", "low"],
    ["删除任务前检查是否被其他任务依赖", "high"],
    ["任务详情页显示每轮审核的差异摘要", "medium"],
    ["CLI 新增 milestack doctor 检查本地配置", "low"],
    ["页面评论支持截图附件", "low"],
  ]) {
    await createReady(task(topic, 3), risk);
  }

  // Inbox: developer drafts and agent-created drafts.
  for (const topic of [
    "设置页允许修改默认集成目标分支",
    "任务详情支持把审核意见一键复制给实施代理",
    "就绪队列支持把任务拖到草稿箱",
  ]) {
    await createInbox(task(topic, 3));
  }
  await mcp("create_tasks", {
    tasks: [
      task("同步中文用户指南的风险等级说明", 2),
      task("清理已合并任务的本地分支和工作区", 3),
      { ...task("长时间无进展的执行中任务在首页给出提示", 4), riskLevel: "medium" },
    ],
  });
}

main().catch(async (error) => {
  console.error(error);
  await cleanup();
  process.exit(1);
});
