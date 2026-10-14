# MileStack 开发指南

[English](development.md) | [简体中文](development.zh-CN.md) | [返回 README](../README.md)

本文面向开发 MileStack 本身的贡献者和维护者。如果你只是希望在另一个项目中安装并使用 MileStack，请从[用户指南](user-guide.zh-CN.md)开始。

## 架构

MileStack 将业务行为集中在一个服务边界之后：

```text
CLI --------\
MCP ---------> TaskService -> repository interface -> SQLite implementation
HTTP -------/                                      \
                                                     -> React UI via HTTP only
```

- `src/core` 负责领域 Schema、错误、仓储接口和任务行为。
- `src/db` 负责 Drizzle Schema、迁移、SQLite 配置和仓储实现。
- `src/cli`、`src/mcp` 和 `src/server` 是传输适配器。
- `ui` 只访问 HTTP API，不导入服务端或数据库模块。
- `tests` 包含核心、数据库、适配器、UI 和真实进程集成测试。

任务快照修改和 `TaskEvent` 追加在同一个数据库事务中完成。CLI、MCP 与 HTTP 输入复用同一套操作 Schema，不在适配器中重复实现状态流转。

完整 V0 架构见[技术方案](technical-design.md)，仓库工作规则见根 [AGENTS.md](../AGENTS.md)。

## 环境要求

- Node.js 22 或更高版本
- pnpm 10
- Git

## 从源码构建

```bash
git clone git@github.com:SuperYang006/MileStack.git
cd MileStack
pnpm install
pnpm build
```

直接从 checkout 运行构建后的 CLI：

```bash
node dist/index.js --help
pnpm serve
```

`pnpm serve` 会把 MileStack checkout 本身作为被管理项目，并在 [http://127.0.0.1:7331](http://127.0.0.1:7331) 提供构建后的 Web UI。

如需用开发版本管理其他项目：

```bash
node dist/index.js serve --project /项目的绝对路径 --port 7331
```

## Web UI 开发

分别启动 API 服务和 Vite：

```bash
# 终端一
pnpm serve

# 终端二
pnpm dev:ui
```

打开 [http://localhost:5173](http://localhost:5173)。Vite 会将 `/api` 代理到 `7331` 端口的服务。

- 前端修改会自动热更新。
- 修改后端后，运行 `pnpm build` 并重启 API 服务。
- 在 `7331` 端口测试一体化 UI 时，前端修改后运行 `pnpm build:ui` 并刷新页面。

## 隔离测试可安装包

要验证用户真正会安装的内容，请先打包 MileStack，再将 tarball 安装到独立的临时项目或测试项目。不要用全局开发链接代替安装包隔离测试。

```bash
cd /MileStack的绝对路径
pnpm pack

cd /测试项目的绝对路径
# 仅当测试项目没有 package.json 时执行：
npm init -y
npm install --save-dev /MileStack的绝对路径/milestack-<version>.tgz
./node_modules/.bin/milestack --help
./node_modules/.bin/milestack init --project "$PWD"
```

可以在测试项目中加入便于重复使用的本地脚本：

```json
{
  "scripts": {
    "milestack:init": "milestack init --project .",
    "milestack:serve": "milestack serve --project . --port 7332"
  }
}
```

```bash
npm run milestack:serve
```

npm script 会把测试项目自己的 `node_modules/.bin` 放在 `PATH` 最前面，因此即使系统全局安装了其他 MileStack 版本，它仍会使用测试项目中的 tarball。使用 `7332` 端口还可以与 `7331` 端口的源码开发服务同时运行。

安装后的 tarball 拥有独立的 `dist` 和 `dist/ui`。重新构建源码 checkout 不会更新这份副本；源码修改后需要重新打包、安装并重启测试服务。

### 更新相同版本的 tarball

`pnpm pack` 会在写入 tarball 前执行 `prepack` 检查。只有命令成功退出并打印 tarball 文件名时，才能认为打包成功。

```bash
cd /MileStack的绝对路径
pnpm pack
tar -xOf milestack-<version>.tgz package/package.json | grep '"version"'
tar -xOf milestack-<version>.tgz package/dist/ui/index.html | grep '<title>'
```

如果版本号和 tarball 路径没有变化，npm 可能保留已安装的副本。请停止测试服务、卸载依赖、重新安装并重启：

```bash
cd /测试项目的绝对路径
npm uninstall milestack
npm install --save-dev /MileStack的绝对路径/milestack-<version>.tgz
npm run milestack:serve
```

重新打包不会改变 `package.json.version`。只有准备正式发布时才递增版本号。

## 可选的全局开发链接

全局链接可以方便手动开发，但它不提供版本隔离：

```bash
pnpm setup
# setup 后打开一个新 shell。
pnpm link --global
milestack --help
```

此时裸 `milestack` 命令会运行当前 checkout 的 `dist/index.js`。所有通过该命令使用 MileStack 的项目都会共享 checkout 中的应用构建，但各项目数据库仍保持隔离。

移除链接：

```bash
pnpm remove --global milestack
which -a milestack
```

移除启动器不会删除源码 checkout、项目本地依赖或 `.milestack` 数据。

## 验证命令

```bash
pnpm typecheck
pnpm typecheck:ui
pnpm test
pnpm build
```

验证范围应与修改风险相称：

- 仅修改文档：检查链接、标题和内容一致性；
- 修改核心或数据库：运行类型检查和聚焦的核心/数据库测试；
- 修改 MCP 或 CLI：运行聚焦集成测试，并在可行时进行真实进程冒烟测试；
- 完成实现任务前：运行 `pnpm typecheck`、相关测试和 `pnpm build`。

涉及持久化或事务行为时，测试应使用临时项目和真实 SQLite 数据库。不要引入第二套测试框架，也不要把测试散落到根 `tests/` 以外。

## 本地数据与迁移

开发项目数据位于 `.milestack/`，不得提交。生成产物、覆盖率报告、临时数据库、SQLite WAL 文件和打包 tarball 也不是源码制品。

Schema 修改必须使用前向迁移，绝不能要求用户删除已有数据库。对非空数据库应用待执行迁移前，MileStack 会在 `.milestack/backups/` 中创建备份。

SQLite 写事务应保持短小，不要在事务内执行网络请求、文件扫描或 AI 工作。

## 包与发布边界

npm 包名为 `milestack`，通过 `dist/index.js` 暴露 CLI。发布文件白名单只应包含构建后的 CLI、迁移和 Web UI；源码、测试、本地项目数据及仓库指令不能进入安装包。

发布准备中使用 `npm pack --dry-run --json` 检查文件清单。npm 发布、Git 标签、推送和 GitHub Release 是相互独立的外部修改，每一项都需要开发者明确授权。
