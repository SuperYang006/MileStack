# MileStack V0 产品需求

相关技术方案见 [V0 技术方案](./technical-design.md)。

## 1. 产品概述

MileStack 是一个本地优先的项目进度与任务上下文数据库。

它通过结构化任务、当前进度和历史更新，为开发者与 AI 提供同一份项目事实，使双方都能快速回答：

- 项目当前做到哪里了？
- 现在正在处理什么？
- 哪些事情被阻塞了，需要谁采取行动？
- 接下来最应该做什么？
- 最近完成了什么？

MileStack 不以记录 AI 的命令、工具调用或文件修改为目标，也不以 Agent 管理为中心。它关注的是对推进项目有意义的任务状态和语义进度。

**产品标语：** 纵览项目全局，推进每个里程碑。

## 2. 要解决的问题

在当前 AI 编程流程中，项目进度往往是一个黑盒。

项目可能存在大量 `TODO.md`、`PLAN.md`、`PROGRESS.md`、交接说明和临时任务列表，但这些信息容易出现以下问题：

- 分散在不同文件和 AI 会话中；
- 内容快速过期，却没有被同步更新；
- 多份任务列表互相矛盾；
- 人类需要阅读大量文本才能判断项目状态；
- 新的 AI 会话必须重新搜索和理解全部上下文；
- 已完成、正在进行和接下来要做的事情没有明确边界。

MileStack 将不断变化的任务与进度信息从零散文档中抽离，保存到本地数据库，成为人类和 AI 共同读取、共同维护的项目进度事实源。

MileStack 替代的是动态任务和进度文档，而不是架构设计、技术决策、接口说明等长期有效的项目文档。

## 3. V0 验证目标

V0 只验证一个核心假设：

> 当项目任务和语义进度被持续记录在结构化数据库中时，开发者与新的 AI 会话能否无需阅读零散任务文档，就快速理解项目现状并继续下一项工作？

V0 需要跑通以下闭环：

```text
开发者创建并排列任务
  -> 复制任务简报给 AI
  -> AI 查询项目状态和任务详情
  -> AI 主动领取任务
  -> AI 上报阶段进度、阻塞或新发现的任务
  -> AI 完成或释放任务
  -> 开发者在页面看到最新项目状态和下一任务
```

## 4. 产品原则

### 4.1 数据库是进度事实源

动态任务、当前步骤、下一步、阻塞和完成状态以 MileStack 数据库为准，不再通过项目中的多份任务文档分别维护。

### 4.2 项目优先，而非 Agent 优先

任务及项目进展是核心。Agent 只是某一次任务执行的参与者，V0 不维护稳定的 Agent 身份、能力画像或表现统计。

### 4.3 记录语义进度，而非底层行为

只记录对开发者和后续 AI 有意义的阶段成果、当前步骤、下一步和阻塞。不记录每次命令、工具调用、文件修改或思考过程。

### 4.4 下一任务由顺序和依赖共同确定

V0 不使用 AI 自动规划或复杂优先级算法。开发者通过调整待办顺序表达执行偏好，通过任务依赖表达必须先完成的工作。系统根据未完成依赖动态计算任务是否可以执行以及当前可以并行推进的任务。

### 4.5 本地优先

项目、任务和进度信息保存在本地。V0 不依赖云端账号、团队服务或远程数据库。

### 4.6 当前状态与历史分离

`Task` 保存权威的当前状态，供人类和 AI 快速查询；`TaskEvent` 保存不可变的语义更新历史，用于追溯和交接。V0 不实现完整事件溯源。

## 5. 核心使用场景

### 5.1 开发者掌握项目状态

开发者打开 MileStack 后，可以立即看到：

- 当前正在进行的任务；
- 按顺序排列的下一批任务；
- 被阻塞的任务及需要采取的行动；
- AI 或开发者新记录、尚未整理的任务；
- 最近完成的任务。

