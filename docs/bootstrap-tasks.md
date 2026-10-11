# MileStack 自举开发任务（自举已完成）

> **状态**：自举阶段已顺利完成。MileStack 已开始管理自身项目进度，后续任务、状态流转与事实记录只在 MileStack 数据库与 MCP/CLI 中维护，本文仅作为实现历史保留。

## 1. 文档用途

当本文定义的自举验收完成后，必须将剩余开发任务迁入 MileStack 数据库，并停止在本文继续维护项目进度。产品需求以 [V0 产品需求](./requirements.md) 为准，技术边界以 [V0 技术方案](./technical-design.md) 为准；本文不重复定义产品范围。

## 2. 自举完成标准

满足以下条件后，MileStack 即可开始管理自身：

- 可以在现有项目中安全执行 `milestack init`；
- 可以通过 `milestack status` 查看当前、下一步、阻塞和 inbox；
- MCP 客户端可以调用 `get_project_status` 和 `get_task`；
- MCP 客户端可以批量记录 inbox 任务；
- AI 可以完成领取、更新和完成任务的闭环；
- SQLite 数据在进程重启后保留；
- Schema 迁移不会要求删除数据库；
- MileStack 仓库已经创建自己的 `.milestack/milestack.db`，剩余 V0 工作已录入其中。

## 3. 实施约定

每个 Agent 开始任务前应：

1. 阅读本任务及其依赖任务；
2. 阅读需求和技术方案中与本任务相关的章节；
3. 检查工作区现状，不覆盖其他 Agent 的未提交修改；
4. 只实现任务范围内的功能，不提前扩展 UI、HTTP API 或非 V0 能力；
5. 完成后运行本任务要求的测试，并留下结果和未解决问题。

共享约束：

- 使用 TypeScript、Node.js LTS 和 pnpm；
- HTTP、MCP 和 CLI 不得各自实现业务规则；
- 任务状态流转只能位于共享 `TaskService`；
- 数据修改与 `TaskEvent` 追加必须处于同一事务；
- 项目数据默认位于 `<project-root>/.milestack/milestack.db`；
- V0 不引入桌面包装、WebSocket、云服务、Agent 身份系统或自动调度。

## 4. 任务总览

| ID | 任务 | 依赖 | 可并行性 | 完成产物 |
| --- | --- | --- | --- | --- |
| `BOOT-001` | 初始化 TypeScript 工程骨架 | 无 | 首个任务 | 可构建、可测试的工程 |
| `BOOT-002` | 建立 SQLite Schema、迁移与连接层 | `BOOT-001` | 独立 | 可持久化的数据库基础 |
| `BOOT-003` | 实现任务核心模型与查询服务 | `BOOT-002` | 独立 | `TaskService` 查询和创建能力 |
| `BOOT-003A` | 增加任务依赖与可执行性计算 | `BOOT-003` | 紧接 003 | 依赖关系、等待原因和并行判断 |
| `BOOT-004` | 实现 `init` 与 `status` CLI | `BOOT-003A` | 可与 `BOOT-005` 并行 | 旧项目初始化和终端状态查看 |
| `BOOT-005` | 实现 MCP 查询与任务记录工具 | `BOOT-003A` | 可与 `BOOT-004` 并行 | AI 可读项目状态并写入 inbox |
| `BOOT-006` | 实现任务执行生命周期 | `BOOT-003A`、`BOOT-005` | 独立 | 领取、更新、完成闭环 |
| `BOOT-007` | 集成验证并让 MileStack 自举 | `BOOT-004`、`BOOT-006` | 最后执行 | MileStack 开始管理自身 |

`BOOT-004` 与 `BOOT-005` 可以并行，但必须通过 `TaskService` 调用核心逻辑。它们不得直接访问或修改任务表。共同修改的 CLI 入口、依赖配置和锁文件须协调合并；任务依赖允许并行不等于不会产生文件冲突。

## 5. 详细任务

### BOOT-001：初始化 TypeScript 工程骨架

**目标**

建立后续 Agent 可以稳定协作的最小 TypeScript 工程、目录边界和测试入口。

**实现范围**

