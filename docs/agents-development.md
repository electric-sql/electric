# Electric Agents — Development Guide

## Package overview

The agents subsystem lives in seven packages under `packages/`:

| Package                           | Description                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `agents-runtime`                  | Core runtime — entity definitions, context, handler lifecycle                         |
| `agents-mcp`                      | MCP (Model Context Protocol) bridge library used by built-in agents                   |
| `agents-server`                   | Orchestration server — wake registry, scheduling, Electric + Postgres integration     |
| `agents`                          | Built-in agents (Horton & Worker) with tools (bash, read, write, edit, fetch, search) |
| `agents-server-ui`                | React dashboard for agent monitoring and interaction                                  |
| `agents-desktop`                  | Electron wrapper around `agents-server-ui` for a native desktop experience            |
| `agents-server-conformance-tests` | Conformance test suite for agents-server                                              |

## Prerequisites

- **Docker Desktop** running (for Postgres + Electric)
- **Node.js** and **pnpm** (see `.tool-versions` for exact versions)
- **`.env` file** at the project root with at least `ANTHROPIC_API_KEY` (needed by built-in agents). Both entrypoints call `process.loadEnvFile()` on startup, loading from the current working directory — so always run entrypoints from the project root.

## Quick start: `./scripts/dev.sh`

For day-to-day development, use the bundled dev script:

```sh
./scripts/dev.sh build       # one-shot install + build of all required packages
./scripts/dev.sh start       # docker + 5 dev processes; Ctrl-C to stop
./scripts/dev.sh start --detach        # same, but exits after spawning (logs to .dev-logs/)
./scripts/dev.sh start --with-agents   # also spawn built-in agents (Horton + Worker)
./scripts/dev.sh desktop     # run the Electron desktop app in this terminal
./scripts/dev.sh isolated    # run an isolated stack on random ports and
                             # open Electron desktop against it
./scripts/dev.sh stop        # stop processes + docker compose down
./scripts/dev.sh teardown    # stop + remove Postgres volume + .streams-data/
./scripts/dev.sh status      # show which services are running
```

`desktop` is a separate command because the Electron app is interactive — it opens a window. Run it in its own terminal after `start` has the rest of the stack up; Ctrl-C in that terminal closes the app without touching the backing services.

`isolated` is the one-command path for testing a worktree or PR without conflicting with another running stack. It chooses random free ports for Postgres, Electric, Jaeger, agents-server, built-in agents, server UI, and desktop UI; uses a branch-based Docker Compose project name (`agents-<branch-slug>`) so containers are easy to identify and clean up in Docker Desktop; sets an isolated durable-streams data directory and Electron user data directory per run; starts Horton/Worker by default; and opens the Electron desktop app. Ctrl-C tears the isolated stack down, including Docker volumes. Use `--no-build` to skip the initial package build or `--no-agents` to skip built-in agents.

`build` covers `typescript-client`, `agents-runtime`, `agents-mcp`, `agents-server`, and `agents`. Re-run it after any dep change before restarting — entrypoints do not auto-restart on `dist/` rebuilds.

**Built-in agents (`packages/agents`)** register against `agents-server` at startup and will fail with `Stream not found` if they race ahead of it. Pass `--with-agents` to `start` to spawn them after `agents-server` binds `:4437`. Without the flag, run them manually in a separate terminal once `start` reports the server is up — Ctrl-C in that terminal stops only the built-in agents:

```sh
ELECTRIC_AGENTS_SERVER_URL=http://localhost:4437 \
  node packages/agents/dist/entrypoint.js
```

The rest of this document describes the manual flow that the script automates.

## Starting the dev environment

All commands below assume you are in the project root. All `pnpm dev` commands use `tsdown --watch` (or Vite for the UI) — they do an initial build then watch for changes. The build order matters because packages import from each other's `dist/`.

### Step 1 — Install dependencies and build workspace prerequisites

In a fresh checkout or worktree, workspace packages have no `dist/` directories. The full dependency chain is `typescript-client` → `agents-mcp` → `agents-runtime` → (`agents-server`, `agents`), so the first two must be built before anything else.

```sh
pnpm install
pnpm -C packages/typescript-client build
pnpm -C packages/agents-mcp build
```

### Step 2 — Start backing services (Postgres + Electric + Jaeger)

```sh
docker compose -f packages/agents-server/docker-compose.dev.yml up -d
```

Services will be available at:

- PostgreSQL: `localhost:5432` (electric_agents/electric_agents)
- Electric API: `http://localhost:3060`
- Jaeger UI: `http://localhost:16686` (tracing)

### Step 3 — Build agents-runtime

`agents-runtime` depends on `agents-mcp` (built in Step 1), and both `agents-server` and `agents` depend on `agents-runtime`, so it must be built next.

```sh
pnpm -C packages/agents-runtime dev
# wait for "Build complete" before step 4
```

### Step 4 — Build agents-server and agents

These can be started in parallel once the runtime is built.

```sh
# Terminal 2:
pnpm -C packages/agents-server dev

# Terminal 3:
pnpm -C packages/agents dev
```

Wait for both "Build complete" messages before step 5.

### Step 5 — Start the server processes

Run entrypoints from the project root so they pick up the root `.env` file.

```sh
# Terminal 4: agents-server
DATABASE_URL=postgresql://electric_agents:electric_agents@localhost:5432/electric_agents \
  ELECTRIC_AGENTS_ELECTRIC_URL=http://localhost:3060 \
  ELECTRIC_INSECURE=true \
  node packages/agents-server/dist/entrypoint.js
```

The agents-server will start on `http://localhost:4437` with an embedded durable streams server.

```sh
# Terminal 5: built-in agents (Horton + Worker)
ELECTRIC_AGENTS_SERVER_URL=http://localhost:4437 \
  node packages/agents/dist/entrypoint.js
```

The built-in agents server starts on `http://localhost:4448` and auto-registers Horton and Worker entity types.

### Step 6 — Start the agents UI dashboard

```sh
pnpm -C packages/agents-server-ui dev
```

Vite dev server with HMR — changes appear instantly.

## Environment variables reference

### agents-server

| Variable                               | Default                          | Description                                            |
| -------------------------------------- | -------------------------------- | ------------------------------------------------------ |
| `DATABASE_URL`                         | —                                | Postgres connection URL (required)                     |
| `ELECTRIC_AGENTS_ELECTRIC_URL`         | —                                | Electric sync service URL                              |
| `ELECTRIC_AGENTS_HOST`                 | `0.0.0.0`                        | Bind address                                           |
| `ELECTRIC_AGENTS_PORT`                 | `4437`                           | Server port                                            |
| `ELECTRIC_AGENTS_BASE_URL`             | —                                | Public webhook base URL                                |
| `ELECTRIC_AGENTS_STREAMS_DATA_DIR`     | —                                | Local streams data directory                           |
| `ELECTRIC_AGENTS_DURABLE_STREAMS_URL`  | —                                | External durable streams URL (omit to use embedded)    |
| `ELECTRIC_AGENTS_PG_SYNC_ELECTRIC_URL` | `http://localhost:3000/v1/shape` | Electric shape URL used by the pgSync prototype bridge |

### agents (built-in)

| Variable                       | Default     | Description                  |
| ------------------------------ | ----------- | ---------------------------- |
| `ELECTRIC_AGENTS_SERVER_URL`   | —           | agents-server URL (required) |
| `ANTHROPIC_API_KEY`            | —           | Claude API key (required)    |
| `ELECTRIC_AGENTS_BUILTIN_HOST` | `127.0.0.1` | Bind address                 |
| `ELECTRIC_AGENTS_BUILTIN_PORT` | `4448`      | Server port                  |

## Running tests

```sh
# Runtime unit tests (no services needed)
cd packages/agents-runtime
pnpm test

# Server tests (requires Postgres + Electric via docker-compose.dev.yml)
cd packages/agents-server
pnpm test

# Built-in agents tests
cd packages/agents
pnpm test

# All with coverage
pnpm coverage  # in any agent package
```

## Iterating on agent packages

All agent packages use `tsdown` for building. The `pnpm dev` command in each starts a watch-mode rebuild, so changes are picked up automatically.

- **Runtime changes** (`agents-runtime`): Rebuild propagates to `agents-server` and `agents` since they depend on it via workspace links.
- **Server changes** (`agents-server`): Restart `node dist/entrypoint.js` after rebuild (watch mode rebuilds but does not restart the process).
- **Agent logic changes** (`agents`): Same — restart the entrypoint after rebuild.
- **UI changes** (`agents-server-ui`): Vite HMR — changes appear instantly.

## Working with examples

The `examples/deep-survey` example demonstrates a custom agent with its own entity types:

```sh
cd examples/deep-survey
pnpm install
pnpm dev  # starts both server (tsx watch) and UI (vite) in parallel
```

