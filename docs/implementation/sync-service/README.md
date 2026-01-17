# Sync-Service Documentation

Comprehensive documentation for the ElectricSQL sync-service (`packages/sync-service`).

## Quick Start

If you're new to the codebase, read these documents in order:

1. **[codebase_map.md](codebase_map.md)** - Repository structure and key modules
2. **[architecture.md](architecture.md)** - System design, data flow, supervision trees
3. **[building.md](building.md)** - Setup, dependencies, running the service

## Document Index

### Overview Documents

| Document                                   | Description                                                   |
| ------------------------------------------ | ------------------------------------------------------------- |
| [codebase_map.md](codebase_map.md)         | Repository structure, module organization, tech stack         |
| [architecture.md](architecture.md)         | Core concepts (Shape, LogOffset), data flow, supervision tree |
| [database.md](database.md)                 | PostgreSQL replication, storage layer, recovery mechanisms    |
| [api.md](api.md)                           | HTTP endpoints, request/response formats, authentication      |
| [building.md](building.md)                 | Build setup, dependencies, Docker, troubleshooting            |
| [testing.md](testing.md)                   | Test suites, running tests, writing tests                     |
| [code_conventions.md](code_conventions.md) | Elixir style, patterns, commit messages                       |

### Implementation Deep Dives

Detailed code-level documentation with data structures, algorithms, and code snippets:

| Document                         | Focus Area                                                         |
| -------------------------------- | ------------------------------------------------------------------ |
| [shapes.md](shapes.md)           | Shape definition, WHERE clause evaluation, dependencies, lifecycle |
| [replication.md](replication.md) | WAL decoding, message conversion, transaction routing              |
| [storage.md](storage.md)         | File formats, buffering, compaction, crash recovery                |
| [http-api.md](http-api.md)       | Router, admission control, long-polling, SSE streaming             |
| [connections.md](connections.md) | Connection state machine, pools, timeline handling, shutdown       |

## Key Files to Read

When implementing new features, these are the most important source files:

### Core Architecture

- `lib/electric/application.ex` - Application entry point
- `lib/electric/stack_supervisor.ex` - Supervision tree setup
- `lib/electric/shapes/shape.ex` - Shape definition

### Replication Pipeline

- `lib/electric/postgres/replication_client.ex` - PostgreSQL logical replication
- `lib/electric/replication/shape_log_collector.ex` - Transaction routing
- `lib/electric/shapes/consumer.ex` - Per-shape processing

### HTTP Layer

- `lib/electric/plug/router.ex` - HTTP routing
- `lib/electric/plug/serve_shape_plug.ex` - Shape request handling
- `lib/electric/shapes/api.ex` - API business logic

### Storage

- `lib/electric/shape_cache/storage.ex` - Storage behaviour
- `lib/electric/shape_cache/pure_file_storage.ex` - File storage implementation

## Architecture Overview

```
PostgreSQL
    │
    ▼ (Logical Replication)
ReplicationClient
    │
    ▼
ShapeLogCollector (routes to shapes)
    │
    ▼
Consumer (per shape)
    │
    ▼
Storage (file-based)
    │
    ▼
HTTP API → Clients
```

## Quick Reference

### Shape Handle Format

```
{hash}-{microsecond_timestamp}
```

### Log Entry Format

```
<<tx_offset::64, op_offset::64, key_size::32, key::binary,
  op_type::8, flag::8, json_size::64, json::binary>>
```

### Connection Setup Steps

```
identify_system → query_pg_info → acquire_lock → create_publication →
create_slot → set_display_setting → ready_to_stream → streaming
```

## Common Development Tasks

### Adding a New Feature

1. Read [architecture.md](architecture.md) to understand the system
2. Check implementation docs for the relevant subsystem
3. Follow patterns in [code_conventions.md](code_conventions.md)
4. Add tests per [testing.md](testing.md)

### Debugging Issues

1. Check [building.md](building.md) for setup issues
2. Use telemetry/logging patterns from [code_conventions.md](code_conventions.md)
3. Understand data flow from [architecture.md](architecture.md)
4. Check implementation deep dives for code-level details

### Understanding the HTTP API

1. Read [api.md](api.md) for endpoint documentation
2. Check [http-api.md](http-api.md) for implementation details
3. Look at `lib/electric/shapes/api.ex` for business logic
