# MileStack V0 技术方案

最小内核的实施任务见 [自举开发任务](./bootstrap-tasks.md)。该清单只在 MileStack 能管理自身之前使用。

## 1. 技术目标

V0 技术方案只服务于一个产品验证目标：使用尽可能简单的本地架构，跑通“开发者创建和排列任务，AI 领取并上报进度，双方读取同一份项目状态”的完整闭环。

技术实现应优先满足：

- UI 和 MCP 共用同一套任务状态机；
- 多个本地 AI 进程可以安全访问同一项目数据；
- UI 未运行时，AI 仍然可以读取和更新任务；
- 数据完全保存在本地，不依赖云端服务；
- 后续可以增加桌面包装和 HTTP MCP，而不需要重写核心业务。

## 2. 技术栈

| 层级 | 选择 | 用途 |
| --- | --- | --- |
| 语言 | TypeScript | 前端、服务端、CLI、MCP 和共享类型 |
| 运行时 | Node.js | 运行本地 HTTP 服务和 MCP stdio 服务 |
| 包管理 | pnpm | 依赖管理和脚本执行 |
| 前端 | React + Vite | 构建本地单页项目状态界面 |
| 样式 | Tailwind CSS | 快速实现 V0 页面样式 |
| HTTP 服务 | Fastify | 提供本地 API 并托管前端静态资源 |
| MCP | TypeScript MCP SDK | 向 AI 编程客户端暴露 MCP 工具 |
| 数据库 | SQLite | 保存项目、任务及事件历史 |
| 数据访问 | Drizzle ORM + better-sqlite3 | Schema、迁移、查询和事务 |
| 输入校验 | Zod | 复用 HTTP 和 MCP 的输入定义 |
| 前端请求 | TanStack Query | 查询缓存、轮询刷新和错误处理 |
| 测试 | Vitest | 测试状态机、数据库事务和 MCP 闭环 |
| CLI 构建 | tsup | 构建可执行的本地 CLI |

V0 使用 Node.js 当前受支持的 LTS 版本，不依赖实验性运行时能力。

## 3. 运行架构

V0 使用本地 Web 页面和 MCP stdio 入口，共享业务核心和 SQLite 数据库。

```text
浏览器
  |
  | HTTP
  v
MileStack Web Server
  |
  v
TaskService --------> SQLite
  ^
  |
MCP stdio Server
  ^
  |
Codex / Claude Code / Cursor
```

### 3.1 Web 服务

执行以下命令启动项目页面：

```bash
milestack serve
```

Web 服务默认只监听本机回环地址：

```text
http://127.0.0.1:7331
```

Fastify 提供本地 JSON API，并在生产构建中托管 Vite 生成的静态文件。React 页面通过 TanStack Query 定时轮询项目状态，V0 不使用 WebSocket。

### 3.2 MCP 服务

每个 AI 客户端通过 stdio 启动独立的 MCP 进程，支持两种启动模式：

1. **显式项目路径模式**（项目级客户端使用）：

   ```bash
   milestack mcp --project /absolute/path/to/project
   ```

   适用于 Codex、Claude Code、Cursor、Grok 等支持项目级配置文件的客户端，直接绑定指定项目的绝对路径。

2. **项目自动发现模式**（用户级全局客户端使用）：

   ```bash
   milestack mcp --discover
   ```

   适用于 Gemini Antigravity CLI（`agy`）等仅提供用户级全局 MCP 配置的客户端，单份全局注册可在所有已初始化项目中复用。

工作原理与安全边界：