- 创建根 `package.json`、`pnpm-lock.yaml` 和 TypeScript 配置；
- 配置 Node.js LTS、ESM、严格 TypeScript 检查；
- 配置 `tsup` 构建 CLI；
- 配置 Vitest；
- 创建技术方案约定的基础目录：`src/core`、`src/db`、`src/mcp`、`src/cli` 和 `tests`；
- 创建最小 CLI 入口，使 `--help` 可以运行；
- 添加 `build`、`typecheck` 和 `test` 脚本；
- 添加只覆盖构建链路的最小测试。

**不包含**

- React UI；
- Fastify HTTP 服务；
- SQLite Schema；
- 任何任务业务逻辑。

**验收条件**

- `pnpm install` 成功；
- `pnpm typecheck` 成功；
- `pnpm test` 成功；
- `pnpm build` 生成可由 Node.js 执行的 CLI；
- CLI 执行 `--help` 时退出码为 `0`；
- 目录和模块边界与技术方案一致。

**交付说明**

完成后记录所选 Node.js 最低版本、关键依赖的实际版本以及所有验证命令结果。

---

### BOOT-002：建立 SQLite Schema、迁移与连接层

**目标**

实现不依赖系统 SQLite 安装的本地持久化基础，并从第一版开始支持真实数据的前向迁移。

**依赖**

- `BOOT-001`

**实现范围**

- 引入 `better-sqlite3`、Drizzle ORM 和迁移工具；
- 建立 `projects`、`tasks`、`task_events` 表；
- 将需求文档中的 `Project`、`Task` 和 `TaskEvent` 字段落实为 Schema；
- 为状态、队列位置、更新时间及任务事件查询增加必要索引；
- 实现数据库路径解析：`<project-root>/.milestack/milestack.db`；
- 实现统一 `openDatabase()`，设置 WAL、`busy_timeout` 和外键；
- 实现 `ensureDatabase()`，自动执行未应用的迁移；
- 在非空数据库执行待应用迁移前创建时间戳备份；
- 迁移或备份失败时返回明确错误，不留下半迁移状态；
- 定义 repository 接口，但不在本任务实现完整业务服务。

**关键约束**

- 不得依赖操作系统安装的 `sqlite3` CLI；
- 已应用迁移不可修改；
- 时间字段统一存储为 UTC ISO 8601 字符串；
- JSON 数组字段的存储方式需要集中封装，不能散落在调用方；
- `.milestack/` 的创建应允许重复执行。

**验收条件**

- 在临时项目目录中可以创建数据库和三张核心表；
- 重新执行 `ensureDatabase()` 不会破坏已有数据；
- 测试数据库确实启用外键和 WAL；
- 插入非法外键会失败；
- 添加一条测试迁移后，已有任务和事件仍然存在；
- 迁移前备份成功生成；
- `pnpm typecheck` 和数据库测试通过。

**交付说明**

完成后说明数据库文件位置、迁移命令、备份触发条件和测试覆盖范围。

---

### BOOT-003：实现任务核心模型与查询服务

范围说明：本任务继续按原定范围完成。最新需求中的依赖关系及派生可执行性由后续 `BOOT-003A` 负责，不要求当前执行者提前实现。

**目标**

实现 MileStack 的唯一业务入口，使 CLI、MCP 和未来 HTTP API 共享同一套任务规则。

**依赖**

- `BOOT-002`

**实现范围**

- 使用 Zod 定义核心输入和输出 Schema；
- 实现 repository 的任务、项目和事件基础操作；
- 实现 `TaskService.createTask()`；
- 实现 `TaskService.createTasks()`，整个批次使用一个事务；
- 实现 `TaskService.getTask()`；
- 实现 `TaskService.getProjectStatus()`；
- AI 创建的任务默认进入 `inbox`；
- 支持开发者创建 `ready` 任务并设置队列位置；
- `getProjectStatus()` 返回 `current`、`next`、`blocked`、`inbox` 和 `recentlyCompleted`；
- `next` 严格按照队列位置排序；
- 创建任务时同步写入 `created` 事件；
- 定义领域错误，使 CLI 和 MCP 可以稳定映射错误，而不是解析错误文本。

**不包含**

- 任务依赖与可执行性计算；
- 任务领取和 `runId`；
- 阻塞、释放或完成；
- MCP 协议层；
- CLI 命令实现。

**验收条件**

