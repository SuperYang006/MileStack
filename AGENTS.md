# MileStack Agent Instructions

Before working on tasks, read and follow .milestack/agent-instructions.md

## Project intent

MileStack is a local-first project progress and task context database shared by developers and coding agents.

Before changing code, read the relevant parts of:

- `docs/requirements.md` for product scope;
- `docs/technical-design.md` for architecture and technology decisions;

Durable documentation is allowed and encouraged when it has lasting value, including
product requirements, technical designs, architecture decisions, protocols, migration
notes, and operation or user guides. Documents explicitly requested by the user are
also allowed.

`docs/bootstrap-tasks.md` is retained as implementation history for the self-bootstrap
period. Do not use it as a current task list or maintain dynamic progress there; all
current tasks, progress, blockers, next steps, and handoffs belong in MileStack.

## Working rules

- Implement only the assigned task and the smallest supporting changes required for it.
- Track work at the level of a meaningful, independently verifiable outcome, not at the level of individual file edits or lines changed.
- Do not create a separate MileStack task for typo or copy corrections, minor styling adjustments, read-only diagnosis, build or restart operations, or small supporting changes that already belong to an active task.
- A developer's explicit request for an immediate trivial change may be implemented directly without creating or claiming a MileStack task. Keep the change narrow and report the verification performed.
- Create a new inbox task when discovered work is an independent bug, feature, migration, or other outcome that falls outside the active task and benefits from its own acceptance criteria, prioritization, or handoff.
- When related work fits the objective and acceptance criteria of an active task, record it through that task's progress instead of fragmenting it into additional tasks.
- Do not add speculative features, abstractions, configuration, extension points, or compatibility layers.
- Preserve existing user and agent changes. Never rewrite unrelated files to make a local change easier.
- Prefer a small coherent implementation over a generic framework.
- If an architectural decision conflicts with the technical design, stop and explain the conflict instead of silently introducing a second pattern.
- Do not add a dependency when a small, clear implementation using the existing stack is sufficient.
- Delete superseded code after a refactor. Do not leave commented-out code, `old`/`new` duplicates, or temporary compatibility paths without a stated requirement.

## Project-specific Git delivery

- When review requests changes, add follow-up commits to the same task branch when practical. Do not rewrite published history.

### npm releases and Git tags

- Every published npm version must come from a clean, fixed Git commit.
- After a successful npm publish, create an annotated Git tag named `v<version>` on the exact commit used to build the published package. The tag version must match `package.json`.
- Never move, overwrite, or reuse a tag for a version that has already been published.
- npm publish, pushing `main`, pushing a Git tag, and creating a GitHub Release are separate external actions. Each requires explicit developer authorization.

## Architecture boundaries

Keep business behavior in one place:

```text
CLI --------\
MCP ---------> TaskService -> repository interface -> SQLite implementation
HTTP -------/
```

- `src/core` contains domain schemas, domain errors, repository interfaces, and `TaskService` behavior.
- `src/db` contains Drizzle schema, migrations, SQLite setup, and repository implementations.
- `src/mcp`, `src/cli`, and later `src/server` are adapters. They validate transport input, call `TaskService`, and map results or errors. They must not implement task state transitions or update task tables directly.
- `ui` talks to the HTTP API only. It must not import server or database modules.
- Dependency direction is inward: adapters may depend on core; core must not depend on MCP, Fastify, React, CLI libraries, or the concrete SQLite repository.
- Task snapshot changes and `TaskEvent` appends belong in one database transaction.
- Use one canonical Zod schema for each operation. Do not maintain separate, drifting CLI, MCP, and HTTP versions of the same input.

## Code organization

- Organize files by responsibility, not by arbitrary size or one-file-per-type rules.
- Do not create generic dumping grounds such as `utils.ts`, `helpers.ts`, or `common.ts`. Name shared modules after the behavior they own.
- Extract shared code only when there is a demonstrated second use or when extraction protects an architectural boundary.
- Keep public exports intentional. Avoid broad barrel exports that expose internal modules.
- Prefer explicit data flow and domain errors over hidden global state and string-matched errors.
- Avoid `any`, unchecked casts, `@ts-ignore`, and non-null assertions unless the safety reason is local and documented.
- Keep timestamps, IDs, paths, and SQLite serialization behind focused boundaries so tests can control them without mocking the entire application.
- Do not commit generated output, coverage reports, temporary databases, SQLite WAL files, or `.milestack` data.

## Testing policy

Tests exist to protect product facts and risky behavior, not to maximize test count or coverage percentage.

### Location and structure

- Put all tests under the root `tests/` directory. Do not place `*.test.ts`, `*.spec.ts`, `__tests__`, fixtures, or snapshots throughout `src/` or `ui/`.
- Organize `tests/` by capability, for example `tests/core`, `tests/db`, `tests/mcp`, and `tests/cli`.
- Prefer one test file per behavior area or workflow, not one test file per source file.
- Put genuinely shared test infrastructure in `tests/helpers`. Do not create a new fixture module for one test.