### 5.2 新 AI 会话继续项目

新的 AI 会话首先调用 `get_project_status`，即可获得当前工作、下一任务、阻塞和最近完成情况，而不需要搜索多份任务进度文档。

AI 选定任务后读取任务详情和历史，再主动领取任务。

### 5.3 AI 上报执行进度

AI 在开始任务、完成重要阶段、遇到阻塞、释放任务和完成任务时，通过 MCP 写入语义级更新。

### 5.4 AI 记录新发现的工作

AI 在执行中发现缺陷、技术债或后续工作时，将其记录为 `inbox` 任务。此类任务不会自动成为下一任务，需由开发者确认并排入正式待办队列。

### 5.5 任务交接

AI 无法继续时释放任务，并写明已完成工作、未完成部分和建议的下一步。后续 AI 可通过任务详情和历史继续执行。

### 5.6 旧项目接入与自举

开发者可以在不修改现有业务代码和构建方式的前提下，将 MileStack 接入一个旧项目。接入后，由开发者和 AI 共同建立一次项目进度基线：识别仍然有效的任务、当前工作和阻塞，将其记录到 MileStack，并逐步停止维护重复的动态任务文档。

MileStack 自身在最小内核可用后，也使用同一套接入流程管理后续开发，以真实使用反馈持续优化产品。

## 6. V0 功能范围

### 6.1 项目状态查询

MileStack 必须提供一个统一的项目状态查询，同时服务页面和 AI：

```ts
type ProjectStatus = {
  project: {
    id: string
    name: string
    goal?: string
  }

  current: TaskSummary[]
  next: TaskSummary[]
  blocked: TaskSummary[]
  inReview: TaskSummary[]
  inbox: TaskSummary[]
  recentlyCompleted: TaskSummary[]
}

type TaskSummary = {
  id: string
  title: string
  status: "inbox" | "ready" | "running" | "blocked" | "in_review" | "completed"
  queuePosition?: number
  dependencyIds: string[]
  waitingFor: Array<{
    id: string
    title: string
    status: "inbox" | "ready" | "running" | "blocked" | "completed"
  }>
  runnable: boolean
  currentStep?: string
  nextStep?: string
  blocker?: string
  requiredAction?: string
  updatedAt: string
}
```

其中：

- `current`：正在执行的任务；
- `next`：按队列顺序排列的正式待办，同时标明是否可立即领取及尚未完成的依赖；
- `blocked`：当前无法推进的任务；
- `inReview`：Agent 已提交实现、等待开发者审核的任务；
- `inbox`：尚未整理的新任务；
- `recentlyCompleted`：最近完成的任务。

### 6.2 任务管理

开发者可以：

- 创建和编辑任务；
- 将 `inbox` 任务确认为正式待办；
- 审核 `in_review` 任务，批准完成或填写反馈退回返工；
- 将已完成任务填写原因重新打开为 `ready` 任务；
- 拒绝或删除无效的 `inbox` 任务；
- 调整 `ready` 任务的执行顺序；
- 复制任务简报；
- 查看任务当前状态和语义更新时间线；
- 在必要时释放正在执行或阻塞的任务。

### 6.3 AI 执行闭环

AI 可以通过 MCP：

- 获取项目状态；
- 获取任务目标、验收条件和历史；
- 创建 `inbox` 任务；
- 主动领取 `ready` 任务；
- 上报阶段进度；
- 报告阻塞及所需行动；
- 释放任务并留下交接信息；
- 提交任务审核并提供完成摘要；完成归档由开发者审核批准。

### 6.4 有序待办与任务依赖

`ready` 任务包含明确的队列位置。项目状态中的 `next` 按该位置排序。

任务可以声明零个或多个前置依赖。只有状态为 `ready`、风险已由开发者确认且所有依赖任务均为 `completed` 时，任务的 `runnable` 才为 `true`，并允许被 `start_task` 领取。