- 创建任务与 `created` 事件要么同时成功，要么同时回滚；
- `createTasks()` 中任一输入无效时不会写入部分任务；
- inbox 任务不会出现在 `next`；
- ready 任务按队列位置稳定排序；
- 不同状态被正确聚合到项目状态结果；
- 最近完成列表有明确、经过测试的数量或时间边界；
- 单元测试和数据库集成测试通过。

**交付说明**

完成后提供 `TaskService` 公共方法清单、错误类型和项目状态返回示例。

---

### BOOT-003A：增加任务依赖与可执行性计算

**目标**

在不改变 `BOOT-003` 原定交付范围的前提下，通过前向迁移增加任务依赖，并让开发者和 AI 直接看出哪些任务可以立即执行、并行推进或仍在等待前置任务。

**依赖**

- `BOOT-003`

**实现范围**

- 新增 `task_dependencies` 表，使用 `(task_id, depends_on_task_id)` 复合主键或唯一约束；
- 删除依赖方任务时清理其关系；删除仍被引用的前置任务时使用 `RESTRICT`，不静默解除依赖；
- 通过新的 Drizzle migration 增加关系表，不修改 `BOOT-002` 已经应用的初始迁移；
- 扩展 repository 接口和 SQLite 实现，支持读取和原子替换任务依赖；
- 实现 `TaskService.setTaskDependencies()`，只允许修改 inbox/ready 任务，校验、替换和 progress 历史事件在同一写事务完成；
- 扩展创建任务与批量创建任务输入，接受 `dependencyIds`；
- 创建输入省略 `dependencyIds` 时使用空数组；批量创建只引用请求开始前已存在的同项目任务，不增加批次内临时 ID；
- 创建或修改依赖时拒绝任务依赖自身；
- 创建或修改依赖时检测并拒绝直接或间接循环依赖；
- 扩展任务详情，返回 `dependencyIds`；
- 扩展 `TaskSummary`，返回 `dependencyIds`、`waitingFor` 和 `runnable`；
- `waitingFor` 只包含未完成依赖的 ID、标题和状态；
- `runnable` 仅在任务状态为 `ready` 且全部依赖为 `completed` 时为 `true`；
- `getProjectStatus()` 保持 `next` 的人工队列顺序，同时返回每项任务的动态可执行性；
- 当多个 ready 任务的 `runnable` 同时为 `true` 时，由调用方将其解释为当前可并行任务，不持久化 `parallelizable` 字段。

**不包含**

- 可视化依赖图；
- 自动任务排序或调度；
- 文件冲突分析；
- `exclusive` 独占执行模式；
- `start_task` 的依赖校验，该校验在 `BOOT-006` 与领取事务一起实现。

**验收条件**

- 已有 `BOOT-002/003` 数据库可以通过新迁移升级且原数据保持不变；
- 可以创建无依赖、单依赖和多依赖任务；
- 不存在的依赖任务、跨项目依赖、自身依赖和循环依赖均被拒绝；
- 任一依赖未完成时，任务返回 `runnable = false` 并列出正确的 `waitingFor`；
- 所有依赖完成后，无需修改任务即可返回 `runnable = true`；
- `next` 仍按 `queuePosition` 排序，不因依赖自动重排；
- 等待依赖的任务仍在 ready/next 中，非 ready 任务即使依赖完成也返回 `runnable = false`；
- 并发依赖修改不能绕过环检测，校验失败不改变原关系和事件；
- `createTasks()` 中的批量任务依赖失败时，整个批次回滚；
- 不增加散落在源码目录中的测试，相关测试集中放入 `tests/core` 和 `tests/db`；
- `pnpm typecheck`、相关测试和 `pnpm build` 通过。

**交付说明**

完成后提供迁移文件、依赖环检测策略、扩展后的查询示例，以及对 `BOOT-006` 的领取校验要求。

---

### BOOT-004：实现 `init` 与 `status` CLI

**目标**

让旧项目无需 Web 页面即可初始化 MileStack，并让开发者在自举阶段从终端查看项目状态。

**依赖**

- `BOOT-003A`

**实现范围**

