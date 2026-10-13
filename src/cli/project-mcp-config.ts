import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { resolveMcpLauncher, type McpLauncherResolution } from "./mcp-launcher.js";

export const projectMcpClientNames = [
  "claude",
  "cursor",
  "grok",
  "codex",
  "opencode",
  "agy",
] as const;

export type ProjectMcpClientName = (typeof projectMcpClientNames)[number];

export const projectMcpClientDisplayNames: Record<ProjectMcpClientName, string> = {
  claude: "Claude",
  cursor: "Cursor",
  grok: "Grok",
  codex: "Codex",
  opencode: "OpenCode",
  agy: "AGY",
};
export type ProjectMcpConfigAction = "created" | "updated" | "unchanged" | "skipped";

export type ProjectMcpConfigResult = {
  client: ProjectMcpClientName;
  relativePath: string;
  action: ProjectMcpConfigAction;
  detail: string;
};

type McpEntry = {
  command: string;
  args: string[];
};

type OpenCodeMcpEntry = {
  type: "local";
  command: string[];
  enabled: true;
};

type ClientDefinition = {
  relativePath: string;
  format: "json" | "toml" | "opencode-json";
};

type SafeTarget = {
  filePath: string;
  exists: boolean;
};

const clientDefinitions: Record<Exclude<ProjectMcpClientName, "agy">, ClientDefinition> = {
  claude: { relativePath: ".mcp.json", format: "json" },
  cursor: { relativePath: ".cursor/mcp.json", format: "json" },
  grok: { relativePath: ".grok/config.toml", format: "toml" },
  codex: { relativePath: ".codex/config.toml", format: "toml" },
  opencode: { relativePath: "opencode.json", format: "opencode-json" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesMcpEntry(value: unknown, expected: McpEntry): boolean {
  if (!isRecord(value) || value.command !== expected.command || !Array.isArray(value.args)) {
    return false;
  }
  if (value.args.length !== expected.args.length) {
    return false;
  }
  return value.args.every(
    (argument, index) => typeof argument === "string" && argument === expected.args[index],
  );
}

function result(
  client: ProjectMcpClientName,
  relativePath: string,
  action: ProjectMcpConfigAction,
  detail: string,
): ProjectMcpConfigResult {
  return { client, relativePath, action, detail };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath))
  );
}

function resolveRealProjectRoot(absoluteProjectRoot: string): string | undefined {
  try {
    const realProjectRoot = realpathSync(absoluteProjectRoot);
    return statSync(realProjectRoot).isDirectory() ? realProjectRoot : undefined;
  } catch {
    return undefined;
  }
}

function resolveSafeTarget(
  absoluteProjectRoot: string,
  realProjectRoot: string,
  relativePath: string,
): SafeTarget | undefined {
  const requestedPath = path.join(absoluteProjectRoot, relativePath);
  let currentPath = requestedPath;
  const missingParts: string[] = [];

  while (true) {
    try {
      lstatSync(currentPath);
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        return undefined;
      }
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        return undefined;
      }
      missingParts.unshift(path.basename(currentPath));
      currentPath = parentPath;
      continue;
    }

    let realCurrentPath: string;
    try {
      realCurrentPath = realpathSync(currentPath);
    } catch {
      return undefined;
    }
    if (!isPathInside(realProjectRoot, realCurrentPath)) {
      return undefined;
    }

    if (missingParts.length === 0) {
      return { filePath: realCurrentPath, exists: true };
    }
    let currentIsDirectory: boolean;
    try {
      currentIsDirectory = statSync(realCurrentPath).isDirectory();
    } catch {
      return undefined;
    }
    if (!currentIsDirectory) {
      return undefined;
    }

    const resolvedPath = path.join(realCurrentPath, ...missingParts);
    return isPathInside(realProjectRoot, resolvedPath)
      ? { filePath: resolvedPath, exists: false }
      : undefined;
  }
}

