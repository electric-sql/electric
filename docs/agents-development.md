# Electric Agents — Development Guide

## Package overview

The agents subsystem lives in five packages under `packages/`:

| Package                           | Description                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `agents-runtime`                  | Core runtime — entity definitions, context, handler lifecycle                         |
| `agents-server`                   | Orchestration server — wake registry, scheduling, Electric + Postgres integration     |
| `agents`                          | Built-in agents (Horton & Worker) with tools (bash, read, write, edit, fetch, search) |
| `agents-server-ui`                | React dashboard for agent monitoring and interaction                                  |
| `agents-server-conformance-tests` | Conformance test suite for agents-server                                              |

## Prerequisites

- **Docker Desktop** running (for Postgres + Electric)
- **Node.js** and **pnpm** (see `.tool-versions` for exact versions)
- **`.env` file** at the project root with at least `ANTHROPIC_API_KEY` (needed by built-in agents). Both entrypoints call `process.loadEnvFile()` on startup, loading from the current working directory — so always run entrypoints from the project root.

## Starting the dev environment

All commands below assume you are in the project root. All `pnpm dev` commands use `tsdown --watch` (or Vite for the UI) — they do an initial build then watch for changes. The build order matters because packages import from each other's `dist/`.

### Step 1 — Install dependencies and build workspace prerequisites

In a fresh checkout or worktree, workspace packages have no `dist/` directories. Agent packages depend on `@electric-sql/client` (the typescript-client) at runtime, so it must be built before starting any agent server.

```sh
pnpm install
pnpm -C packages/typescript-client build
```

### Step 2 — Start backing services (Postgres + Electric + Jaeger)

```sh
docker compose -f packages/agents-server/docker-compose.dev.yml up -d
```

The compose file keeps the historical defaults, but host ports can be
overridden with `PG_HOST_PORT`, `ELECTRIC_HOST_PORT`, `JAEGER_UI_PORT`,
`JAEGER_OTLP_HTTP_PORT`, and `JAEGER_OTLP_GRPC_PORT`. Use
`COMPOSE_PROJECT_NAME` (or `docker compose -p ...`) to isolate container names
and volumes across checkouts.

Services will be available at:

- PostgreSQL: `localhost:5432` (electric_agents/electric_agents)
- Electric API: `http://localhost:3060`
- Jaeger UI: `http://localhost:16686` (tracing)

### Step 3 — Build agents-runtime

`agents-server` and `agents` both depend on `agents-runtime`, so it must be built first.

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
  ELECTRIC_AGENTS_PULL_WAKE_RUNNER_ID=local-builtins \
  ELECTRIC_AGENTS_REGISTER_PULL_WAKE_RUNNER=1 \
  ELECTRIC_ASSERTED_AUTH_EMAIL=local-builtins@example.test \
  ELECTRIC_ASSERTED_AUTH_NAME="Local Built-ins" \
  node packages/agents/dist/entrypoint.js
```

`ELECTRIC_AGENTS_PULL_WAKE_RUNNER_ID` (or `PULL_WAKE_RUNNER_ID`) is required.
`ELECTRIC_AGENTS_REGISTER_PULL_WAKE_RUNNER=1` is useful for local development
when the runner has not already been registered. The asserted-auth variables are
optional and only needed when the agents-server is running with dev asserted auth.

The built-in agents entrypoint starts a pull-wake runner and auto-registers Horton and Worker entity types.

### Step 6 — Start the agents UI dashboard

```sh
pnpm -C packages/agents-server-ui dev
```

Vite dev server with HMR — changes appear instantly.

## Environment variables reference

### agents-server

| Variable                              | Default   | Description                                         |
| ------------------------------------- | --------- | --------------------------------------------------- |
| `DATABASE_URL`                        | —         | Postgres connection URL (required)                  |
| `ELECTRIC_AGENTS_ELECTRIC_URL`        | —         | Electric sync service URL                           |
| `ELECTRIC_AGENTS_HOST`                | `0.0.0.0` | Bind address                                        |
| `ELECTRIC_AGENTS_PORT`                | `4437`    | Server port                                         |
| `ELECTRIC_AGENTS_BASE_URL`            | —         | Public webhook base URL                             |
| `ELECTRIC_AGENTS_STREAMS_DATA_DIR`    | —         | Local streams data directory                        |
| `ELECTRIC_AGENTS_DURABLE_STREAMS_URL` | —         | External durable streams URL (omit to use embedded) |

### agents-desktop

| Variable                               | Default                        | Description                                                                                                                                                        |
| -------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ELECTRIC_DESKTOP_USER_DATA_DIR`       | Electron default userData path | Overrides the profile/settings directory. Set this before launch to run multiple desktop instances/checkouts without sharing settings or the single-instance lock. |
| `ELECTRIC_DESKTOP_SERVER_URL`          | —                              | Adds/selects this agents-server URL at startup. Takes precedence over `ELECTRIC_AGENTS_SERVER_URL`.                                                                |
| `ELECTRIC_AGENTS_SERVER_URL`           | —                              | Fallback startup server URL for desktop, and the required server URL for the standalone built-in agents package.                                                   |
| `ELECTRIC_DESKTOP_PULL_WAKE_RUNNER_ID` | persisted UUID                 | Runner id used by the desktop pull-wake registration.                                                                                                              |

