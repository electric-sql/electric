# AGENTS.md

ElectricSQL is an open-source Postgres sync engine. It syncs little subsets of your Postgres data into local apps and services.

- **Sync engine (Elixir):** Core sync-service that handles PostgreSQL logical replication and serves shape data over HTTP
- **TypeScript client:** Browser/Node client library for consuming shapes
- **React hooks:** React integration with TanStack Query
- **Elixir client:** Elixir client for consuming shapes server-side

See `docs/implementation/sync-service/architecture.md` for the deeper system diagram + flows.

---

## Setup commands

```bash
asdf install                    # Install correct Elixir/Node versions
pnpm install                    # Install JS dependencies
cd packages/sync-service
mix deps.get                    # Install Elixir dependencies
```

Start the dev environment:

```bash
cd packages/sync-service
mix start_dev                   # Starts Postgres + Electric
```

---

## Dev environment tips

### Check whether dev infrastructure is already running

**Before** starting `mix start_dev`, check:

```bash
# Are dev containers running?
docker ps | grep postgres

# Is Electric already running?
lsof -i :3000 || true
```

If you see Postgres running and port 3000 is bound, **don't start another instance**.

### Database requirements

- PostgreSQL 14+ with logical replication enabled
- `wal_level=logical` in PostgreSQL config
- User with REPLICATION role

---

## Testing instructions

Tests assume Postgres is running.

```bash
# 1) In terminal A (or use existing dev DB):
cd packages/sync-service && mix start_dev

# 2) In terminal B:
cd packages/sync-service && mix test
```

TypeScript packages:

```bash
pnpm test                       # Run all JS tests
pnpm -C packages/typescript-client test
pnpm -C packages/react-hooks test
```

---

## Repo map (where to look)

```
packages/
├── sync-service/           # Core Elixir sync engine (HTTP API, replication)
│   └── lib/electric/       # Main application code
├── typescript-client/      # @electric-sql/client (browser/Node)
├── react-hooks/            # @electric-sql/react (React + TanStack Query)
├── elixir-client/          # Elixir client library
├── experimental/           # Experimental features
├── start/                  # CLI starter tool
├── y-electric/             # Yjs CRDT integration
├── sqlite-sync/            # SQLite sync (experimental)
└── electric-telemetry/     # Telemetry utilities

examples/                   # 25+ example applications
├── tanstack-db-web-starter/  # Start here for TanStack DB examples
└── ...

website/                    # Documentation site (VitePress)
integration-tests/          # End-to-end tests (Lux framework)
```

---

## "Don't make me think" commands

```bash
pnpm format                 # Prettier for JS/TS
pnpm test                   # Run all JS tests
pnpm typecheck              # TypeScript type checking
```

Package-scoped examples:

```bash
pnpm -C packages/typescript-client test
pnpm -C packages/react-hooks build

cd packages/sync-service
mix deps.get
mix test
mix format
```

---

## How the system fits together (30 seconds)

```
PostgreSQL
    │
    ▼ (Logical Replication / pgoutput)
ReplicationClient
    │
    ▼
ShapeLogCollector (routes transactions to shapes)
    │
    ▼
Consumer (per-shape processing)
    │
    ▼
Storage (file-based: ETS buffer + disk)
    │
    ▼
HTTP API (Plug) → Clients (TypeScript/React/Elixir)
```

- **Shapes** are filtered subsets of a single Postgres table (with optional WHERE clause)
- **LogOffset** orders operations globally: `{tx_offset, op_offset}`
- Clients request shapes via HTTP, receive JSON changelog, apply to local state
- Write path: client → your API → Postgres → Electric streams change back

---

## Safety rules (read this before touching infra)

### Secrets

- **Never expose `DATABASE_URL` to clients** – Electric connects server-side
- **Proxy Electric in production** – add auth/tenant isolation at proxy layer

### Shapes

- **Shapes are immutable** – same definition always produces same handle
- **Single table only** – no joins in shape definitions
- **WHERE clauses** support subset of SQL (see `docs/implementation/sync-service/shapes.md`)