- **初始项目根解析**：`runMcp` 启动时先读取 `WORKSPACE_DIRS` 或 `ANTIGRAVITY_WORKSPACE_DIRS` 的非空工作区根；若存在，则通过 `resolveWorkspaceProjectRoot()` 校验这些根，并在多根项目身份比较时尝试 `realpathSync` 规范化真实路径。如果环境变量未提供工作区根，才调用 `discoverProjectRoot()` 从当前工作目录（`process.cwd()`）或所在子目录递归向上查找 `.milestack/milestack.db`，进行基于 `path.resolve` 的绝对路径与词法规范化，并校验目标不是非常规文件；该发现阶段不进行符号链接 realpath 解析。
- **动态工作区根解析与失败关闭**：客户端声明 MCP `roots` capability 后，`runMcp` 在握手完成后通过 `roots/list` 获取返回的非空工作区根，并用 `resolveWorkspaceProjectRoot()` 再次校验。若所有工作区根唯一定位到同一个 MileStack 项目，绑定该项目正常启动；如果根目录跨越不同的 MileStack 项目或包含未初始化目录，**明确抛出错误并退出进程**（Fail-Close），拒绝静默任意选择项目。若客户端未声明 `roots` capability，服务端无法感知或验证其他附加工作区根；在环境变量也未提供工作区根时，只能依据启动时的当前工作目录发现并绑定单个项目，客户端此时必须作为单根工作区使用，并从目标项目目录启动。
- **项目隔离**：MCP 进程直接使用共享业务核心访问绑定项目的 SQLite 数据库，因此页面未运行时，AI 仍然可以工作；不同项目启动的独立进程互不干扰。

V0 先支持 stdio，以覆盖常见的本地 AI 编程客户端。后续可以复用相同的 MCP 工具处理器增加 Streamable HTTP 传输。

### 3.3 CLI 状态查询

在完整页面完成前，开发者可以通过 CLI 检查项目状态：

```bash
milestack status --project /absolute/path/to/project
# 或在当前项目目录及其子目录中使用自动发现：
milestack status --discover
```

输出应与 `get_project_status` 使用同一个 `TaskService` 查询，并至少包含当前任务、下一任务、阻塞和 inbox 数量。该命令既是早期验证入口，也是 MileStack 自举开发阶段的基础界面。

## 4. 本地数据

### 4.1 数据位置

每个项目的数据默认保存在项目根目录：

```text
<project-root>/.milestack/milestack.db
```

初始化项目时执行：

```bash
milestack init --project /absolute/path/to/current/checkout
```

`init` 负责：

- 创建 `.milestack/`；
- 初始化 SQLite Schema；
- 创建项目记录；
- 确保 `.milestack/` 被项目的 `.gitignore` 忽略；
- 输出带 `MILESTACK_START` 和 `MILESTACK_END` 标记的 AI 接入规则。

默认不传 `--client` 时，`init` 只把通用 MCP JSON 和手动执行 Codex/AGY 注册命令打印到终端，不会创建项目级客户端配置文件。

显式传入一个或多个 `--client` 时（支持 `claude`、`cursor`、`grok`、`codex`、`opencode`、`agy`，可重复或使用逗号分隔）：

- **项目级文件客户端**：`claude` 写 `.mcp.json`，`cursor` 写 `.cursor/mcp.json`，`grok` 写 `.grok/config.toml`，`codex` 写 `.codex/config.toml`，`opencode` 写项目根目录的 `opencode.json`，均绑定当前 checkout 的绝对路径；
- **用户级全局客户端**：`agy`（Gemini CLI）使用全局配置 `~/.gemini/config/mcp_config.json`。`init` 遵循不自动修改用户全局配置的安全约束，跳过文件写入，输出推荐的注册命令 `agy mcp add milestack -- milestack mcp --discover`、验证命令 `agy mcp list` 及手动配置指引。

