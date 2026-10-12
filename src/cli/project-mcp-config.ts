import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const projectMcpClientNames = ["claude", "cursor", "grok", "codex"] as const;

export type ProjectMcpClientName = (typeof projectMcpClientNames)[number];
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

type ClientDefinition = {
  relativePath: string;
  format: "json" | "toml";
};

const clientDefinitions: Record<ProjectMcpClientName, ClientDefinition> = {
  claude: { relativePath: ".mcp.json", format: "json" },
  cursor: { relativePath: ".cursor/mcp.json", format: "json" },
  grok: { relativePath: ".grok/config.toml", format: "toml" },
  codex: { relativePath: ".codex/config.toml", format: "toml" },
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

function createParentDirectory(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function createJsonContent(entry: McpEntry): string {
  return `${JSON.stringify({ mcpServers: { milestack: entry } }, null, 2)}\n`;
}

function configureJsonFile(
  client: ProjectMcpClientName,
  relativePath: string,
  filePath: string,
  entry: McpEntry,
): ProjectMcpConfigResult {
  if (!existsSync(filePath)) {
    createParentDirectory(filePath);
    writeFileSync(filePath, createJsonContent(entry), "utf8");
    return result(client, relativePath, "created", `已写入 ${relativePath}`);
  }

  let original: string;
  let parsed: unknown;
  try {
    original = readFileSync(filePath, "utf8");
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
  writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return result(client, relativePath, "updated", `已加入 ${relativePath}，并保留原有其他配置`);
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

type TomlMcpTable =
  | { found: false }
  | { found: true; entry?: McpEntry };

function parseTomlMcpTable(contents: string): TomlMcpTable {
  const lines = contents.split(/\r?\n/);
  if (lines.some((line) => /^\s*\[\[\s*mcp_servers\.milestack\s*\]\]\s*(?:#.*)?$/.test(line))) {
    return { found: true };
  }
  const tableIndices = lines.flatMap((line, index) =>
    /^\s*\[\s*mcp_servers\.milestack\s*\]\s*(?:#.*)?$/.test(line) ? [index] : [],
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
  filePath: string,
  entry: McpEntry,
): ProjectMcpConfigResult {
  if (!existsSync(filePath)) {
    createParentDirectory(filePath);
    writeFileSync(filePath, createTomlContent(entry), "utf8");
    return result(client, relativePath, "created", `已写入 ${relativePath}`);
  }

  let original: string;
  try {
    original = readFileSync(filePath, "utf8");
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
  writeFileSync(filePath, `${original}${separator}${createTomlContent(entry)}`, "utf8");
  return result(client, relativePath, "updated", `已加入 ${relativePath}，并保留原有其他配置`);
}

export function configureProjectMcpClients(
  projectRoot: string,
  clients: readonly ProjectMcpClientName[],
): ProjectMcpConfigResult[] {
  const absoluteProjectRoot = path.resolve(projectRoot);
  const entry: McpEntry = {
    command: "milestack",
    args: ["mcp", "--project", absoluteProjectRoot],
  };

  return clients.map((client) => {
    const definition = clientDefinitions[client];
    if (!definition) {
      throw new Error(`不支持的 MCP 客户端：${String(client)}`);
    }
    const filePath = path.join(absoluteProjectRoot, definition.relativePath);
    return definition.format === "json"
      ? configureJsonFile(client, definition.relativePath, filePath, entry)
      : configureTomlFile(client, definition.relativePath, filePath, entry);
  });
}