当多个任务同时满足 `runnable = true` 时，界面和 MCP 可以将它们标记为当前可并行推进。V0 不保存容易过期的 `parallelizable` 布尔字段；可并行性根据任务状态和依赖动态计算。

“可并行”仅表示已声明的依赖允许同时开始，不保证文件修改或共享资源没有冲突，实际分工由开发者决定。

等待依赖的待办仍保持 `ready`，并在 `next` 中返回 `runnable = false` 和等待原因；不自动转为执行期间的 `blocked`。选择下一任务时，取队列中第一个 `runnable = true` 的任务。

服务端必须拒绝不存在的依赖、跨项目依赖、自身依赖和循环依赖。删除被其他任务依赖的任务时，应拒绝删除并列出引用它的任务，由开发者先调整依赖。V0 不提供依赖关系图、自动优先级或自动调度，开发者仍然决定待办顺序和实际分配。

### 6.5 任务简报

开发者可以为一个 `ready` 任务生成并复制简报。简报至少包含：

- 项目名称和目标；
- `taskId`；
- 任务标题和目标；
- 验收条件；
- 前置依赖及尚未完成的依赖；
- 已有进展和最近交接信息；
- 明确区分任务发现和已知任务流程：没有已知 `taskId` 时先调用 `get_project_status` 选择任务，已知 `taskId` 时直接调用 `get_task`；
- 领取、更新、阻塞、释放和完成任务时应调用的 MCP 工具。

简报不预先绑定 Agent 身份。AI 调用 `start_task` 成功后获得本次执行的 `runId`。

### 6.6 旧项目初始化

V0 必须提供一个低成本的旧项目接入入口。初始化操作应：

- 在项目中创建本地 MileStack 数据库；
- 创建初始项目记录；
- 输出可加入 AI 客户端的 MCP 配置；
- 输出可加入 `AGENTS.md` 或其他 AI 指令文件的接入规则；
- 不覆盖现有项目文件或 Agent 指令；
- 支持将多条已有任务一次性记录到 `inbox`，用于建立项目基线。

旧项目基线由开发者确认。AI 可以帮助阅读已有任务文档和代码状态、筛选仍然有效的工作并批量记录，但 V0 不自动解析、删除或改写原有文档。

当 MileStack 已实现数据库、核心状态机、基础 MCP 工具和 CLI 状态查询后，应在 MileStack 项目自身完成初始化，并使用 MileStack 管理后续 V0 开发。

## 7. 状态模型

V0 保留六种任务状态：

| 状态 | 含义 |
| --- | --- |
| `inbox` | 新记录但尚未整理，不属于正式执行队列 |
| `ready` | 已确认并排入待办队列；依赖完成后可以领取 |
| `running` | 已被某次 AI 执行领取并正在推进 |
| `blocked` | 当前因输入、依赖或外部条件无法继续 |
| `in_review` | AI 已提交固定制品，正在等待 AI 审核或开发者最终批准 |
| `completed` | 已完成并满足任务验收条件 |

主要状态流转：

```text
开发者创建正式任务：ready
开发者或 AI 快速记录：inbox -> ready
领取任务：ready -> running
执行阻塞：running -> blocked -> running
释放任务：running/blocked -> ready
提交审核：running -> in_review
审核退回：in_review -> ready
低风险 AI 审核通过：in_review -> completed
中高风险 AI 审核通过：in_review -> in_review
开发者最终批准：in_review -> completed
```

`blocked` 默认保留当前执行权。AI 可以在阻塞解除后继续，也可以通过 `release_task` 释放给其他执行者。

## 8. 核心数据模型

### 8.1 Project

V0 每个实例只需支持一个本地项目，但数据保留 `projectId`，便于未来扩展。

```ts
type Project = {
  id: string
  name: string
  rootPath?: string
  goal?: string
  createdAt: string
  updatedAt: string
}
```