`opencode` 使用其官方配置结构，条目写在顶层 `mcp.milestack`，与 JSON/TOML 客户端的 `mcpServers.milestack`、`[mcp_servers.milestack]` 不同：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "milestack": {
      "type": "local",
      "command": ["milestack", "mcp", "--project", "<当前 checkout 的绝对路径>"],
      "enabled": true
    }
  }
}
```

- 新建文件时写入上面的 `$schema`；已有文件只补齐缺失的 `mcp.milestack`，保留模型、其他 MCP 服务等既有字段和已有 `$schema`；条目相同时不改文件；
- 已有不同的 `mcp.milestack`、JSON 无法解析、配置根值不是对象或 `mcp` 不是对象时，跳过并保留原文件；
- 只有 `opencode.jsonc` 时不另建 `opencode.json`，改为在终端给出应手写的 `mcp.milestack` 条目；两个文件都存在时只更新 `opencode.json`，并说明 `opencode.jsonc` 未被修改；
- OpenCode 会把项目级 `opencode.json` 与全局 `~/.config/opencode/opencode.json` 合并，同名 MCP 服务以项目条目为准，因此 `init` 只补项目内缺失的 `milestack`，既不修改全局文件，也不执行 `opencode mcp add`。
- `opencode.json` 绑定的是当前 checkout 的绝对路径，属于每个 checkout 各自生成的本地配置，应加入版本控制忽略列表。`init` 只自动维护 `.milestack/` 的忽略条目，不会替项目写入 `opencode.json` 的忽略规则；MileStack 自身的仓库在 `.gitignore` 中显式忽略 `opencode.json`。

条目中的启动命令由 `src/cli/mcp-launcher.ts` 解析，供 JSON、TOML、opencode 三种写入共用：

- `PATH` 中能解析到可执行的 `milestack` 时使用裸命令 `milestack`，与全局安装 CLI 的既有行为一致；
- `PATH` 中没有 `milestack` 时使用 `process.execPath` 加当前 CLI 入口脚本绝对路径（`process.argv[1]`），使只在仓库内构建 `dist/index.js`、从未全局安装的开发者写入的条目仍可启动，并在真正写入条目的结果（`created` / `updated` / `unchanged`）中说明原因；
- 两者都无法确定时保留裸命令 `milestack`，并提示先执行 `pnpm build` 与 `pnpm link --global`，或手写 command；
- `skipped` 结果没有写入任何条目，因此不追加上述说明，避免与“未覆盖……已保留原文件”自相矛盾；
- 命令解析只决定新写入的条目形状。已有不同的 `milestack` 条目仍然保持不变，`init` 不会改写它，因此改用裸命令条目必须由开发者手动删除或修改该客户端的项目级 `milestack` 条目后再运行 `init`；
- `agy` 的用户级 `--discover` 手动配置说明保持裸命令，因为它在所有项目的全局配置中生效，不应绑定某个 checkout 的入口文件。

**为什么 AGY 不能写入固定项目路径**：若在用户级全局配置中写入固定路径 `--project /path/to/projectA`，在其他项目目录启动 AGY 时仍会错误读写项目 A 的数据库，造成跨项目数据污染。因此 AGY 必须采用 `--discover` 动态寻根模式。

`--project` 必须指向当前 checkout 的绝对路径，执行或提交前由开发者确认路径无误。项目级写入不会修改 `~/.claude.json`、`~/.cursor`、`~/.grok`、`~/.codex`、`~/.config/opencode` 或 `~/.gemini` 等全局客户端配置；已有不同的 `milestack` 条目保持不变，不会被覆盖。写入后需要重新打开对应客户端会话。Codex 项目配置只在已信任的仓库中生效，Claude 的 `.mcp.json` 仍需用户批准。

`init` 必须可以安全重复执行，不覆盖已有数据库、无关项目文件、Agent 指令或已有不同的客户端配置；显式 `--client` 只补充缺失的项目级 `milestack` 条目。

V0 不通过 Git 同步数据库，也不提供云端备份。

### 4.2 SQLite 配置

每个进程打开数据库后应设置：

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

WAL 允许 Web 服务和多个 MCP 进程并发读取，并串行完成短事务写入。

### 4.3 当前状态与历史

- `Task` 是任务当前状态的权威记录。任务状态包括 `inbox`、`ready`、`running`、`blocked`、`in_review` 和 `completed`；
- `TaskEvent` 是只追加的语义历史；
- `TaskReview` 是每轮审核的不可覆盖记录，保存固定的完整 40 位 commit SHA、可选 branch/worktree、审核领取凭证、结论、结构化 findings 和验证证据；
- `task_dependencies` 以 `(task_id, depends_on_task_id)` 关系保存前置依赖，并对两列建立外键；
- `runnable`、`waitingFor` 和“可并行”是查询时的派生结果，不写入数据库；
- 修改任务、审核快照和追加事件必须处于同一个 SQLite 事务；
- V0 不通过重放事件重建任务状态。

任务风险字段由 `Task` 保存：`riskLevel` 为 `low`、`medium` 或 `high`，默认 `medium`；`riskConfirmed`、确认者和确认时间记录开发者是否确认过风险。新建任务只有开发者直接创建为 `ready`，或开发者调用确认操作后，才允许执行领取；AI 不能自行确认风险或降低风险等级。历史数据库通过前向迁移补充 `medium` 和已确认的默认值，以保持已有任务可继续工作。

每次 `submit_for_review` 都创建新的 `TaskReview`，并清除执行 `activeRunId`。审核使用独立的 `activeReviewRunId`/`reviewRunId`，领取和完成都必须在短事务中校验当前凭证；审核退回或结束后凭证立即失效。新的提交创建新的 review round，旧审核结论不再决定当前任务。

审核策略如下：

| 风险 | AI 审核通过条件 | 通过后的状态 |
| --- | --- | --- |
| `low` | 开发者已确认风险，且至少有一条验证命令及结果 | 自动进入 `completed` |
| `medium` | 审核记录完整，可含结构化 findings 和验证证据 | 保持 `in_review`，等待开发者批准 |
| `high` | 审核记录完整，可含结构化 findings 和验证证据 | 保持 `in_review`，等待开发者批准 |

`request_changes` 会将结构化问题与修改建议写入当前审核记录和任务交接说明，清除审核及执行凭证，并将任务放回 `ready`；返工后必须重新领取执行凭证。开发者 `approve` 只能批准最新一轮已经通过 AI 审核的任务，且中高风险任务必须经过此最终批准。

迁移兼容策略：0003/后续恢复迁移只把没有 `TaskReview` 的历史 `in_review` 任务返回 `ready`，清除旧审核凭证，保留原事件并追加恢复说明；不创建虚构的 commit SHA 或审核记录。任务随后必须由 AI 重新领取并提交真实制品。已经存在真实 `TaskReview` 的任务不受该恢复策略影响。

### 4.4 数据库迁移与备份

`init`、`serve`、`mcp` 和 `status` 在访问数据库前统一调用 `ensureDatabase()`：

```text
CLI command
  -> ensureDatabase()
  -> 执行尚未应用的 Drizzle migrations
  -> 启动对应功能
