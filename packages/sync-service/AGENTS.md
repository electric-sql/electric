# AGENTS.md – Electric Sync Service (Elixir)

> **Scope:** This file applies to `packages/sync-service` only.
> **Goal:** help agents work on the Elixir sync service reliably.
> **Related:** for Electric client usage and system-wide guidance, see
> `../../AGENTS.md`.

## What this service is

Electric Sync is an Elixir service that tails Postgres logical replication and
serves "Shapes" over HTTP to clients. It is read-path only: it does not accept
write mutations; it streams subsets of Postgres tables defined by shapes.

## Major subsystems and interactions (high level)

- **HTTP API** (`lib/electric/plug/*`) serves shape requests and health checks.
- **Shapes** (`lib/electric/shapes/*`) define what data is included and manage
  shape lifecycle (creation, handles, checkpoints).
- **Replication** (`lib/electric/replication/*`) consumes WAL and produces
  change events for shapes.
- **Shape cache** (`lib/electric/shape_cache/*`) persists per-shape data and
  supports snapshot/changelog serving.
- **Postgres integration** (`lib/electric/postgres/*`, `lib/pg_interop/*`)
  handles connections, identifiers, and type handling.
- **Telemetry** (`lib/electric/telemetry/*`) emits metrics/traces.

Flow: HTTP request -> shape lookup/creation -> replication stream + cache ->
snapshot/changelog response streaming to client.

## Commands (run from this directory)

```sh
mix deps.get
mix format
mix test
mix start_dev   # docker compose in ./dev
mix stop_dev
mix reset       # clean + restart dev services
iex -S mix      # run service locally
```

## Project map

- `lib/electric/plug/` HTTP API + shape endpoints
- `lib/electric/replication/` logical replication pipeline
- `lib/electric/shapes/` shape lifecycle and spec
- `lib/electric/shape_cache/` storage and cleanup
- `lib/electric/telemetry/` OTEL + metrics
- `lib/pg_interop/` Postgres type helpers
- `config/runtime.exs` env-driven config and validation
- `dev/` docker compose + local dev utilities

## Environment + dev services

- Dev env is loaded from `.env.dev` (see `config/runtime.exs`).
- Test env is loaded from `.env.test`.
- `dev/docker-compose.yml` provides Postgres (54321), Postgres2 (54322),
  pgbouncer (65432), nginx (3002).

### Sprite VM

Docker bridge networking is not supported in Sprite (namespace creation is
blocked). Use the override file for host networking:

```sh
docker compose -f dev/docker-compose.yml -f dev/docker-compose.sprite.yml up -d
```

Or detect automatically in scripts:

```sh
if [ -e "/.sprite/api.sock" ]; then
  docker compose -f dev/docker-compose.yml -f dev/docker-compose.sprite.yml up -d
else
  docker compose -f dev/docker-compose.yml up -d
fi
```

## Tests

- Unit tests live in `test/`;
- Run a single file: `mix test test/path/to_test.exs`.
- Tests expect local docker services from `mix start_dev`.

### Writing tests

- Add higher-level coverage as appropriate (pick the level that best proves the change):
  - Router tests: `test/electric/plug/router_test.exs` and
    `test/electric/plug/low_privilege_router_test.exs` exercise the service as
    a whole.
  - Client integration tests: `test/integration/` uses an example client and
    is important when client logic is non-trivial (e.g., subqueries/tags).
  - System-level Lux tests live in `../../integration-tests/` and are slow but
    validate the full stack.

- Prefer a single assert with pattern matching for returned structures when it
  keeps the test clear; avoid multiple asserts on individual elements unless it
  improves readability.

```elixir
# Prefer a single, structural assert:
assert [
         %{key: ^expected_value1},
         %{key: ^expected_value2}
       ] = SomeModule.some_function()
```

## Boundaries (avoid editing/committing)

- Runtime or generated dirs: `_build/`, `deps/`, `persistent/`, `tmp/`, `log/`,
  `junit/`, `node_modules/`, `erl_crash.dump`.
- Do not commit real secrets; `.env.*` is for local dev only.

## Cross-package APIs

`Electric.Application` exposes APIs for embedding sync-service in other apps:

- `api/1` – returns a configured `Electric.Shapes.Api` for programmatic access;
  used by **elixir-client** (`packages/elixir-client`) for embedded mode.
- `api_plug_opts/1` – returns plug options for mounting the shapes router;
  used by **Phoenix.Sync** (external Hex package).
- `configuration/1` – returns full config for `StackSupervisor`.

These are marked `@doc false` but are required public APIs. Changes here can
break downstream consumers.

## Security/ops notes

- `ELECTRIC_INSECURE=true` is dev-only; prod requires `ELECTRIC_SECRET`.
- The HTTP API is public unless gated by external auth; be careful when
  changing `lib/electric/plug/*`.
