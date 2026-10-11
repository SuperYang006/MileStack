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

每个 AI 客户端通过 stdio 启动独立的 MCP 进程：

```bash
milestack mcp --project /absolute/path/to/project
```

MCP 进程直接使用共享业务核心访问该项目的 SQLite 数据库，因此页面未运行时，AI 仍然可以工作。

V0 先支持 stdio，以覆盖常见的本地 AI 编程客户端。后续可以复用相同的 MCP 工具处理器增加 Streamable HTTP 传输。

### 3.3 CLI 状态查询

在完整页面完成前，开发者可以通过 CLI 检查项目状态：

```bash
milestack status --project /absolute/path/to/project
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
milestack init
```

`init` 负责：

- 创建 `.milestack/`；
- 初始化 SQLite Schema；
- 创建项目记录；
- 确保 `.milestack/` 被项目的 `.gitignore` 忽略。
- 输出该项目可直接使用的 MCP 客户端配置；
- 输出带 `MILESTACK_START` 和 `MILESTACK_END` 标记的 AI 接入规则。

`init` 必须可以安全重复执行，不覆盖已有数据库、项目文件或标记区块外的 Agent 指令。V0 可以先将配置和规则输出到终端，由开发者确认后复制；不要求自动修改各类 AI 客户端的全局配置。

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

- `Task` 是任务当前状态的权威记录；
- `TaskEvent` 是只追加的语义历史；
- 修改任务和追加事件必须处于同一个 SQLite 事务；
- V0 不通过重放事件重建任务状态。

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
- 原子领取任务；
- 校验 `runId`；
- 更新任务当前快照；
- 追加 `TaskEvent`；
- 生成项目状态和任务简报；
- 批量创建用于旧项目基线的 inbox 任务。

Zod Schema 应在 HTTP、MCP 和业务核心之间复用，避免为同一操作维护多套输入定义。

## 6. 任务领取与并发

### 6.1 原子领取

`start_task` 在事务中生成 `runId`，并通过条件更新领取任务：

```sql
UPDATE tasks
SET status = 'running',
    active_run_id = ?,
    updated_at = ?
WHERE id = ?
  AND status = 'ready';
```

只有受影响行数为 `1` 时领取成功。若为 `0`，表示任务不存在、状态不允许领取或已经被其他 AI 领取。

领取成功后，在同一事务中追加 `started` 事件。

### 6.2 执行权校验

`update_task`、`block_task`、`resume_task`、`release_task` 和 `finish_task` 必须携带 `runId`。

服务端必须验证：

```text
input.runId == task.activeRunId
```

任务被释放或完成后清除 `activeRunId`。旧 MCP 进程随后发出的更新必须被拒绝。

### 6.3 V0 并发边界

V0 不实现通用乐观锁和请求幂等键。所有写事务应保持短小，不在事务中执行文件、网络或 AI 操作。如果真实验证中出现重复请求或更复杂的并发编辑，再增加 `requestId` 和版本字段。

## 7. 页面实现

React V0 页面只包含一个项目状态视图：

- 正在进行；
- 下一任务；
- 需要处理的阻塞；
- 待整理的 inbox；
- 最近完成。

页面通过普通 HTTP API 完成：

- 创建和编辑任务；
- 确认或删除 inbox 任务；
- 调整 ready 队列顺序；
- 复制任务简报；
- 查看任务详情和事件历史；
- 手动释放任务。

V0 可以用上移、下移操作调整队列顺序，不要求一开始实现拖拽。

## 8. 旧项目接入与 MileStack 自举

### 8.1 旧项目接入流程

旧项目采用零侵入接入，不要求修改业务代码或现有构建方式：

```text
milestack init --project <project-root>
  -> 创建本地数据库
  -> 输出 MCP 配置和 AI 接入规则
  -> AI 读取已有任务资料与代码状态
  -> create_tasks 批量写入 inbox
  -> 开发者确认、编辑并排列 ready 队列
```

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
5. `get_project_status`、`create_task(s)`、`start_task`、`update_task` 和 `finish_task`；
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
6. `get_project_status` 能正确聚合当前、下一步、阻塞和最近完成；
7. `create_tasks` 在任一输入无效时不会写入部分基线任务；
8. 已有数据库可以通过前向迁移升级并保留原任务和事件；
9. 完整 MCP 流程可以执行领取、更新、阻塞、恢复、释放和完成。

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