### 8.2 Task

```ts
type Task = {
  id: string
  projectId: string

  title: string
  objective?: string
  acceptanceCriteria?: string[]

  status: "inbox" | "ready" | "running" | "blocked" | "in_review" | "completed"
  queuePosition?: number
  dependencyIds: string[]

  currentStep?: string
  nextStep?: string
  blocker?: string
  requiredAction?: string
  handoffNote?: string

  sourceTaskId?: string
  activeRunId?: string
  activeReviewRunId?: string
  riskLevel: "low" | "medium" | "high"
  riskConfirmed: boolean
  riskConfirmedBy?: string
  riskConfirmedAt?: string
  createdBy: "developer" | "agent"

  createdAt: string
  updatedAt: string
  completedAt?: string
}
```

约束：

- 只有 `ready` 任务参与待办排序；
- 任务依赖保存为独立关系，`dependencyIds` 是领域层和 API 中的逻辑表示；
- `runnable` 和 `waitingFor` 是查询时计算的结果，不持久化到任务表；
- 无依赖时 `dependencyIds` 返回空数组；创建输入可以省略该字段；
- 任务不能依赖自身，也不能形成循环依赖；
- `running` 和 `blocked` 任务可以拥有 `activeRunId`；
- `in_review` 和 `completed` 任务必须清除 `activeRunId`；只有 `completed` 任务记录 `completedAt`；
- AI 创建的后续任务默认进入 `inbox`。

### 8.3 TaskEvent

```ts
type TaskEvent = {
  id: string
  projectId: string
  taskId: string
  runId?: string

  type:
    | "created"
    | "confirmed"
    | "started"
    | "progress"
    | "blocked"
    | "resumed"
    | "released"
    | "submitted_for_review"
    | "review_started"
    | "review_passed"
    | "approved"
    | "changes_requested"
    | "reopened"
    | "completed"

  summary: string
  completedWork?: string[]
  currentStep?: string
  nextStep?: string
  blocker?: string
  requiredAction?: string
  handoffNote?: string
  actorLabel?: string

  createdAt: string
}
```

`TaskEvent` 只追加、不覆盖。修改 `Task` 当前状态和追加对应事件必须在同一个数据库事务中完成。

### 8.4 TaskReview

每次 `submit_for_review` 创建一条不可覆盖的审核记录，固定本轮制品和审核结论：

```ts
type TaskReview = {
  id: string
  taskId: string
  reviewRound: number
  commitSha: string       // 完整 40 位 commit SHA
  branch?: string
  worktree?: string
  reviewRunId?: string
  status: "pending" | "in_progress" | "passed" | "changes_requested"
  reviewerActorLabel?: string
  summary?: string
  findings: Array<{
    issue: string
    suggestion: string
    severity: "low" | "medium" | "high"
  }>
  verificationEvidence: Array<{
    command: string
    result: string
  }>
  createdAt: string
  startedAt?: string
  concludedAt?: string
  updatedAt: string
}
```

## 9. 执行身份与并发规则

V0 不建立稳定的 Agent 身份系统。

`start_task` 成功时生成一个 `runId`，代表某一次任务领取和执行。后续执行类写操作必须携带该 `runId`。

```text
start_task -> 生成 runId -> update/block/release/submit_for_review 携带 runId -> in_review
  -> start_review -> 生成独立 reviewRunId -> complete_review
  -> low 自动完成 / medium、high 等待 developer approve
```

服务端必须保证：