```

每次 Schema 变化都新增前向迁移，不修改已经应用的迁移，也不要求删除真实项目数据库重新初始化。

开发阶段在执行会修改 Schema 或数据的迁移前，自动将数据库复制到：

```text
<project-root>/.milestack/backups/<timestamp>.db
```

备份创建失败时停止迁移并报告错误。备份目录与数据库一起保持在 `.gitignore` 中。稳定版本发布后再根据迁移风险决定备份保留策略。

## 5. 业务核心

HTTP 和 MCP 只负责协议转换，不直接实现任务状态流转。所有操作必须调用共享的 `TaskService`：

```text
HTTP Route ----\
                -> TaskService -> Repository -> SQLite
MCP Tool ------/
```

`TaskService` 负责：

- 校验任务状态流转；
- 创建和确认任务；
- 维护待办队列顺序；
- 校验任务依赖，拒绝自身依赖和循环依赖；
- 根据依赖状态计算 `runnable`、`waitingFor` 和当前可并行任务；
- 原子领取任务；
- 校验 `runId`；
- 保存开发者确认的风险等级并拒绝未经确认的执行；
- 更新任务当前快照；
- 追加 `TaskEvent`；
- 固定提交审核的 commit SHA 和 branch/worktree 元数据；
- 原子领取独立的 AI 审核会话，保存结构化结论和验证证据；
- 按风险策略自动完成低风险任务，或将中高风险任务留在 `in_review` 等待开发者最终批准；
- 接受开发者在审核无结论时的直接验收，把审核记为 `waived` 并完成任务；
- `request_changes` 记录 findings、清除旧凭证并将任务返回 `ready`；
- 生成项目状态和任务简报；
- 批量创建用于旧项目基线的 inbox 任务。

Zod Schema 应在 HTTP、MCP 和业务核心之间复用，避免为同一操作维护多套输入定义。

### 5.1 依赖契约与更新边界

- 创建输入的 `dependencyIds` 默认为空数组，查询结果始终返回数组；V0 批量创建只引用请求开始前已存在的同项目任务，不引入批次内临时 ID。
- `waitingFor` 使用 `{ id, title, status }` 简要引用，避免递归嵌套 `TaskSummary`。
- `next` 保留全部 `ready` 任务和人工顺序，包括等待依赖的任务；调用方从中选择第一个 `runnable = true` 的任务。
- `runnable` 还必须检查 `riskConfirmed`；风险未获开发者确认的 `ready` 任务仍展示在 `next`，但不能被视为可领取。
- `TaskService.setTaskDependencies()` 供开发者后续编辑任务时调用，只允许修改 `inbox` 或 `ready` 任务的依赖。校验、替换关系和追加一条 `progress` 事件须在同一写事务内完成；创建任务时依赖随 `created` 事件一并记录。
- 依赖校验拒绝不存在、跨项目、自身和循环依赖。事务必须串行化依赖修改，防止并发修改分别通过校验后形成环。
- 删除任务时，其作为依赖方的关系随任务删除；当它作为前置任务仍被引用时使用 `RESTRICT`，返回引用任务列表，避免删除操作静默解除依赖。

依赖能力在 `BOOT-003A` 中通过新迁移和契约扩展实现，`BOOT-003` 继续完成原定范围。

## 6. 任务领取与并发

### 6.1 原子领取

`start_task` 在同一事务中查询任务的未完成依赖。只有未完成依赖数为 `0` 时才生成 `runId`，并通过条件更新领取任务：

```sql
UPDATE tasks
SET status = 'running',
    active_run_id = ?,
    updated_at = ?
