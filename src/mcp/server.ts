import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { toJSONSchema, z, ZodError } from "zod";

import { DomainError } from "../core/errors.js";
import { formatMcpInstructions } from "../core/agent-instructions.js";
import {
  createTaskInputSchema,
  createTasksInputSchema,
  finishTaskInputSchema,
  getProjectStatusInputSchema,
  getTaskInputSchema,
  listTasksInputSchema,
  startTaskInputSchema,
  updateTaskInputSchema,
} from "../core/query-contract.js";
import { openProjectContext, type ProjectContext } from "../project/project-context.js";

const agentCreateTaskSchema = createTaskInputSchema.omit({
  projectId: true,
  status: true,
  queuePosition: true,
  createdBy: true,
});
const agentCreateTasksSchema = z
  .object({ tasks: z.array(agentCreateTaskSchema).min(1) })
  .strict();
const projectStatusArgumentsSchema = getProjectStatusInputSchema.omit({
  projectId: true,
});
const listTasksArgumentsSchema = listTasksInputSchema.omit({ projectId: true });
const taskArgumentsSchema = getTaskInputSchema.omit({ projectId: true });
const startTaskArgumentsSchema = startTaskInputSchema.omit({ projectId: true });
const updateTaskArgumentsSchema = updateTaskInputSchema.omit({ projectId: true });
const finishTaskArgumentsSchema = finishTaskInputSchema.omit({ projectId: true });

const toolDefinitions: Tool[] = [
  {
    name: "get_project_status",
    description:
      "Use this when no taskId is known to read the current project work and ordered ready queue. Choose only ready tasks with runnable=true; waiting tasks include their unfinished dependencies.",
    inputSchema: toJSONSchema(projectStatusArgumentsSchema) as Tool["inputSchema"],
  },
  {
    name: "list_tasks",
    description:
      "Read one task status section with a bounded limit and opaque cursor. Results use the existing ready-queue or recent-completion ordering.",
    inputSchema: toJSONSchema(listTasksArgumentsSchema) as Tool["inputSchema"],
  },
  {
    name: "get_task",
    description:
      "Read a known taskId's objective, acceptance criteria, dependency state, current snapshot, and immutable event history before claiming it. This does not require get_project_status first.",
    inputSchema: toJSONSchema(taskArgumentsSchema) as Tool["inputSchema"],
  },
  {
    name: "create_task",
    description:
      "Record one newly discovered task in the project's inbox. Optionally include the model label. Agent-created tasks are not ready until a developer confirms and orders them.",
    inputSchema: toJSONSchema(agentCreateTaskSchema) as Tool["inputSchema"],
  },
  {
    name: "create_tasks",
    description:
      "Record several newly discovered inbox tasks atomically, optionally including model labels. If one input is invalid, the complete batch is rolled back.",
    inputSchema: toJSONSchema(agentCreateTasksSchema) as Tool["inputSchema"],
  },
  {
    name: "start_task",
    description:
      "After get_task, atomically claim a runnable ready task. Optionally include the model label. Save the returned runId and include it in every subsequent execution update.",
    inputSchema: toJSONSchema(startTaskArgumentsSchema) as Tool["inputSchema"],
  },
  {
    name: "update_task",
    description:
      "Record meaningful progress for a running task. The runId must belong to the current execution.",
    inputSchema: toJSONSchema(updateTaskArgumentsSchema) as Tool["inputSchema"],
  },
  {
    name: "finish_task",
    description:
      "Submit a running task for developer review with a completion summary. The runId becomes invalid after submission; only developer review can approve completion.",
    inputSchema: toJSONSchema(finishTaskArgumentsSchema) as Tool["inputSchema"],
  },
];

function formatError(error: unknown): string {
  if (error instanceof DomainError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return `INVALID_INPUT: ${JSON.stringify(issues)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: formatError(error) }],
  };
}

export function createMcpServer(context: ProjectContext): Server {
  const server = new Server(
    { name: "milestack", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: formatMcpInstructions(),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const args = request.params.arguments ?? {};
      switch (request.params.name) {
        case "get_project_status": {
          const parsed = projectStatusArgumentsSchema.parse(args);
          const input = getProjectStatusInputSchema.parse({
            ...parsed,
            projectId: context.project.id,
            view: parsed.view ?? "compact",
          });
          return jsonResult(context.service.getProjectStatus(input));
        }
        case "list_tasks": {
          const parsed = listTasksArgumentsSchema.parse(args);
          return jsonResult(
            context.service.listTasks({
              ...parsed,
              projectId: context.project.id,
            }),
          );
        }
        case "get_task": {
          const parsed = taskArgumentsSchema.parse(args);
          const input = getTaskInputSchema.parse({
            ...parsed,
            projectId: context.project.id,
          });
          return jsonResult(context.service.getTask(input));
        }
        case "create_task": {
          const parsed = agentCreateTaskSchema.parse(args);
          const input = createTaskInputSchema.parse({
            ...parsed,
            projectId: context.project.id,
            createdBy: "agent",
          });
          return jsonResult(context.service.createTask(input));
        }
        case "create_tasks": {
          const parsed = agentCreateTasksSchema.parse(args);
          const input = createTasksInputSchema.parse({
            projectId: context.project.id,
            tasks: parsed.tasks.map((task) => ({
              ...task,
              createdBy: "agent",
            })),
          });
          return jsonResult(context.service.createTasks(input));
        }
        case "start_task": {
          const parsed = startTaskArgumentsSchema.parse(args);
          return jsonResult(
            context.service.startTask({
              ...parsed,
              projectId: context.project.id,
            }),
          );
        }
        case "update_task": {
          const parsed = updateTaskArgumentsSchema.parse(args);
          return jsonResult(
            context.service.updateTask({
              ...parsed,
              projectId: context.project.id,
            }),
          );
        }
        case "finish_task": {
          const parsed = finishTaskArgumentsSchema.parse(args);
          return jsonResult(
            context.service.finishTask({
              ...parsed,
              projectId: context.project.id,
            }),
          );
        }
        default:
          return errorResult(new Error(`Unknown tool '${request.params.name}'.`));
      }
    } catch (error) {
      return errorResult(error);
    }
  });

  return server;
}

export async function runMcp(projectRoot: string): Promise<void> {
  const context = await openProjectContext(projectRoot);
  const server = createMcpServer(context);
  const transport = new StdioServerTransport();
  transport.onclose = () => context.database.close();

  try {
    await server.connect(transport);
  } catch (error) {
    context.database.close();
    throw error;
  }
}