- `start_task` 以原子操作领取任务；
- `start_task` 拒绝存在未完成依赖的任务；
- 任务风险必须先由开发者确认；AI 不能通过任务输入自行确认或降低风险等级；
- 同一个 `ready` 任务只能被一个调用成功领取；
- 写操作的 `runId` 必须等于任务的 `activeRunId`；
- 任务释放或提交审核后，旧 `runId` 立即失效；退回返工或重新打开后必须重新 `start_task`；
- `start_review` 使用独立的 `reviewRunId` 原子领取审核；审核结束或退回后立即失效；
- 新一轮提交创建新的审核记录并使旧审核结论不再决定当前任务；
- 如果前向迁移发现旧数据库中的 `in_review` 任务没有 `TaskReview`，不得伪造 commit SHA；任务应带着恢复说明返回 `ready`，由 AI 使用新 `runId` 重新提交真实制品；
- 旧执行者的迟到更新不能修改任务。

风险策略：

| 风险 | 默认行为 | AI 审核通过后 |
| --- | --- | --- |
| `low` | 必须由开发者确认风险，且审核必须提供验证命令与结果 | 自动进入 `completed` |
| `medium` | 默认等级，必须由开发者确认 | 标记 `review_passed`，保持 `in_review`，等待开发者批准 |
| `high` | 必须由开发者明确确认 | 标记 `review_passed`，保持 `in_review`，等待开发者批准 |

Agent 名称、提供方或会话信息不是必需身份，只能作为可选的 `actorLabel` 用于页面展示。

V0 暂不实现请求幂等键和通用乐观锁；出现实际重复写入或复杂并发需求后再扩展。

## 10. MCP 工具

### 10.1 查询

- `get_project_status`：一次获取当前工作、下一任务、阻塞、收件箱和最近完成情况；
- `get_task`：获取一个任务的完整定义、当前状态和语义更新时间线。

### 10.2 任务记录与确认

- `create_task`：记录一个新任务；Agent 创建时默认进入 `inbox`；
- `create_tasks`：在一个请求中批量创建 `inbox` 任务，用于旧项目基线和集中记录新工作；
- `confirm_task`：将 `inbox` 任务确认为 `ready`，主要供开发者界面使用。

### 10.3 执行

- `start_task`：检查前置依赖后，原子领取一个可执行的 `ready` 任务，设为 `running` 并返回 `runId`；
- `update_task`：上报有意义的阶段进度；
- `block_task`：报告阻塞原因和所需行动；
- `resume_task`：阻塞解除后，使用当前 `runId` 恢复执行；
- `release_task`：释放任务、写入交接说明并返回 `ready`；
- `submit_for_review`：提交完成摘要和固定 commit 制品并将任务设为 `in_review`；低风险任务在 AI 审核通过且验证证据完整时自动完成，中高风险任务仍等待开发者批准。
- `start_review`：原子领取最新审核记录并返回独立 `reviewRunId`；
- `complete_review`：提交审核摘要、结构化 findings 和验证证据，按风险策略自动完成或等待开发者批准。

所有更新优先表达：

- 已完成的阶段成果；
- 当前正在进行的事项；
- 下一步；
- 阻塞原因；
- 需要开发者执行的行动。

## 11. AI 接入约定

MileStack 应提供一段可加入项目 `AGENTS.md` 或其他 AI 指令文件的接入说明：

```md
- MileStack 是本项目任务和进度的事实源。不要新建或维护独立的 TODO、进度、计划或交接任务文档。
- 没有已知 `taskId` 时调用 `get_project_status`，确认项目当前状态和下一任务；已有 `taskId` 时直接调用 `get_task`，不必先加载完整项目状态。
- 处理具体任务前调用 `get_task`，读取目标、验收条件和历史进度。
- 按 next 的队列顺序选择 runnable 为 true 的任务；等待依赖的任务暂不领取。
- 领取任务时调用 start_task，并保存返回的 runId。
- 完成一个对项目有意义的阶段后调用 update_task。
- 不要上报每次工具调用、命令执行或文件修改。
- 因输入、依赖或外部条件无法继续时调用 block_task。
- 阻塞解除且继续原任务时调用 resume_task。
- 执行中发现的新工作通过 create_task 记录到 inbox，不要写入新的任务文档。
- 无法继续或需要其他 AI 接手时调用 release_task，并写明交接信息。
- 只有在验收条件满足且验证完成后调用 `submit_for_review`；提交后按风险策略等待 AI 审核或开发者最终批准。
- 审核时先调用 `start_review` 保存 `reviewRunId`；提交 `complete_review` 时必须携带该凭证和验证命令结果。
- 不得自行修改或降低任务风险等级；发现问题时使用结构化 finding 记录问题和修改建议。
```