WHERE id = ?
  AND status = 'ready';
```

只有受影响行数为 `1` 时领取成功。若任务存在未完成依赖，应返回包含依赖任务 ID 和标题的领域错误；若受影响行数为 `0`，表示任务不存在、状态不允许领取或已经被其他 AI 领取。

领取成功后，在同一事务中追加 `started` 事件。

### 6.2 执行权校验

`update_task`、`block_task`、`resume_task`、`release_task` 和 `submit_for_review` 必须携带 `runId`。

服务端必须验证：

```text
input.runId == task.activeRunId
```

任务被释放或提交审核后清除 `activeRunId`。开发者退回返工或重新打开后，Agent 必须获得新的 `runId`；旧 MCP 进程随后发出的更新必须被拒绝。

### 6.3 审核权校验

`start_review` 只允许领取最新的 `pending` 审核记录，并生成独立的 `reviewRunId`。同一任务已有 `activeReviewRunId` 时，第二个审核者必须失败；`complete_review` 必须同时匹配任务和最新审核记录上的 `reviewRunId`，否则拒绝过期凭证。通过结论必须至少带一条 `{ command, result }` 验证证据。审核结束或退回后清除 `activeReviewRunId`。

审核者的 actor label、摘要、结构化 finding（问题、建议、严重度）和验证证据都属于审计数据；actor label 只是展示和审计信息，不能替代 `reviewRunId` 的并发所有权。

### 6.3.1 开发者直接验收（waived）

开发者可以在 AI 审核尚无结论时直接验收：`in_review` 任务必须带有提交时的 commit，最新审核为 `pending` 或 `in_progress`，且开发者提供非空验收原因。业务核心在同一个事务内把该轮审核置为 `waived`（写入 `concludedAt` 与开发者标识，不改成 `passed`，不补写验证证据），清除 `activeReviewRunId` 使原 `reviewRunId` 无法再提交结论，并把任务置为 `completed`；任务事件仍为 `approved`，摘要记下验收原因。审核状态约束通过前向迁移 `0005_review_waived_status` 增加 `waived`，已有数据库升级后仍能读取原有审核记录。

该操作只通过开发者侧 HTTP `POST /api/tasks/:id/waive-approval` 与页面暴露，不进入 MCP。`ready` 与 `running` 任务不能使用它，缺少验收原因同样拒绝。AI 审核通过后的风险策略不变：低风险仍自动完成，中高风险仍在 `passed` 后等待开发者一键批准。

### 6.4 V0 并发边界

V0 不实现通用乐观锁和请求幂等键。所有写事务应保持短小，不在事务中执行文件、网络或 AI 操作。如果真实验证中出现重复请求或更复杂的并发编辑，再增加 `requestId` 和版本字段。

## 7. 页面实现

React V0 页面只包含一个项目状态视图：

- 正在进行；
- 待开发者审核；
- 下一任务；
- 需要处理的阻塞；
- 待整理的 inbox；
- 最近完成。
- 审核操作只通过开发者侧 HTTP/UI 暴露：批准、填写反馈退回返工、在 AI 审核无结论时填写原因直接验收，以及将已完成任务重新打开。

完整项目状态返回按状态统计的 `counts`，其中 `counts.completed` 是全部已完成任务数；`recentlyCompleted` 仍是有限窗口（完整视图默认 10 条，compact 视图默认 3 条）。Web 页面展开归档后复用现有 `GET /api/tasks?status=completed` 分页查询，单页 `limit` 使用 1–100（优先 100），滚动到底部并且 `hasMore` 时携带 `nextCursor` 加载下一页。归档收起时保持分页查询禁用，已加载任务合并到前端任务索引和依赖拓扑。

下一任务区域应区分：

- `可执行`：状态为 `ready` 且所有依赖已经完成；
- `可并行`：当前存在多个可执行任务时的提示；
- `等待依赖`：列出尚未完成的前置任务；

页面可以展示轻量的依赖关系拓扑，但不保存静态 `parallelizable` 字段，也不据此自动调度任务。

并行提示仅基于已声明的任务依赖，不包含文件冲突或共享资源检测。等待依赖的任务保留在 `ready` 队列，不自动转入 `blocked`。

页面通过普通 HTTP API 完成：

- 创建和编辑任务；
- 确认或删除 inbox 任务；
- 调整 ready 队列顺序；
- 复制任务简报；
- 查看任务详情和事件历史；
- 手动释放任务。

开发者审核页面或 HTTP API 还应支持查看固定制品引用和审核记录、批准已通过的中高风险任务、提交带结构化 findings 的返工意见。AI 审核使用 `start_review` 和 `complete_review`，不绕过 `TaskService` 直接写入审核或任务表。

V0 可以用上移、下移操作调整队列顺序，不要求一开始实现拖拽。

## 8. 旧项目接入与 MileStack 自举

### 8.1 旧项目接入流程

旧项目采用零侵入接入，不要求修改业务代码或现有构建方式：

```text
milestack init --project <absolute-checkout>
  -> 创建本地数据库
  -> 默认只输出通用 MCP 配置和 AI 接入规则
  -> （显式 --client 时）只写入选中的项目级 MCP 配置
  -> AI 读取已有任务资料与代码状态
  -> create_tasks 批量写入 inbox
  -> 开发者确认、编辑并排列 ready 队列