- 实现 `milestack init --project <path>`；
- 未传 `--project` 时使用当前工作目录；
- 校验项目路径存在且为目录，并解析为绝对路径；
- 调用 `ensureDatabase()` 创建或升级数据库；
- 创建初始项目记录，并允许重复执行；
- 安全地将 `.milestack/` 加入 `.gitignore`，不重复添加、不覆盖原内容；
- 输出该项目的 MCP stdio 配置示例；
- 输出带 `MILESTACK_START`/`MILESTACK_END` 标记的 AI 接入规则；
- 实现 `milestack status --project <path>`；
- `status` 通过 `TaskService.getProjectStatus()` 输出人类可读摘要。
- 摘要区分可执行和等待依赖的待办，多个可执行任务时提示可并行（仅按已声明依赖判断）。

**关键约束**

- V0 不自动修改 AI 客户端的全局配置；
- V0 不自动覆盖 `AGENTS.md`；
- 如果输出建议写入已有文件，必须由开发者确认和复制；
- 重复执行 `init` 不得产生重复项目记录或重复 `.gitignore` 行。

**验收条件**

- 可以在一个已有 Git 项目和一个非 Git 目录中初始化；
- 初始化不会修改任何业务源码；
- 重复初始化结果稳定；
- `status` 能展示当前、下一任务、阻塞、inbox 和最近完成；
- 等待依赖的待办显示未完成依赖，不能被展示为可立即领取；
- 空项目状态有清晰提示而非异常；
- 路径或数据库错误具有可执行的错误信息；
- CLI 集成测试通过。

**交付说明**

完成后附上初始化前后文件变化、CLI 示例输出和测试命令结果。

---

### BOOT-005：实现 MCP 查询与任务记录工具

**目标**

让 AI 客户端无需页面即可读取项目事实并将新工作记录到 inbox。

**依赖**

- `BOOT-003A`

**实现范围**

- 使用 TypeScript MCP SDK 实现 stdio 服务器；
- 实现 `milestack mcp --project <path>` 入口；
- 注册 `get_project_status`；
- 注册 `get_task`；
- 注册 `create_task`；
- 注册 `create_tasks`；
- MCP 输入复用核心 Zod Schema；
- 创建工具传递 `dependencyIds`；查询工具保留 `dependencyIds`、`waitingFor` 和 `runnable`，描述中说明只领取可执行任务；
- 所有工具通过 `TaskService` 执行，不直接访问数据库表；
- 为工具提供简洁、明确的描述，告诉 AI 何时调用及关键约束；
- 将领域错误转换为稳定、可理解的 MCP 错误结果；
- stdout 只输出 MCP 协议内容，诊断信息写入 stderr。

**验收条件**

- MCP 客户端可以列出四个工具及其 Schema；
- 可以从空项目读取有效的项目状态；
- `create_task` 创建的 Agent 任务进入 inbox；
- `create_tasks` 可以一次写入多条 inbox 任务；
- `get_task` 返回任务当前状态和事件历史；
- 查询结果能区分可执行任务和等待依赖的任务；
- 无效项目路径、任务 ID 和输入返回清晰错误；
- 使用内存内或临时目录客户端完成 MCP 集成测试；
- stdout 中没有破坏协议的日志。

**交付说明**

完成后提供一个可复制的本地 MCP 配置和真实工具调用结果示例。

---

### BOOT-006：实现任务执行生命周期

**目标**

让 AI 可以安全完成一次“领取任务、上报阶段进度、完成任务”的最小闭环，并为后续阻塞和交接能力保留一致边界。

**依赖**

- `BOOT-003A`
- `BOOT-005`

**实现范围**

- 实现 `TaskService.startTask()`；
- `startTask()` 在领取事务中检查所有前置依赖均为 `completed`，否则返回包含未完成依赖的领域错误；
- `startTask()` 在事务内原子地将 `ready` 改为 `running`、生成 `runId` 并追加 `started` 事件；
- 实现 `TaskService.updateTask()`，更新当前步骤和下一步并追加 `progress` 事件；
- 实现 `TaskService.submitForReview()`，写入完成摘要、清除 `activeRunId`、保持 `completedAt` 为空并追加 `submitted_for_review` 事件；
- 所有执行写操作校验输入 `runId` 等于任务的 `activeRunId`；
- 在 MCP 注册 `start_task`、`update_task` 和 `submit_for_review`；
- 保持领域服务与 MCP 传输分离；
- 为后续 `block_task`、`resume_task` 和 `release_task` 留出一致的服务接口模式，但本任务不要求实现这些工具。

