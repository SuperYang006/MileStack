# MileStack development guide

[English](development.md) | [简体中文](development.zh-CN.md) | [Back to README](../README.en.md)

This guide is for contributors and maintainers working on MileStack itself. If you want to install MileStack in another project, start with the [user guide](user-guide.md).

## Architecture

MileStack keeps business behavior behind one service boundary:

```text
CLI --------\
MCP ---------> TaskService -> repository interface -> SQLite implementation
HTTP -------/                                      \
                                                     -> React UI via HTTP only
```

- `src/core` owns domain schemas, errors, repository interfaces, and task behavior.
- `src/db` owns Drizzle schema, migrations, SQLite configuration, and repository implementations.
- `src/cli`, `src/mcp`, and `src/server` are transport adapters.
- `ui` talks to the HTTP API and does not import server or database modules.
- `tests` contains core, database, adapter, UI, and process-level integration coverage.

Task snapshot changes and `TaskEvent` appends happen in the same database transaction. CLI, MCP, and HTTP inputs reuse canonical operation schemas rather than implementing separate state transitions.

See the [technical design](technical-design.md) for the complete V0 architecture and the root [AGENTS.md](../AGENTS.md) for repository rules.

## Requirements

- Node.js 22 or newer
- pnpm 10
- Git

## Build from source

```bash
git clone git@github.com:SuperYang006/MileStack.git
cd MileStack
pnpm install
pnpm build
```

Run the built CLI directly from the checkout:

```bash
node dist/index.js --help
pnpm serve
```

`pnpm serve` uses the MileStack checkout as the managed project and serves the built Web UI at [http://127.0.0.1:7331](http://127.0.0.1:7331).

To manage another project with the development build:

```bash
node dist/index.js serve --project /absolute/path/to/project --port 7331
```

## Web UI development

Keep the API server and Vite running in separate terminals:

```bash
# Terminal 1
pnpm serve

# Terminal 2
pnpm dev:ui
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to the service on port `7331`.

- Frontend changes are hot-reloaded.
- After backend changes, run `pnpm build` and restart the API server.
- When testing the integrated UI at port `7331`, run `pnpm build:ui` and refresh after frontend changes.

## Test the installable package in isolation

To test what users will actually install, pack MileStack and install the tarball into a separate temporary or test project. Do not use a global development link for package-isolation testing.

```bash
cd /absolute/path/to/MileStack
pnpm pack

cd /absolute/path/to/test-project
# Run this only when the test project has no package.json:
npm init -y
npm install --save-dev /absolute/path/to/MileStack/milestack-<version>.tgz
./node_modules/.bin/milestack --help
./node_modules/.bin/milestack init --project "$PWD"
```

Convenient project-local scripts:

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

An npm script places the test project's `node_modules/.bin` first on `PATH`, so it keeps using the installed tarball even if another MileStack version is installed globally. Port `7332` also allows the test service to run beside source development on `7331`.

The installed tarball has its own `dist` and `dist/ui`. Rebuilding the source checkout does not update that copy. Repack, reinstall, and restart the test service after source changes.

### Refresh a tarball with the same version

`pnpm pack` runs the `prepack` checks before writing the tarball. Treat the pack as successful only when the command exits successfully and prints the tarball name.

```bash
cd /absolute/path/to/MileStack
pnpm pack
tar -xOf milestack-<version>.tgz package/package.json | grep '"version"'
tar -xOf milestack-<version>.tgz package/dist/ui/index.html | grep '<title>'
```

npm may keep an already installed copy when the version and tarball path are unchanged. Stop the test service, remove the dependency, reinstall, and restart:

```bash
cd /absolute/path/to/test-project
npm uninstall milestack
npm install --save-dev /absolute/path/to/MileStack/milestack-<version>.tgz
npm run milestack:serve
```

Repacking does not change `package.json.version`. Increment the version only when preparing a real release.

## Optional global development link

A global link can be convenient for manual development, but it is not isolated:

```bash
pnpm setup
# Open a new shell after setup.
pnpm link --global
milestack --help
```

The bare `milestack` command then runs `dist/index.js` from this checkout. Every project that uses that command shares the checkout's application build, although project databases remain separate.

Remove the link with:

```bash
pnpm remove --global milestack
which -a milestack
```

Removing the launcher does not delete the source checkout, project-local packages, or `.milestack` data.

## Verification commands

```bash
pnpm typecheck
pnpm typecheck:ui
pnpm test
pnpm build
```

Choose verification proportional to the change:

- documentation-only changes: check links, headings, and consistency;
- core or database changes: run type checking and focused core/database tests;
- MCP or CLI changes: run focused integration tests and a real process-level smoke test when practical;
- before completing implementation work: run `pnpm typecheck`, relevant tests, and `pnpm build`.

Tests use temporary projects and real SQLite databases when persistence or transaction behavior matters. Do not introduce a second test framework or scatter tests outside the root `tests/` directory.

## Local data and migrations

Development project data lives in `.milestack/` and must not be committed. Generated output, coverage reports, temporary databases, SQLite WAL files, and packaged tarballs are also not source artifacts.

Schema changes require forward migrations. Never require users to delete an existing database. Before applying a pending migration to a non-empty database, MileStack creates a backup in `.milestack/backups/`.

Keep SQLite write transactions short and do not perform network calls, file scans, or AI work inside a transaction.

## Package and release boundaries

The npm package is named `milestack` and exposes `dist/index.js` as its CLI. The published file allowlist contains the built CLI, migrations, and Web UI; source, tests, local project data, and repository instructions must stay out of the package.

Use `npm pack --dry-run --json` before release work. Publishing, Git tags, pushes, and GitHub releases are separate external changes and each requires explicit developer authorization.