### What must be tested

Prioritize tests for behavior whose failure would make MileStack's project status untrustworthy:

- legal and illegal task state transitions;
- atomic task snapshot and event-history updates;
- concurrent task claiming and `runId` ownership;
- ready-queue ordering and inbox exclusion;
- database migration and preservation of existing data;
- MCP input/output contracts and one complete execution workflow;
- CLI initialization idempotency and protection of existing project files.

Bug fixes should add a focused regression test when the failure is deterministic and the test protects user-visible or data-integrity behavior.

### What should normally not be tested

Do not add tests merely for:

- TypeScript types or Zod behavior already owned by those libraries;
- trivial getters, constants, field mappings, or constructors;
- framework wiring that only forwards arguments to `TaskService`;
- private implementation details;
- visual styling, static markup, or snapshot output in V0;
- third-party library behavior;
- increasing coverage numbers.

There is no coverage-percentage target. Do not add low-value tests to satisfy a metric.

### Test design

- Prefer a real temporary SQLite database over mocking repositories for transaction and persistence behavior.
- Mock only external or nondeterministic boundaries such as time, ID generation, or process interaction, and only when deterministic injection is not simpler.
- Test public behavior and persisted results, not internal method call counts.
- Keep each test independent and deterministic. Use temporary directories and clean them through shared test helpers.
- Avoid large fixture graphs. Construct only the records relevant to the behavior under test.
- Do not introduce a second test framework, browser runner, or mocking library without a task that requires it.

## Verification discipline

Use verification proportional to the change:

- Documentation-only changes: check links, headings, and consistency; do not run unrelated test suites.
- Core or database changes: run type checking plus the focused core/database tests.
- MCP or CLI changes: run focused integration tests and a real process-level smoke test when practical.
- Before completing an implementation task: run `pnpm typecheck`, relevant tests, and `pnpm build`.

Do not repeatedly run the entire suite after every small edit. Fix focused failures first, then run the required task-level checks once the implementation is coherent.

Report the exact verification commands and results. Never claim a test passed if it was not run.

## Database and filesystem safety

- Never require deletion of an existing MileStack database to apply a schema change.
- Add forward migrations; do not edit migrations that may already have been applied.
- Create and verify a backup before a migration that changes an existing non-empty database.
- Keep SQLite write transactions short. Do not perform network calls, file scans, or AI work inside a transaction.
- `milestack init` must be idempotent and must not overwrite existing project files, Agent instructions, or client configuration. Without `--client`, it only prints generic MCP configuration and does not create project-level client files.
- With explicit `--client` selection, `init` may add missing project-level `milestack` entries only for the selected clients: `claude` -> `.mcp.json`, `cursor` -> `.cursor/mcp.json`, `grok` -> `.grok/config.toml`, `codex` -> `.codex/config.toml`, and `opencode` -> project-root `opencode.json`.
- `opencode` entries use the official top-level `mcp.milestack` shape (local stdio, `command` = `milestack mcp --project <absolute checkout path>`, `enabled` true, no `--discover`), carry `$schema` `https://opencode.ai/config.json` when the file is created, and leave `opencode.jsonc` untouched: when only `opencode.jsonc` exists, `init` prints the entry to add by hand instead of creating `opencode.json`. OpenCode merges the project file with `~/.config/opencode/opencode.json` and prefers the project entry for the same MCP service name, so the project file alone is sufficient.
- `init --client` must preserve unrelated project files, Agent instructions, and existing different `milestack` entries; it must never modify global client configuration such as `~/.claude.json`, `~/.cursor`, `~/.grok`, `~/.codex`, `~/.config/opencode`, or `~/.gemini`, and must not run `opencode mcp add`.
- Confirm that `--project` is the absolute path of the current checkout before writing. After a project file is written, reopen the corresponding client session; Codex project configuration requires a trusted repository and Claude `.mcp.json` still requires user approval.
- Any automatic edit to `.gitignore` must preserve its existing content and avoid duplicate entries.

## Scope restrictions for V0

Unless the assigned task explicitly changes scope, do not add:

- desktop packaging;
- cloud services or authentication;
- WebSocket or background synchronization;
- Agent identity, scoring, or capability profiles;
- automatic task planning or scheduling;
- Git activity tracking;
- generalized plugin systems;
- alternate databases or ORMs;
- UI component libraries before the V0 interface requires one.

## Tooling and repository navigation

- Use `rg` or `rg --files` for repository searches.
- If a `.codegraph/` directory exists, use CodeGraph before text search when locating symbols or understanding call paths.
- Use the package scripts defined by the repository instead of inventing parallel commands.
- Do not modify generated lockfiles manually; let the package manager update them.

## Completion report

At the end of a task, report only information useful to the next developer or Agent:

- what behavior was added or changed;
- important files changed;
- verification commands and results;
- material decisions or deviations;
- remaining blockers or follow-up work.

Do not create a new progress document for this report. During bootstrap, return it to the assigning conversation. After self-bootstrap, record semantic progress through MileStack.