```

显式 `--client` 时使用当前 checkout 的绝对路径，并在执行或提交前确认路径；全局客户端
配置不自动修改，已有不同的 `milestack` 条目不覆盖。

基线整理遵循以下规则：

- 只迁移仍然有效且可以说明目标的任务；
- 不把无法验证的旧文档内容直接视为当前事实；
- 正在进行的工作需要补充当前步骤和下一步；
- 阻塞任务需要说明阻塞原因和所需行动；
- 基线确认完成后，由开发者决定归档或删除旧动态任务文档；
- 架构、接口、决策记录等长期文档继续保留。

V0 的 `create_tasks` 是多条 `create_task` 的事务封装。默认创建 `inbox` 任务，单条输入失败时整个批次回滚并返回具体错误。

### 8.2 自举顺序

MileStack 不等待完整 Web 页面完成后才开始自用。实现以下自举内核后，应立即在当前仓库执行 `milestack init`：

1. SQLite Schema 和迁移机制；
2. `TaskService` 与 repository；
3. `milestack init`；
4. MCP stdio 入口；
5. `get_project_status`、`create_task(s)`、`start_task`、`update_task`、`submit_for_review`、`start_review` 和 `complete_review`；
6. `milestack status`。

从此阶段开始，后续功能、缺陷和使用反馈记录到 MileStack 自身的 inbox 和 ready 队列。开发中的真实摩擦是调整 MCP 返回结构、任务简报和状态模型的主要依据。

## 9. 建议目录结构

V0 保持为一个 TypeScript 工程，不建立复杂 monorepo：

```text
src/
  core/
    schemas/
    services/
  db/
    migrations/
    repositories/
  mcp/
    tools/
    stdio.ts
  server/
    routes/
    server.ts
  cli/
    commands/
    index.ts

