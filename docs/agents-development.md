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

| Variable                              | Default   | Description                                         |
| ------------------------------------- | --------- | --------------------------------------------------- |
| `DATABASE_URL`                        | —         | Postgres connection URL (required)                  |
| `ELECTRIC_AGENTS_ELECTRIC_URL`        | —         | Electric sync service URL                           |
| `ELECTRIC_AGENTS_HOST`                | `0.0.0.0` | Bind address                                        |
| `ELECTRIC_AGENTS_PORT`                | `4437`    | Server port                                         |
| `ELECTRIC_AGENTS_BASE_URL`            | —         | Public webhook base URL                             |
| `ELECTRIC_AGENTS_STREAMS_DATA_DIR`    | —         | Local streams data directory                        |
| `ELECTRIC_AGENTS_DURABLE_STREAMS_URL` | —         | External durable streams URL (omit to use embedded) |

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

## Teardown

```sh
docker compose -f packages/agents-server/docker-compose.dev.yml down    # stop services
docker compose -f packages/agents-server/docker-compose.dev.yml down -v  # stop + remove volumes
```