**并发要求**

- 两个调用并发领取同一个 ready 任务时只能有一个成功；
- 存在未完成依赖的 ready 任务不能被领取；
- 任务完成后旧 `runId` 不能继续更新；
- 不在 SQLite 写事务中执行网络、文件扫描或其他长操作。

**验收条件**

- 可以通过 MCP 完成 `get_project_status -> start_task -> update_task -> submit_for_review`，并由开发者审核后归档；
- 同一任务的并发领取测试只有一个成功；
- 依赖未完成时领取失败，依赖完成后无需额外修改即可领取；
- 错误 `runId` 和已经失效的 `runId` 被拒绝；
- 每次当前状态修改和事件追加保持事务一致；
- 完成任务后它从 `current` 移到 `recentlyCompleted`；
- 进程重启后仍可读取完整任务状态和历史；
- 核心单元测试、数据库测试和 MCP 集成测试通过。

**交付说明**

完成后提供完整 MCP 调用序列、并发测试结果及尚未实现的生命周期工具列表。

---

### BOOT-007：集成验证并让 MileStack 自举

**目标**

使用刚实现的 MileStack 管理 MileStack 自己的剩余开发工作，并结束对本文档作为动态任务清单的依赖。

**依赖**

- `BOOT-004`
- `BOOT-006`

**实现范围**

- 在当前仓库构建 CLI；
- 对 `/Users/superyang/Projects/MileStack` 执行 `milestack init`；
- 验证 `.milestack/` 已被 Git 忽略；
- 使用生成的配置连接一个真实 MCP 客户端；
- 将剩余 V0 工作批量写入 inbox；
- 由开发者确认首批 ready 队列顺序；
- 使用真实 AI 完成至少一个任务的领取、更新和完成闭环；
- 验证 `milestack status` 与 MCP `get_project_status` 对同一数据给出一致结果；
- 将自举过程发现的问题记录到 MileStack inbox。

**首批建议导入任务**

- 实现 `block_task`、`resume_task` 和 `release_task`；
- 实现 Fastify HTTP API；
- 实现 React 项目状态页；
- 实现 inbox 确认、编辑和删除；
- 实现 ready 队列调整；
- 实现任务简报生成与复制；
- 补充真实旧项目接入测试。

这些只是导入候选项。执行 `BOOT-007` 时应根据代码现状重新确认、拆分和排序。

**验收条件**

- MileStack 自身数据库可以被 CLI 和 MCP 同时读取；
- 至少一个真实开发任务完成完整执行闭环；
- 剩余 V0 任务已经存在于数据库，而不是只存在于本文；
- 数据库迁移和备份机制使用当前真实数据库验证过；
- 自举发现的问题已进入 inbox；
- 开发者确认 MileStack 数据库开始成为项目进度事实源。

**完成后的文档处理**

不要继续在本文勾选或追加动态进度。将本文顶部标记为“自举已完成”，保留它作为实现历史；所有后续任务、状态、阻塞和交接只在 MileStack 中维护。

## 6. 推荐执行顺序

默认顺序：

```text
BOOT-001
  -> BOOT-002
  -> BOOT-003
  -> BOOT-003A
  -> BOOT-004 与 BOOT-005
  -> BOOT-006
  -> BOOT-007
```

如果多个 Agent 并行工作，只有 `BOOT-004` 和 `BOOT-005` 建议在同一时段并行。`BOOT-003A` 必须等待正在执行的 `BOOT-003` 完成，不应中途扩大 `BOOT-003` 的范围。其他任务处于同一核心依赖链，提前并行会增加 Schema、类型和服务接口反复合并的成本。

## 7. Agent 交付模板

每个 Agent 完成任务时应返回：

```md
## 完成内容
- ...

## 验证结果
- `pnpm typecheck`: ...
- `pnpm test`: ...
- `pnpm build`: ...

## 关键决策
- ...

## 未解决问题
- ...

## 下一任务开始前需要知道
- ...
```

如果任务无法继续，Agent 应停止扩大实现范围，并明确说明阻塞原因、已经完成的部分和建议的下一步。
