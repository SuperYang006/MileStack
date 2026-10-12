import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  initializeProject,
  openProjectContext,
  resolveWorkspaceProjectRoot,
} from "../../src/project/project-context.js";

const temporaryProjects: string[] = [];

function textContent(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result)) {
    throw new Error("MCP result did not contain content.");
  }
  const content = Array.isArray(result.content) ? result.content[0] : undefined;
  if (
    !content ||
    typeof content !== "object" ||
    !("type" in content) ||
    content.type !== "text" ||
    !("text" in content) ||
    typeof content.text !== "string"
  ) {
    throw new Error("MCP result did not contain text content.");
  }
  return content.text;
}

afterEach(() => {
  for (const projectRoot of temporaryProjects.splice(0)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

function createTempProject(suffix: string): string {
  const projectRoot = path.join(
    os.tmpdir(),
    `milestack-discover-${suffix}-${randomUUID()}`,
  );
  mkdirSync(projectRoot, { recursive: true });
  temporaryProjects.push(projectRoot);
  return projectRoot;
}

describe("--discover project isolation", () => {
  it(
    "two projects started via --discover each see only their own tasks",
    async () => {
      const repositoryRoot = path.resolve(import.meta.dirname, "../..");
      const tsxLoader = path.join(
        repositoryRoot,
        "node_modules",
        ".pnpm",
        "node_modules",
        "tsx",
        "dist",
        "loader.mjs",
      );
      expect(existsSync(tsxLoader)).toBe(true);
      const entryPoint = path.join(repositoryRoot, "src/cli/index.ts");

      // Create two separate projects
      const projectA = createTempProject("A");
      const projectB = createTempProject("B");

      // Initialize both
      const initA = await initializeProject(projectA);
      initA.database.close();
      const initB = await initializeProject(projectB);
      initB.database.close();

      // Seed project A with a unique task
      const ctxA = await openProjectContext(projectA);
      ctxA.service.createTask({
        projectId: ctxA.project.id,
        title: "Task unique to project A",
        createdBy: "developer",
        status: "ready",
      });
      ctxA.database.close();

      // Seed project B with a different unique task
      const ctxB = await openProjectContext(projectB);
      ctxB.service.createTask({
        projectId: ctxB.project.id,
        title: "Task unique to project B",
        createdBy: "developer",
        status: "ready",
      });
      ctxB.database.close();

      // Create subdirectories to start from
      const subdirA = path.join(projectA, "src", "lib");
      mkdirSync(subdirA, { recursive: true });
      const subdirB = path.join(projectB, "packages", "core");
      mkdirSync(subdirB, { recursive: true });

      // Start MCP from project A subdirectory using --discover
      const transportA = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", tsxLoader, entryPoint, "mcp", "--discover"],
        cwd: subdirA,
        stderr: "pipe",
      });
      const clientA = new Client({
        name: "discover-isolation-A",
        version: "1.0.0",
      });
      await clientA.connect(transportA);

      // Start MCP from project B subdirectory using --discover
      const transportB = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", tsxLoader, entryPoint, "mcp", "--discover"],
        cwd: subdirB,
        stderr: "pipe",
      });
      const clientB = new Client({
        name: "discover-isolation-B",
        version: "1.0.0",
      });
      await clientB.connect(transportB);

      try {
        // Query project status from each
        const statusA = JSON.parse(
          textContent(
            await clientA.callTool({
              name: "get_project_status",
              arguments: {},
            }),
          ),
        );

        const statusB = JSON.parse(
          textContent(
            await clientB.callTool({
              name: "get_project_status",
              arguments: {},
            }),
          ),
        );

        // Each project should have exactly one task in its next queue
        expect(statusA.next).toHaveLength(1);
        expect(statusA.next[0].title).toBe("Task unique to project A");

        expect(statusB.next).toHaveLength(1);
        expect(statusB.next[0].title).toBe("Task unique to project B");

        // Project IDs must differ
        expect(statusA.project.id).not.toBe(statusB.project.id);
      } finally {
        await clientA.close();
        await clientB.close();
      }
    },
    20_000,
  );

  it(
    "MCP --discover fails with clear error when no project is initialized",
    async () => {
      const repositoryRoot = path.resolve(import.meta.dirname, "../..");
      const tsxLoader = path.join(
        repositoryRoot,
        "node_modules",
        ".pnpm",
        "node_modules",
        "tsx",
        "dist",
        "loader.mjs",
      );
      const entryPoint = path.join(repositoryRoot, "src/cli/index.ts");

      const emptyDir = createTempProject("empty");

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", tsxLoader, entryPoint, "mcp", "--discover"],
        cwd: emptyDir,
        stderr: "pipe",
      });

      // The MCP process should fail because no .milestack is found.
      // The transport will fail to connect because the process exits.
      const client = new Client({
        name: "discover-fail",
        version: "1.0.0",
      });

      let caught = false;
      try {
        await client.connect(transport);
        // If we somehow connected, the tools should not work
        await client.callTool({
          name: "get_project_status",
          arguments: {},
        });
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);

      try {
        await client.close();
      } catch {
        // Transport may have already closed
      }
    },
    15_000,
  );

  it(
    "rejects multi-root workspace when roots map to different MileStack projects",
    async () => {
      const repositoryRoot = path.resolve(import.meta.dirname, "../..");
      const tsxLoader = path.join(
        repositoryRoot,
        "node_modules",
        ".pnpm",
        "node_modules",
        "tsx",
        "dist",
        "loader.mjs",
      );
      const entryPoint = path.join(repositoryRoot, "src/cli/index.ts");

      const projectA = createTempProject("multi-A");
      const projectB = createTempProject("multi-B");

      const initA = await initializeProject(projectA);
      initA.database.close();
      const initB = await initializeProject(projectB);
      initB.database.close();

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", tsxLoader, entryPoint, "mcp", "--discover"],
        cwd: projectA,
        stderr: "pipe",
      });

      const client = new Client(
        {
          name: "multi-root-conflict-client",
          version: "1.0.0",
        },
        {
          capabilities: {
            roots: {
              listChanged: true,
            },
          },
        },
      );

      client.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: [
          { uri: pathToFileURL(projectA).href },
          { uri: pathToFileURL(projectB).href },
        ],
      }));

      let caught = false;
      try {
        await client.connect(transport);
        const result = await client.callTool({
          name: "get_project_status",
          arguments: {},
        });
        if (result && typeof result === "object" && "isError" in result && result.isError) {
          caught = true;
        }
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);

      try {
        await client.close();
      } catch {
        // Transport may have already closed
      }
    },
    15_000,
  );

  it(
    "allows multi-root workspace when all roots belong to the same MileStack project",
    async () => {
      const repositoryRoot = path.resolve(import.meta.dirname, "../..");
      const tsxLoader = path.join(
        repositoryRoot,
        "node_modules",
        ".pnpm",
        "node_modules",
        "tsx",
        "dist",
        "loader.mjs",
      );
      const entryPoint = path.join(repositoryRoot, "src/cli/index.ts");

      const projectA = createTempProject("multi-same");
      const initA = await initializeProject(projectA);
      initA.database.close();

      const ctxA = await openProjectContext(projectA);
      ctxA.service.createTask({
        projectId: ctxA.project.id,
        title: "Same project multi-root task",
        createdBy: "developer",
        status: "ready",
      });
      ctxA.database.close();

      const subdir = path.join(projectA, "packages", "ui");
      mkdirSync(subdir, { recursive: true });

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", tsxLoader, entryPoint, "mcp", "--discover"],
        cwd: projectA,
        stderr: "pipe",
      });

      const client = new Client(
        {
          name: "multi-root-same-client",
          version: "1.0.0",
        },
        {
          capabilities: {
            roots: {
              listChanged: true,
            },
          },
        },
      );

      client.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: [
          { uri: pathToFileURL(projectA).href },
          { uri: pathToFileURL(subdir).href },
        ],
      }));

      try {
        await client.connect(transport);
        const result = await client.callTool({
          name: "get_project_status",
          arguments: {},
        });
        const status = JSON.parse(textContent(result));
        expect(status.next).toHaveLength(1);
        expect(status.next[0].title).toBe("Same project multi-root task");
      } finally {
        await client.close();
      }
    },
    15_000,
  );

  it(
    "rejects multi-root workspace when one root is not a MileStack project",
    async () => {
      const repositoryRoot = path.resolve(import.meta.dirname, "../..");
      const tsxLoader = path.join(
        repositoryRoot,
        "node_modules",
        ".pnpm",
        "node_modules",
        "tsx",
        "dist",
        "loader.mjs",
      );
      const entryPoint = path.join(repositoryRoot, "src/cli/index.ts");

      const projectA = createTempProject("multi-valid");
      const uninitializedDir = createTempProject("multi-uninit");

      const initA = await initializeProject(projectA);
      initA.database.close();

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", tsxLoader, entryPoint, "mcp", "--discover"],
        cwd: projectA,
        stderr: "pipe",
      });

      const client = new Client(
        {
          name: "multi-root-partial-client",
          version: "1.0.0",
        },
        {
          capabilities: {
            roots: {
              listChanged: true,
            },
          },
        },
      );

      client.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: [
          { uri: pathToFileURL(projectA).href },
          { uri: pathToFileURL(uninitializedDir).href },
        ],
      }));

      let caught = false;
      try {
        await client.connect(transport);
        const result = await client.callTool({
          name: "get_project_status",
          arguments: {},
        });
        if (result && typeof result === "object" && "isError" in result && result.isError) {
          caught = true;
        }
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);

      try {
        await client.close();
      } catch {
        // Transport may have already closed
      }
    },
    15_000,
  );
});