function createParentDirectory(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function createJsonContent(entry: McpEntry): string {
  return `${JSON.stringify({ mcpServers: { milestack: entry } }, null, 2)}\n`;
}

function configureJsonFile(
  client: ProjectMcpClientName,
  relativePath: string,
  target: SafeTarget,
  entry: McpEntry,
): ProjectMcpConfigResult {
  if (!target.exists) {
    createParentDirectory(target.filePath);
    writeFileSync(target.filePath, createJsonContent(entry), "utf8");
    return result(client, relativePath, "created", `已写入 ${relativePath}`);
  }

  let original: string;
  let parsed: unknown;
  try {
    original = readFileSync(target.filePath, "utf8");
    parsed = JSON.parse(original) as unknown;
  } catch {
    return result(client, relativePath, "skipped", `未覆盖 ${relativePath}：JSON 无法解析，已保留原文件`);
  }

  if (!isRecord(parsed)) {
    return result(client, relativePath, "skipped", `未覆盖 ${relativePath}：配置根值不是对象，已保留原文件`);
  }

  let servers: Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(parsed, "mcpServers")) {
    const existingServers = parsed.mcpServers;
    if (!isRecord(existingServers)) {
      return result(client, relativePath, "skipped", `未覆盖 ${relativePath}：mcpServers 不是对象，已保留原文件`);
    }
    servers = existingServers;
  } else {
    servers = {};
    parsed.mcpServers = servers;
  }

  if (Object.prototype.hasOwnProperty.call(servers, "milestack")) {
    if (matchesMcpEntry(servers.milestack, entry)) {
      return result(client, relativePath, "unchanged", `已有相同的 ${relativePath} 配置，未修改`);
    }
    return result(client, relativePath, "skipped", `未覆盖 ${relativePath}：已有不同的 milestack 配置，已保留原文件`);
  }

  servers.milestack = entry;
  writeFileSync(target.filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return result(client, relativePath, "updated", `已加入 ${relativePath}，并保留原有其他配置`);
}

function matchesOpenCodeMcpEntry(value: unknown, expected: OpenCodeMcpEntry): boolean {
  if (
    !isRecord(value) ||
    value.type !== expected.type ||
    value.enabled !== expected.enabled ||
    !Array.isArray(value.command)
  ) {
    return false;
  }
  if (value.command.length !== expected.command.length) {
    return false;
  }
  return value.command.every(
    (argument, index) =>
      typeof argument === "string" && argument === expected.command[index],
  );
}

function withOpenCodeJsoncNote(detail: string, hasJsonc: boolean): string {
  return hasJsonc ? `${detail}（检测到 opencode.jsonc，未修改该文件）` : detail;
}

function launcherNote(launcher: McpLauncherResolution): string | undefined {
  if (launcher.kind === "path") {
    return undefined;
  }
  if (launcher.kind === "project-cli-entry") {
    return `（已固定到项目 node_modules 中的 CLI 入口文件：node ${launcher.cliEntryPath}）`;
  }
  if (launcher.kind === "cli-entry") {
    return `（PATH 中未找到 milestack，command 改用当前 CLI 入口文件：node ${launcher.cliEntryPath}）`;
  }
  return (
    `（PATH 中未找到 milestack，且无法确定当前 CLI 入口文件；` +
    `请在 MileStack 仓库执行 pnpm build 与 pnpm link --global 后重新 init，或手写 command）`
  );
}

function withLauncherNote(
  configuration: ProjectMcpConfigResult,
  launcher: McpLauncherResolution,
): ProjectMcpConfigResult {
  // A skipped result left the existing file untouched, so the note must not
  // claim that the command was switched.
  if (configuration.action === "skipped") {
    return configuration;
  }
  const note = launcherNote(launcher);
  return note === undefined
    ? configuration
    : { ...configuration, detail: `${configuration.detail}${note}` };
}

function createOpenCodeJsonContent(entry: OpenCodeMcpEntry): string {
  return `${JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      mcp: { milestack: entry },
    },
    null,
    2,
  )}\n`;
}

function configureOpenCodeJsonFile(
  client: ProjectMcpClientName,
  relativePath: string,
  target: SafeTarget,
  entry: OpenCodeMcpEntry,
  hasJsonc: boolean,
): ProjectMcpConfigResult {
  if (!target.exists) {
    if (hasJsonc) {
      const manualEntry = JSON.stringify({ mcp: { milestack: entry } }, null, 2);
      return result(
        client,
        relativePath,
        "skipped",
        `未创建 ${relativePath}：检测到 opencode.jsonc，请在该文件中手写以下条目（路径为 mcp.milestack）：\n${manualEntry}`,
      );
    }
    createParentDirectory(target.filePath);
    writeFileSync(target.filePath, createOpenCodeJsonContent(entry), "utf8");
    return result(client, relativePath, "created", `已写入 ${relativePath}`);
  }

  let original: string;
  let parsed: unknown;
  try {
    original = readFileSync(target.filePath, "utf8");
    parsed = JSON.parse(original) as unknown;
  } catch {
    return result(
      client,
      relativePath,
      "skipped",
      withOpenCodeJsoncNote(
        `未覆盖 ${relativePath}：JSON 无法解析，已保留原文件`,
        hasJsonc,
      ),
    );
  }

  if (!isRecord(parsed)) {
    return result(
      client,
      relativePath,
      "skipped",
      withOpenCodeJsoncNote(
        `未覆盖 ${relativePath}：配置根值不是对象，已保留原文件`,
        hasJsonc,
      ),
    );
  }

  let mcp: Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(parsed, "mcp")) {
    const existingMcp = parsed.mcp;
    if (!isRecord(existingMcp)) {
      return result(
        client,
        relativePath,
        "skipped",
        withOpenCodeJsoncNote(
          `未覆盖 ${relativePath}：mcp 不是对象，已保留原文件`,
          hasJsonc,
        ),
      );
    }
    mcp = existingMcp;
  } else {
    mcp = {};
    parsed.mcp = mcp;
  }

  if (Object.prototype.hasOwnProperty.call(mcp, "milestack")) {
    if (matchesOpenCodeMcpEntry(mcp.milestack, entry)) {
      return result(
        client,
        relativePath,
        "unchanged",
        withOpenCodeJsoncNote(
          `已有相同的 ${relativePath} 配置，未修改`,
          hasJsonc,
        ),
      );
    }
    return result(
      client,
      relativePath,
      "skipped",
      withOpenCodeJsoncNote(
        `未覆盖 ${relativePath}：已有不同的 mcp.milestack 配置，已保留原文件`,
        hasJsonc,
      ),
    );
  }

  mcp.milestack = entry;
  writeFileSync(target.filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return result(
    client,
    relativePath,
    "updated",
    withOpenCodeJsoncNote(
      `已加入 ${relativePath}，并保留原有其他配置`,
      hasJsonc,
    ),
  );
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function createTomlContent(entry: McpEntry): string {
  return [
    "[mcp_servers.milestack]",
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(", ")}]`,
    "",
  ].join("\n");
}

function parseTomlBasicString(value: string): string | undefined {
  const match = value.trim().match(/^"((?:\\.|[^"\\])*)"\s*(?:#.*)?$/);
  const encoded = match?.[1];
  if (encoded === undefined) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(`"${encoded}"`);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseTomlStringArray(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) {
    return undefined;
  }

  let closingIndex = -1;
  let inString = false;
  let escaped = false;
  for (let index = 1; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === undefined) {
      break;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
    } else if (character === '"') {
      inString = true;
    } else if (character === "]") {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex < 0 || trimmed.slice(closingIndex + 1).trim().replace(/^#.*/, "") !== "") {
    return undefined;
  }

  const contents = trimmed.slice(1, closingIndex);
  const values: string[] = [];
  let index = 0;
  while (index < contents.length) {
    while (/\s/.test(contents[index] ?? "")) {
      index += 1;
    }
    if (index >= contents.length) {
      break;
    }
    if (contents[index] !== '"') {
      return undefined;
    }

    const start = index;
    index += 1;
    let stringEscaped = false;
    let closed = false;
    while (index < contents.length) {
      const character = contents[index];
      index += 1;
      if (character === undefined) {
        break;
      }
      if (stringEscaped) {
        stringEscaped = false;
      } else if (character === "\\") {
        stringEscaped = true;
      } else if (character === '"') {
        closed = true;
        break;
      }
    }
    if (!closed) {
      return undefined;
    }

    const parsed = parseTomlBasicString(contents.slice(start, index));
    if (parsed === undefined) {
      return undefined;
    }
    values.push(parsed);

    while (/\s/.test(contents[index] ?? "")) {
      index += 1;
    }
    if (index >= contents.length) {
      break;
    }
    if (contents[index] !== ",") {
      return undefined;
    }
    index += 1;
  }

  return values;
}

function parseTomlKeyPath(value: string): string[] | undefined {
  const keys: string[] = [];
  let index = 0;

  while (index < value.length) {
    while (/\s/.test(value[index] ?? "")) {
      index += 1;
    }
    if (index >= value.length) {
      return keys.length > 0 ? keys : undefined;
    }

    const firstCharacter = value[index];
    let key: string | undefined;
    if (firstCharacter === '"') {
      const start = index;
      index += 1;
      let escaped = false;
      let closed = false;
      while (index < value.length) {
        const character = value[index];
        index += 1;
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) {
        return undefined;
      }
      key = parseTomlBasicString(value.slice(start, index));
    } else if (firstCharacter === "'") {
      index += 1;
      const start = index;
      let closed = false;
      while (index < value.length) {
        const character = value[index];
        if (character === "'") {
          if (value[index + 1] === "'") {
            index += 2;
            continue;
          }
          key = value.slice(start, index).replace(/''/g, "'");
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) {
        return undefined;
      }
    } else {
      const bareKey = value.slice(index).match(/^[A-Za-z0-9_-]+/);
      if (bareKey === null) {
        return undefined;
      }
      key = bareKey[0];
      index += key.length;
    }

    if (key === undefined) {
      return undefined;
    }
    keys.push(key);

    while (/\s/.test(value[index] ?? "")) {
      index += 1;
    }
    if (index >= value.length) {
      return keys;
    }
    if (value[index] !== ".") {
      return undefined;
    }
    index += 1;
  }

  return keys.length > 0 ? keys : undefined;
}

type TomlTableHeader = {
  array: boolean;
  keys: string[];
};

function parseTomlTableHeader(line: string): TomlTableHeader | undefined {
  const trimmed = line.trim();
  const arrayMatch = trimmed.match(/^\[\[([\s\S]*?)\]\]\s*(?:#.*)?$/);
  if (arrayMatch?.[1] !== undefined) {
    const keys = parseTomlKeyPath(arrayMatch[1]);
    return keys === undefined ? undefined : { array: true, keys };
  }

  const tableMatch = trimmed.match(/^\[([\s\S]*?)\]\s*(?:#.*)?$/);
  if (tableMatch?.[1] === undefined) {
    return undefined;
  }
  const keys = parseTomlKeyPath(tableMatch[1]);
  return keys === undefined ? undefined : { array: false, keys };
}

function isMcpMilestackTable(header: TomlTableHeader): boolean {
  return header.keys.length === 2 && header.keys[0] === "mcp_servers" && header.keys[1] === "milestack";
}

type TomlMcpTable =
  | { found: false }
  | { found: true; entry?: McpEntry };

function parseTomlMcpTable(contents: string): TomlMcpTable {
  const lines = contents.split(/\r?\n/);
  const headers = lines.map((line, index) => ({ header: parseTomlTableHeader(line), index }));
  if (headers.some(({ header }) => header?.array === true && isMcpMilestackTable(header))) {
    return { found: true };
  }
  const tableIndices = headers.flatMap(({ header, index }) =>
    header !== undefined && !header.array && isMcpMilestackTable(header) ? [index] : [],
  );
  if (tableIndices.length === 0) {
    return { found: false };
  }
  if (tableIndices.length > 1) {
    return { found: true };
  }

  const tableIndex = tableIndices[0];
  if (tableIndex === undefined) {
    return { found: true };
  }
  let endIndex = lines.length;
  for (let index = tableIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\[{1,2}/.test(lines[index] ?? "")) {
      endIndex = index;
      break;
    }
  }

  let command: string | undefined;
  let args: string[] | undefined;
  let commandSeen = false;
  let argsSeen = false;
  for (const line of lines.slice(tableIndex + 1, endIndex)) {
    const assignment = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/);
    const key = assignment?.[1];
    const value = assignment?.[2];
    if (key === undefined || value === undefined) {
      if (line.trim() !== "" && !line.trim().startsWith("#")) {
        return { found: true };
      }
      continue;
    }
    if (key === "command") {
      if (commandSeen) {
        return { found: true };
      }
      commandSeen = true;
      command = parseTomlBasicString(value);
      if (command === undefined) {
        return { found: true };
      }
    } else if (key === "args") {
      if (argsSeen) {
        return { found: true };
      }
      argsSeen = true;
      args = parseTomlStringArray(value);
      if (args === undefined) {
        return { found: true };
      }
    }
  }

  if (command === undefined || args === undefined) {
    return { found: true };
  }
  return { found: true, entry: { command, args } };
}

function configureTomlFile(
  client: ProjectMcpClientName,
  relativePath: string,
  target: SafeTarget,
  entry: McpEntry,
): ProjectMcpConfigResult {
  if (!target.exists) {
    createParentDirectory(target.filePath);
    writeFileSync(target.filePath, createTomlContent(entry), "utf8");
    return result(client, relativePath, "created", `已写入 ${relativePath}`);
  }

  let original: string;
  try {
    original = readFileSync(target.filePath, "utf8");
  } catch {
    return result(client, relativePath, "skipped", `未覆盖 ${relativePath}：无法读取原文件，已保留原内容`);
  }

  const table = parseTomlMcpTable(original);
  if (table.found) {
    if (table.entry && matchesMcpEntry(table.entry, entry)) {
      return result(client, relativePath, "unchanged", `已有相同的 ${relativePath} 配置，未修改`);
    }
    return result(client, relativePath, "skipped", `未覆盖 ${relativePath}：已有不同或无法解析的 milestack 表，已保留原文件`);
  }

  const separator = original.length === 0 || original.endsWith("\n") ? "" : "\n";
  writeFileSync(target.filePath, `${original}${separator}${createTomlContent(entry)}`, "utf8");
  return result(client, relativePath, "updated", `已加入 ${relativePath}，并保留原有其他配置`);
}

export function configureProjectMcpClients(
  projectRoot: string,
  clients: readonly ProjectMcpClientName[],
): ProjectMcpConfigResult[] {
  const absoluteProjectRoot = path.resolve(projectRoot);
  const realProjectRoot = resolveRealProjectRoot(absoluteProjectRoot);
  const launcher = resolveMcpLauncher({ projectRoot: absoluteProjectRoot });
  const projectEntry: McpEntry = {
    command: launcher.launcher.command,
    args: [...launcher.launcher.args, "mcp", "--project", absoluteProjectRoot],
  };
  const openCodeEntry: OpenCodeMcpEntry = {
    type: "local",
    command: [projectEntry.command, ...projectEntry.args],
    enabled: true,
  };

  return clients.map((client) => {
    if (client === "agy") {
      return result(
        client,
        "~/.gemini/config/mcp_config.json",
        "skipped",
        `AGY（Gemini CLI）使用用户级全局配置，milestack init 不会自动修改用户主目录配置。\n` +
          `  推荐直接运行以下命令完成注册或更新（会自动替换旧项目的固定路径条目）：\n` +
          `    agy mcp add milestack -- milestack mcp --discover\n` +
          `  验证配置：\n` +
          `    agy mcp list\n` +
          `  若需手动配置，请在 ~/.gemini/config/mcp_config.json 的 mcpServers 中添加或更新：\n` +
          `    "milestack": { "command": "milestack", "args": ["mcp", "--discover"] }\n` +
          `  此配置在所有已初始化的 MileStack 项目中全局生效，按会话工作目录自动定位数据库。`,
      );
    }
    const definition = clientDefinitions[client];
    if (!definition) {
      throw new Error(`不支持的 MCP 客户端：${String(client)}`);
    }
    if (realProjectRoot === undefined) {
      return result(
        client,
        definition.relativePath,
        "skipped",
        `未覆盖 ${definition.relativePath}：目标路径无法安全解析到项目根内，已保留原内容`,
      );
    }
    const target = resolveSafeTarget(
      absoluteProjectRoot,
      realProjectRoot,
      definition.relativePath,
    );
    if (target === undefined) {
      return result(
        client,
        definition.relativePath,
        "skipped",
        `未覆盖 ${definition.relativePath}：目标路径无法安全解析到项目根内，已保留原内容`,
      );
    }
    if (definition.format === "opencode-json") {
      const jsoncTarget = resolveSafeTarget(
        absoluteProjectRoot,
        realProjectRoot,
        "opencode.jsonc",
      );
      return withLauncherNote(
        configureOpenCodeJsonFile(
          client,
          definition.relativePath,
          target,
          openCodeEntry,
          jsoncTarget?.exists === true,
        ),
        launcher,
      );
    }
    return withLauncherNote(
      definition.format === "json"
        ? configureJsonFile(client, definition.relativePath, target, projectEntry)
        : configureTomlFile(client, definition.relativePath, target, projectEntry),
      launcher,
    );
  });
}