### agents (built-in)

| Variable                                                      | Default | Description                                                                   |
| ------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `ELECTRIC_AGENTS_SERVER_URL`                                  | —       | agents-server URL (required)                                                  |
| `ELECTRIC_AGENTS_PULL_WAKE_RUNNER_ID` / `PULL_WAKE_RUNNER_ID` | —       | Pull-wake runner id (required)                                                |
| `ELECTRIC_AGENTS_REGISTER_PULL_WAKE_RUNNER`                   | —       | Set to `1`/`true` to register the local runner on startup                     |
| `ELECTRIC_ASSERTED_AUTH_EMAIL`                                | —       | Optional dev asserted-auth email; sent on runner registration and wake claims |
| `ELECTRIC_ASSERTED_AUTH_NAME`                                 | —       | Optional dev asserted-auth name; sent on runner registration and wake claims  |
| `ANTHROPIC_API_KEY`                                           | —       | Claude API key (required)                                                     |

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

## Teardown

```sh
docker compose -f packages/agents-server/docker-compose.dev.yml down    # stop services
docker compose -f packages/agents-server/docker-compose.dev.yml down -v  # stop + remove volumes
```

## Isolated manual pull-wake stack alongside another checkout

Use a unique compose project, host ports, server port, desktop profile, and
runner id. This example keeps a normal checkout on the defaults and starts an
isolated pull-wake stack on PostgreSQL `55432`, Electric `33060`, Jaeger UI
`16687`, and agents-server `4447`. Run from the isolated checkout root.

```sh
# Terminal A: backing services
COMPOSE_PROJECT_NAME=electric-agents-pull-wake \
PG_HOST_PORT=55432 \
ELECTRIC_HOST_PORT=33060 \
JAEGER_UI_PORT=16687 \
JAEGER_OTLP_HTTP_PORT=14318 \
JAEGER_OTLP_GRPC_PORT=14317 \
docker compose -f packages/agents-server/docker-compose.dev.yml up -d

# Terminal B/C/D: watch builds, as in the normal setup
pnpm -C packages/agents-runtime dev
pnpm -C packages/agents-server dev
pnpm -C packages/agents-desktop dev:ui

# Terminal E: isolated agents-server
DATABASE_URL=postgresql://electric_agents:electric_agents@localhost:55432/electric_agents \
ELECTRIC_AGENTS_ELECTRIC_URL=http://localhost:33060 \
ELECTRIC_AGENTS_PORT=4447 \
ELECTRIC_AGENTS_BASE_URL=http://127.0.0.1:4447 \
ELECTRIC_AGENTS_DEV_ASSERTED_AUTH=1 \
ELECTRIC_INSECURE=true \
node packages/agents-server/dist/entrypoint.js

# Terminal F: desktop A against the default stack
ELECTRIC_DESKTOP_USER_DATA_DIR="$PWD/.tmp/desktop-default" \
ELECTRIC_DESKTOP_SERVER_URL=http://127.0.0.1:4437 \
ELECTRIC_DESKTOP_PULL_WAKE_RUNNER_ID=manual-default-a \
ELECTRIC_DESKTOP_PULL_WAKE_REGISTER_RUNNER=1 \
ELECTRIC_ASSERTED_AUTH_EMAIL=desktop-a@example.test \
ELECTRIC_ASSERTED_AUTH_NAME="Desktop A" \
pnpm -C packages/agents-desktop start

# Terminal G: desktop B against the isolated stack
ELECTRIC_DESKTOP_USER_DATA_DIR="$PWD/.tmp/desktop-pull-wake" \
ELECTRIC_DESKTOP_SERVER_URL=http://127.0.0.1:4447 \
ELECTRIC_DESKTOP_PULL_WAKE_RUNNER_ID=manual-pull-wake-b \
ELECTRIC_DESKTOP_PULL_WAKE_REGISTER_RUNNER=1 \
ELECTRIC_ASSERTED_AUTH_EMAIL=desktop-b@example.test \
ELECTRIC_ASSERTED_AUTH_NAME="Desktop B" \
pnpm -C packages/agents-desktop start
```

If you also run `packages/agents` standalone for the isolated server, set
`ELECTRIC_AGENTS_SERVER_URL=http://127.0.0.1:4447` and use a unique
`ELECTRIC_AGENTS_PULL_WAKE_RUNNER_ID` (or `PULL_WAKE_RUNNER_ID`). Set
`ELECTRIC_AGENTS_REGISTER_PULL_WAKE_RUNNER=1` if the runner has not already
been registered.

Teardown for the isolated services:

```sh
COMPOSE_PROJECT_NAME=electric-agents-pull-wake \
docker compose -f packages/agents-server/docker-compose.dev.yml down -v
```
