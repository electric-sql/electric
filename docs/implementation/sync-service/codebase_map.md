# Sync-Service Codebase Map

This document provides a comprehensive map of the ElectricSQL sync-service codebase structure.

## Repository Structure

```
packages/sync-service/
├── lib/
│   └── electric/
│       ├── application.ex              # Application entry point
│       ├── stack_supervisor.ex         # Core supervision tree
│       ├── shape_cache.ex              # Shape lifecycle management
│       ├── admission_control.ex        # Rate limiting
│       ├── lsn_tracker.ex              # LSN state management
│       ├── status_monitor.ex           # Health monitoring
│       │
│       ├── connection/                 # Database connection management
│       │   ├── manager.ex              # Connection state machine
│       │   └── supervisor.ex           # Connection supervision
│       │
│       ├── postgres/                   # PostgreSQL integration
│       │   ├── replication_client.ex   # Logical replication client
│       │   ├── inspector.ex            # Schema inspection
│       │   └── logical_replication/
│       │       └── decoder.ex          # WAL message decoder
│       │
│       ├── replication/                # Replication pipeline
│       │   ├── shape_log_collector.ex  # Central transaction router
│       │   ├── log_offset.ex           # Offset types and operations
│       │   ├── changes.ex              # Change event structures
│       │   └── eval/                   # WHERE clause evaluation
│       │
│       ├── shapes/                     # Shape domain
│       │   ├── shape.ex                # Shape definition
│       │   ├── consumer.ex             # Per-shape processor
│       │   ├── snapshotter.ex          # Initial snapshot logic
│       │   ├── supervisor.ex           # Shape subsystem supervision
│       │   └── api.ex                  # API business logic
│       │
│       ├── shape_cache/                # Storage layer
│       │   ├── storage.ex              # Storage behaviour
│       │   ├── pure_file_storage.ex    # File-based implementation
│       │   ├── in_memory_storage.ex    # Testing implementation
│       │   └── shape_status.ex         # Shape registry
│       │
│       └── plug/                       # HTTP layer
│           ├── router.ex               # Main router
│           └── serve_shape_plug.ex     # Shape endpoint handler
│
├── test/                               # Test files
├── config/                             # Configuration
├── mix.exs                             # Project definition
└── mix.lock                            # Dependency lock
```

## Key Modules by Domain

### Application Bootstrap

| File                               | Purpose                                         |
| ---------------------------------- | ----------------------------------------------- |
| `lib/electric/application.ex`      | Application entry point, configuration assembly |
| `lib/electric/stack_supervisor.ex` | Root supervisor for a database stack            |

### Connection Management

| File                                    | Purpose                          |
| --------------------------------------- | -------------------------------- |
| `lib/electric/connection/manager.ex`    | State machine for DB connections |
| `lib/electric/connection/supervisor.ex` | Connection process supervision   |

### PostgreSQL Replication

| File                                                   | Purpose                       |
| ------------------------------------------------------ | ----------------------------- |
| `lib/electric/postgres/replication_client.ex`          | Logical replication streaming |
| `lib/electric/postgres/logical_replication/decoder.ex` | Binary WAL message parsing    |
| `lib/electric/postgres/inspector.ex`                   | Table schema inspection       |

### Shape Processing

| File                                              | Purpose                         |
| ------------------------------------------------- | ------------------------------- |
| `lib/electric/shapes/shape.ex`                    | Shape definition and validation |
| `lib/electric/shapes/consumer.ex`                 | Per-shape event processor       |
| `lib/electric/shapes/snapshotter.ex`              | Initial data snapshot           |
| `lib/electric/replication/shape_log_collector.ex` | Transaction routing to shapes   |

### Storage

| File                                            | Purpose                      |
| ----------------------------------------------- | ---------------------------- |
| `lib/electric/shape_cache/storage.ex`           | Storage behaviour definition |
| `lib/electric/shape_cache/pure_file_storage.ex` | Production file storage      |
| `lib/electric/shape_cache/shape_status.ex`      | Shape registry persistence   |

### HTTP API

| File                                    | Purpose                     |
| --------------------------------------- | --------------------------- |
| `lib/electric/plug/router.ex`           | HTTP routing and middleware |
| `lib/electric/plug/serve_shape_plug.ex` | Shape request handling      |
| `lib/electric/shapes/api.ex`            | API business logic          |

## Tech Stack

- **Language**: Elixir 1.17+
- **HTTP Server**: Bandit (default) or Plug.Cowboy
- **Database**: PostgreSQL 14+ with logical replication
- **Storage**: File-based with CubDB for metadata
- **Telemetry**: OpenTelemetry, Prometheus metrics

## Module Dependencies (Simplified)

```
Application
    └── StackSupervisor
            ├── ProcessRegistry
            ├── StackConfig
            ├── Connection.Supervisor
            │       ├── Connection.Manager
            │       │       ├── ReplicationClient
            │       │       └── Connection Pools
            │       └── Shapes.Supervisor
            │               ├── ShapeLogCollector
            │               ├── ShapeCache
            │               └── DynamicConsumerSupervisor
            │                       └── Consumer (per shape)
            └── HTTP Server (Bandit)
                    └── Router
                            └── ServeShapePlug
```
