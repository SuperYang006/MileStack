import { realpathSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  InitializedNotificationSchema,
  ListToolsRequestSchema,
  RootsListChangedNotificationSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { toJSONSchema, z, ZodError } from "zod";

import { DomainError } from "../core/errors.js";
import { formatMcpInstructions } from "../core/agent-instructions.js";
import {
  createTaskInputSchema,
  createTasksInputSchema,
  completeReviewInputSchema,
  submitForReviewInputSchema,
  getProjectStatusInputSchema,
  getTaskInputSchema,
  listTasksInputSchema,
  reviewFindingSchema,
  startReviewInputSchema,
  startTaskInputSchema,
  updateTaskInputSchema,
} from "../core/query-contract.js";
import {
  discoverProjectRoot,
  openProjectContext,
  resolveProjectRoot,
  resolveWorkspaceProjectRoot,
  type ProjectContext,
} from "../project/project-context.js";

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
  since: true,
});
const listTasksArgumentsSchema = listTasksInputSchema.omit({ projectId: true });
const taskArgumentsSchema = getTaskInputSchema.omit({ projectId: true });
const startTaskArgumentsSchema = startTaskInputSchema.omit({ projectId: true });
const updateTaskArgumentsSchema = updateTaskInputSchema.omit({ projectId: true });
const submitForReviewArgumentsSchema = submitForReviewInputSchema.omit({ projectId: true });
const startReviewArgumentsSchema = startReviewInputSchema.omit({ projectId: true });
const completeReviewArgumentsSchema = completeReviewInputSchema.omit({ projectId: true });
const reviewDecisionArgumentsSchema = completeReviewArgumentsSchema.omit({
  decision: true,
});
const requestChangesArgumentsSchema = reviewDecisionArgumentsSchema
  .omit({ verificationEvidence: true })
  .extend({ findings: z.array(reviewFindingSchema).min(1) });

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
    name: "submit_for_review",
    description:
      "Submit a running task for review with a completion summary and fixed commit SHA. The task changes to in_review and the runId becomes invalid after submission.",
    inputSchema: toJSONSchema(submitForReviewArgumentsSchema) as Tool["inputSchema"],
  },
  {
    name: "start_review",
    description:
      "Atomically claim the latest pending review and save the returned reviewRunId before inspecting the submitted artifact.",
    inputSchema: toJSONSchema(startReviewArgumentsSchema) as Tool["inputSchema"],
  },
  {
    name: "approve_review",
    description:
      "Pass the claimed review with a summary, structured findings, and verification evidence. The reviewRunId must own the current review; low-risk tasks may complete automatically while medium- and high-risk tasks wait for developer approval.",
    inputSchema: toJSONSchema(reviewDecisionArgumentsSchema) as Tool["inputSchema"],
  },
  {
    name: "request_changes",
    description:
      "Return the claimed review for rework with actionable feedback and structured findings. The reviewRunId must own the current review; the task returns to ready and requires a new execution runId.",
    inputSchema: toJSONSchema(requestChangesArgumentsSchema) as Tool["inputSchema"],
  },
  {
    name: "complete_review",
    description:
      "Record a passed or changes-requested AI review with structured findings and verification evidence. Low-risk passes may complete automatically; medium- and high-risk tasks remain for developer approval.",
    inputSchema: toJSONSchema(completeReviewArgumentsSchema) as Tool["inputSchema"],
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

export function createMcpServer(
  contextOrResolver: ProjectContext | (() => Promise<ProjectContext>),
): Server {
  const getContext =
    typeof contextOrResolver === "function"
      ? contextOrResolver
      : async () => contextOrResolver;

  const server = new Server(
    { name: "milestack", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: formatMcpInstructions(),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    await getContext();
    return {
      tools: toolDefinitions,
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const context = await getContext();
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
        case "submit_for_review": {
          const parsed = submitForReviewArgumentsSchema.parse(args);
          return jsonResult(
            context.service.submitForReview({
              ...parsed,
              projectId: context.project.id,
            }),
          );
        }
        case "start_review": {
          const parsed = startReviewArgumentsSchema.parse(args);
          return jsonResult(
            context.service.startReview({
              ...parsed,
              projectId: context.project.id,
            }),
          );
        }
        case "approve_review": {
          const parsed = reviewDecisionArgumentsSchema.parse(args);
          return jsonResult(
            context.service.completeReview({
              ...parsed,
              projectId: context.project.id,
              decision: "passed",
            }),
          );
        }
        case "request_changes": {
          const parsed = requestChangesArgumentsSchema.parse(args);
          return jsonResult(
            context.service.completeReview({
              ...parsed,
              projectId: context.project.id,
              decision: "changes_requested",
              verificationEvidence: [],
            }),
          );
        }
        case "complete_review": {
          const parsed = completeReviewArgumentsSchema.parse(args);
          return jsonResult(
            context.service.completeReview({
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

export type RunMcpOptions = {
  projectRoot?: string;
  discover?: boolean;
};

export async function runMcp(
  optionsOrProjectRoot: string | RunMcpOptions,
): Promise<void> {
  const options: RunMcpOptions =
    typeof optionsOrProjectRoot === "string"
      ? { projectRoot: optionsOrProjectRoot }
      : optionsOrProjectRoot;

  let currentContext: ProjectContext | undefined;

  if (!options.discover) {
    const projectRoot = options.projectRoot ?? resolveProjectRoot();
    currentContext = await openProjectContext(projectRoot);
    const server = createMcpServer(currentContext);
    const transport = new StdioServerTransport();
    transport.onclose = () => currentContext?.database.close();

    try {
      await server.connect(transport);
    } catch (error) {
      currentContext.database.close();
      throw error;
    }
    return;
  }

  // Discover mode:
  const envRoots = (process.env.WORKSPACE_DIRS || process.env.ANTIGRAVITY_WORKSPACE_DIRS)
    ?.split(/[:;,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  let initialProjectRoot: string;
  if (envRoots && envRoots.length > 0) {
    initialProjectRoot = resolveWorkspaceProjectRoot(envRoots);
  } else {
    initialProjectRoot = discoverProjectRoot();
  }

  currentContext = await openProjectContext(initialProjectRoot);

  let rootsValidationPromise: Promise<void> | undefined;

  const validateRoots = async (roots: readonly string[]): Promise<void> => {
    const newProjectRoot = resolveWorkspaceProjectRoot(roots);
    let canonicalNew = newProjectRoot;
    let canonicalCurrent = currentContext!.projectRoot;
    try {
      canonicalNew = realpathSync(newProjectRoot);
    } catch {}
    try {
      canonicalCurrent = realpathSync(currentContext!.projectRoot);
    } catch {}

    if (canonicalNew !== canonicalCurrent) {
      const oldContext = currentContext!;
      currentContext = await openProjectContext(newProjectRoot);
      oldContext.database.close();
    }
  };

  let server: Server;

  const ensureRootsValidated = async (): Promise<void> => {
    if (!rootsValidationPromise && server.getClientCapabilities()?.roots) {
      rootsValidationPromise = (async () => {
        const result = await server.listRoots();
        if (result?.roots && result.roots.length > 0) {
          const rootPaths = result.roots.map((r) => r.uri);
          await validateRoots(rootPaths);
        }
      })();
    }
    if (rootsValidationPromise) {
      await rootsValidationPromise;
    }
  };

  const getContext = async (): Promise<ProjectContext> => {
    await ensureRootsValidated();
    return currentContext!;
  };

  server = createMcpServer(getContext);

  const transport = new StdioServerTransport();
  transport.onclose = () => {
    currentContext?.database.close();
  };

  server.setNotificationHandler(InitializedNotificationSchema, async () => {
    if (server.getClientCapabilities()?.roots) {
      try {
        await ensureRootsValidated();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error validating workspace roots: ${message}\n`);
        transport.close();
      }
    }
  });

  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    if (server.getClientCapabilities()?.roots) {
      try {
        rootsValidationPromise = undefined;
        await ensureRootsValidated();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error validating workspace roots: ${message}\n`);
        transport.close();
      }
    }
  });

  try {
    await server.connect(transport);
  } catch (error) {
    currentContext.database.close();
    throw error;
  }
}