---

## Coding conventions

### TypeScript

- No semicolons (Prettier with `semi: false`)
- Use TypeScript strict mode
- Prefer small, composable modules

### Elixir

- Run `mix format` before committing
- Follow OTP conventions for GenServers and supervision trees
- Use typespecs for public functions
- See `docs/implementation/sync-service/code_conventions.md` for detailed patterns

---

## PR instructions

- Run `mix format` and `pnpm format` before opening a PR
- Run `mix test` and `pnpm test` to verify changes
- Commits: `type(scope): message` (e.g., `fix(sync-service): Fix bug`)

---

## Documentation maintenance

**IMPORTANT**: Always keep documentation in sync with code changes.

When modifying code that is covered by documentation in `docs/`:

1. **Check for related docs**: Before changing behavior or APIs, search `docs/` for references
2. **Update docs alongside code**: If your change affects documented behavior, update the relevant documentation in the same PR
3. **Document new features**: When adding significant functionality, add or update documentation

### Documentation index

| Document    | Description                                                  |
| ----------- | ------------------------------------------------------------ |
| `AGENTS.md` | Quick reference for AI agents and new developers (this file) |

#### sync-service (`packages/sync-service/`)

| Document                                                                    | Description                                |
| --------------------------------------------------------------------------- | ------------------------------------------ |
| [codebase_map.md](docs/implementation/sync-service/codebase_map.md)         | Repository structure, module organization  |
| [architecture.md](docs/implementation/sync-service/architecture.md)         | System design, data flow, supervision tree |
| [database.md](docs/implementation/sync-service/database.md)                 | PostgreSQL replication, storage layer      |
| [api.md](docs/implementation/sync-service/api.md)                           | HTTP endpoints, request/response formats   |
| [building.md](docs/implementation/sync-service/building.md)                 | Build setup, dependencies, Docker          |
| [testing.md](docs/implementation/sync-service/testing.md)                   | Test suites, running tests                 |
| [code_conventions.md](docs/implementation/sync-service/code_conventions.md) | Elixir style, patterns                     |
| [shapes.md](docs/implementation/sync-service/shapes.md)                     | Shape definition, WHERE clause evaluation  |
| [replication.md](docs/implementation/sync-service/replication.md)           | WAL decoding, message conversion           |
| [storage.md](docs/implementation/sync-service/storage.md)                   | File formats, buffering, compaction        |
| [http-api.md](docs/implementation/sync-service/http-api.md)                 | Router, admission control, streaming       |
| [connections.md](docs/implementation/sync-service/connections.md)           | Connection state machine, pools            |

#### typescript-client (`packages/typescript-client/`)

<!-- TODO: Run code-explorer agent to generate documentation -->

- `docs/implementation/typescript-client/` - Not yet documented

#### react-hooks (`packages/react-hooks/`)

<!-- TODO: Run code-explorer agent to generate documentation -->

- `docs/implementation/react-hooks/` - Not yet documented

#### elixir-client (`packages/elixir-client/`)

<!-- TODO: Run code-explorer agent to generate documentation -->

- `docs/implementation/elixir-client/` - Not yet documented

#### y-electric (`packages/y-electric/`)

<!-- TODO: Run code-explorer agent to generate documentation -->

- `docs/implementation/y-electric/` - Not yet documented

---

## Using Electric (for application developers)

For guidance on **using** Electric in your applications (as opposed to developing Electric itself), see the [tanstack-db-web-starter example](examples/tanstack-db-web-starter/AGENTS.md) which covers:

- Electric + TanStack DB integration patterns
- Proxy setup for auth/tenant isolation
- Shape configuration
- Optimistic mutations with txid handshake
- Live queries

### Quick reference

```ts
// Electric Collection (client-side)
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

export const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    shapeOptions: { url: '/api/todos' },
  })
)
```

---

## External references

- **Electric website**: https://electric-sql.com
- **Electric docs**: https://electric-sql.com/docs
- **TanStack DB**: https://tanstack.com/db
- **GitHub issues**: https://github.com/electric-sql/electric/issues