It requires the agents-server backing services (Postgres + Electric) to be running.

## Local state

- **Postgres** (docker volume) — entity types, entities, wake registrations, scheduling state.
- **Durable streams** — in-memory by default in dev. Data resets on server restart. Set `ELECTRIC_AGENTS_STREAMS_DATA_DIR` to persist streams to disk (uses lmdb + log files).

To clear all state: stop the servers and run `docker compose down -v` to remove the Postgres volume.

## Running a second instance (e.g. testing a PR branch)

If you already have one copy of the stack running (e.g. off `main`) and want a
parallel instance from a different branch, you need to isolate four things:
**Compose project name**, **backing-service ports**, **agents-server port**, and
**Electron app data**.

**Important:** You must use `-p <project-name>` with `docker compose` to give the
test instance a separate Compose project. Without it, Docker Compose identifies
the project by the directory name and will **replace** your main instance's
containers instead of creating new ones.

### 1 — Backing services on different ports

```sh
PG_HOST_PORT=5433 ELECTRIC_HOST_PORT=3061 \
  JAEGER_UI_PORT=16687 JAEGER_OTLP_HTTP_PORT=4319 JAEGER_OTLP_GRPC_PORT=4316 \
  docker compose -p agents-test -f packages/agents-server/docker-compose.dev.yml up -d
```

This gives you Postgres on `:5433`, Electric on `:3061`, and Jaeger on offset
ports — leaving the existing instance's `:5432` / `:3060` / `:4317-4318`
untouched. The `-p agents-test` flag ensures Docker treats this as a separate
project with its own containers, networks, and volumes.

### 2 — agents-server on a different port

```sh
DATABASE_URL=postgresql://electric_agents:electric_agents@localhost:5433/electric_agents \
  ELECTRIC_AGENTS_ELECTRIC_URL=http://localhost:3061 \
  ELECTRIC_AGENTS_PORT=4438 \
  ELECTRIC_INSECURE=true \
  node packages/agents-server/dist/entrypoint.js
```

### 3 — Built-in agents pointed at the new server

```sh
ELECTRIC_AGENTS_SERVER_URL=http://localhost:4438 \
  ELECTRIC_AGENTS_BUILTIN_PORT=4449 \
  node packages/agents/dist/entrypoint.js
```

### 4 — Electron desktop app with isolated data

```sh
ELECTRIC_DESKTOP_USER_DATA_DIR=/tmp/electric-agents-test \
  ELECTRIC_DESKTOP_SERVER_URL=http://localhost:4438 \
  ELECTRIC_DESKTOP_PRINCIPAL=system:dev-local \
  ELECTRIC_DESKTOP_UI_PORT=5184 \
  ELECTRIC_DESKTOP_DEV_SERVER_URL=http://localhost:5184 \
  pnpm -C packages/agents-desktop dev
```

`ELECTRIC_DESKTOP_USER_DATA_DIR` gives the second Electron instance its own
settings, secrets, and SQLite database. `ELECTRIC_DESKTOP_SERVER_URL` sets the
initial server URL so it connects to the test instance instead of discovering
the main one. `ELECTRIC_DESKTOP_PRINCIPAL=system:dev-local` is required when
the agents-server runs with `ELECTRIC_INSECURE=true` — without it, the server
auto-assigns principal `system:dev-local` but the desktop sends `owner_user_id`
as `local-desktop`, causing a 403 on pull-wake runner registration.
`ELECTRIC_DESKTOP_UI_PORT` changes the Vite dev server port (default `:5183`)
and `ELECTRIC_DESKTOP_DEV_SERVER_URL` tells the Electron main process where to
load the UI from.

### Port summary

| Component       | Main instance | Test instance               |
| --------------- | ------------- | --------------------------- |
| Postgres        | `:5432`       | `:5433`                     |
| Electric        | `:3060`       | `:3061`                     |
| Jaeger OTLP     | `:4317-4318`  | `:4316,4319`                |
| Jaeger UI       | `:16686`      | `:16687`                    |
| agents-server   | `:4437`       | `:4438`                     |
| built-in agents | `:4448`       | `:4449`                     |
| Electron data   | default       | `/tmp/electric-agents-test` |

### Teardown

```sh
docker compose -p agents-test -f packages/agents-server/docker-compose.dev.yml down -v
```

## Teardown

```sh
docker compose -f packages/agents-server/docker-compose.dev.yml down    # stop services
docker compose -f packages/agents-server/docker-compose.dev.yml down -v  # stop + remove volumes
```