ui/
  src/
    components/
    pages/
    api/

tests/
  core/
  db/
  mcp/
```

边界约定：

- `core` 不依赖 Fastify、React 或 MCP 传输；
- `db` 实现 `core` 所需的 repository；
- `mcp` 和 `server` 只调用 `core` service；
- `ui` 不直接访问 SQLite。

## 10. 测试重点

V0 优先测试影响事实可信度的行为：

1. 同一 `ready` 任务并发领取时只能有一个成功；
2. 旧 `runId` 不能更新已经释放或重新领取的任务；
3. 每次状态修改与对应事件要么同时成功，要么同时回滚；
4. inbox 任务不会进入 `next`；
5. `next` 严格按照队列位置返回；
6. 自身依赖和循环依赖被拒绝；
7. 依赖完成前任务不可执行，完成后 `runnable` 自动变为 `true`；
8. `start_task` 拒绝仍有未完成依赖的任务；
9. `get_project_status` 能正确聚合当前、下一步、阻塞和最近完成；
10. `create_tasks` 在任一输入无效时不会写入部分基线任务；
11. 已有数据库可以通过前向迁移升级并保留原任务和事件；
12. 审核领取具有并发保护，旧执行或审核凭证不能继续写入；
13. 低风险审核通过可自动完成，中高风险审核通过仍需开发者批准；
14. 完整 MCP 流程可以执行领取、更新、阻塞、恢复、释放、提交审核和审核决策；
15. `--discover` 自动向上寻根支持从子目录启动，未找到项目或非常规文件安全失败关闭；
16. 单份 AGY 全局 MCP 注册在两个不同项目中分别启动独立会话并保持项目状态隔离；
17. 通过环境工作区根或客户端 `roots` 提供的多根工作区跨项目或包含未初始化根目录时明确拒绝并关闭进程；未声明 `roots` 且未提供环境工作区根的客户端按 cwd 单根运行。

页面视觉和复杂交互测试不作为 V0 的首要工作。

## 11. V0 不采用的方案

### 11.1 不使用 Next.js

V0 不需要 SSR、云端部署或 Server Components。Vite 与独立本地服务的边界更直接。

### 11.2 不使用 Electron 或 Tauri

安装包、签名、自动更新和平台兼容不能验证核心产品价值。核心闭环验证成功后，可以使用 Tauri 包装现有 Web UI。

### 11.3 不使用 Redis 或消息队列

SQLite 事务足以处理 V0 的本地并发，不增加额外服务。

### 11.4 不使用 WebSocket

页面轮询足以展示语义级进度，不需要复杂实时连接。

### 11.5 不拆分多语言后端

V0 使用 TypeScript 贯穿 UI、CLI、MCP 和业务核心，避免重复类型、多个构建系统及跨语言调试成本。

## 12. 后续演进边界

V0 验证成功后，可以在现有边界内逐步增加：

- Streamable HTTP MCP；
- Tauri 桌面包装；
- 多项目索引和统一工作台；
- 数据导出、备份和远程同步；
- 请求幂等和任务版本控制；
- WebSocket 或服务端事件推送。

这些扩展不应改变 `TaskService` 作为唯一业务入口、SQLite 事务维护当前状态和历史一致性的基本原则。
