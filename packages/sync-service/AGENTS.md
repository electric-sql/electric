# AGENTS.md – Electric Sync Service (Elixir)

> **Scope:** This file applies to `packages/sync-service` only.
> **Goal:** help agents work on the Elixir sync service reliably.

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

## Tests

- Unit tests live in `test/`; integration tests in `test/integration/`.
- Run a single file: `mix test test/path/to_test.exs`.
- Integration tests expect local docker services from `mix start_dev`.

## Boundaries (avoid editing/committing)

- Runtime or generated dirs: `_build/`, `deps/`, `persistent/`, `tmp/`, `log/`,
  `junit/`, `node_modules/`, `erl_crash.dump`.
- Do not commit real secrets; `.env.*` is for local dev only.

## Security/ops notes

- `ELECTRIC_INSECURE=true` is dev-only; prod requires `ELECTRIC_SECRET`.
- The HTTP API is public unless gated by external auth; be careful when
  changing `lib/electric/plug/*`.