## 12. V0 页面

V0 只需要一个项目状态页面，按照行动意义展示：

1. **正在进行**：任务标题、当前步骤、下一步和最后更新时间；
2. **下一任务**：按队列顺序展示 `ready` 任务，并支持调整顺序；
3. **需要处理**：展示被阻塞的任务及所需行动；
4. **待审核**：展示 `in_review` 任务，支持批准或填写反馈退回返工；
5. **待整理**：展示 `inbox` 任务，支持确认、编辑或删除；
6. **最近完成**：展示已批准完成的任务，并支持填写原因重新打开。

页面还应支持：

- 创建和编辑任务；
- 展示任务依赖、等待原因以及“可执行/可并行”提示；
- 复制任务简报；
- 展开任务详情和语义更新时间线；
- 必要时手动释放任务。

V0 可以使用简单轮询更新页面，不要求实时推送。

## 13. 本地存储要求

- 使用一个本地 SQLite 数据库；
- `Task` 是当前状态的权威记录；
- `TaskEvent` 是不可变的语义历史；
- 当前状态修改和事件追加必须在同一事务中完成；
- 数据应能随项目在本地持续保存，不依赖 AI 会话生命周期；
- Schema 变更必须通过前向数据库迁移升级现有数据，不能要求开发者删除数据库重建；
- V0 不要求导入和解析已有任务文档。

## 14. V0 明确不做

- 多项目工作台；
- 稳定的 Agent 注册和身份管理；
- Agent 能力画像和表现统计；
- 自动任务拆解、规划和优先级计算；
- 自动选择、启动或调度 Agent；
- 专门的次日恢复视图；
- 可视化任务依赖图和里程碑视图；
- Git diff、commit、worktree、Shell 命令和文件修改追踪；
- Token、模型成本和调用耗时分析；
- 云端账号、团队权限和远程同步；
- AI 自动验收；
- 完整事件溯源；
- 复杂实时通信；
- 自动迁移现有任务文档。

## 15. 验证标准

V0 满足以下条件，即可认为核心假设得到初步验证：

1. 开发者打开页面后，能在 10 秒内说出项目当前做到哪里、有什么阻塞以及接下来做什么；
2. 一个没有历史会话上下文的 AI，只调用一次 `get_project_status`，即可正确描述项目现状和下一任务；
3. AI 可以完成“领取 -> 更新 -> 阻塞或完成”的完整上报闭环；
4. AI 发现的新工作会进入 `inbox`，不会自动打乱正式执行队列；
5. 任务被释放后，另一个 AI 可以仅依靠任务详情和事件历史继续执行；
6. 开发者可以直接看出哪些待办已可执行、哪些仍在等待依赖，以及哪些任务当前可以并行推进；
7. 一个旧项目可以在不修改业务代码的情况下完成初始化，并批量建立首份任务基线；
8. MileStack 可以使用自身的数据库和 MCP 工具管理后续 V0 开发；
9. 项目不再需要使用多份动态任务和进度文档维持当前状态。

## 16. 验证后的扩展方向

只有在 V0 的核心闭环得到验证后，再根据真实使用问题考虑：

- 多项目工作台；
- 请求幂等和更完整的并发控制；
- 复杂依赖图、优先级和里程碑；
- 更丰富的项目状态摘要；
- Agent 身份、权限和运行记录；
- 自动任务建议与调度；
- Git、CI 和 Issue 系统集成；
- 团队协作与远程同步。
