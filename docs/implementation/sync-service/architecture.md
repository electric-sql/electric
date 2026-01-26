# Sync-Service Architecture

This document describes the system architecture of the ElectricSQL sync-service.

## Overview

The sync-service is an Elixir application that syncs PostgreSQL data to clients via HTTP. It uses PostgreSQL logical replication to capture changes and exposes them through a REST API with long-polling and Server-Sent Events (SSE) support.

## Core Concepts

### Shape

A **Shape** is the central abstraction - a filtered, immutable subset of a PostgreSQL table.

```elixir
%Shape{
  root_table: {"public", "users"},     # Table being synced
  root_table_id: 16384,                # PostgreSQL OID
  root_pk: ["id"],                     # Primary key columns
  where: %Expr{query: "age > 18"},     # Optional WHERE clause
  selected_columns: ["id", "name"],    # Columns to include
  replica: :default,                   # Replication mode
  shape_dependencies: []               # Subquery dependencies
}
```

**Key Properties**:

- **Immutable**: Same definition always produces same `shape_handle`
- **Deterministic**: Handle is a hash of the shape definition
- **HTTP-cacheable**: ETags based on handle + offset

### LogOffset

A **LogOffset** uniquely identifies each operation in the shape log.

```elixir
%LogOffset{
  tx_offset: 1234,    # Transaction LSN from PostgreSQL
  op_offset: 2        # Operation index within transaction
}
```

**Special Values**:

- `{-1, 0}` - Before all data (initial request)
- `{0, N}` - Virtual offset (snapshot chunks)
- `{LSN, N}` - Real offset (transaction data)

### Stack

A **Stack** represents one database connection with all its associated processes. In single-tenant mode, there's one stack per application.

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PostgreSQL                                   │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    WAL (Write-Ahead Log)                     │    │
│  └─────────────────────────────────────────────────────────────┘    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ Logical Replication (pgoutput)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ReplicationClient                               │
│  - Connects to PostgreSQL in replication mode                        │
│  - Decodes binary WAL messages                                       │
│  - Forwards events to ShapeLogCollector                              │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ TransactionFragment events
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     ShapeLogCollector                                │
│  - Central transaction router (GenServer)                            │
│  - Maintains shape subscriptions index                               │
│  - Routes changes to relevant shapes only                            │
│  - Tracks flush progress for backpressure                            │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ Filtered events per shape
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Consumer (per shape)                              │
│  - Receives events via ConsumerRegistry                              │
│  - Applies WHERE clause filtering                                    │
│  - Writes to Storage                                                 │
│  - Notifies HTTP clients of changes                                  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ JSON log entries
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Storage                                       │
│  - File-based (PureFileStorage) or in-memory                         │
│  - Chunked for CDN caching                                           │
│  - Crash-safe with atomic offset markers                             │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP response
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      HTTP Clients                                    │
│  - Initial sync (offset=-1): Snapshot + live changes                 │
│  - Catch-up (offset=N): Changes since N                              │
│  - Live (live=true): Long-poll or SSE stream                         │
└─────────────────────────────────────────────────────────────────────┘
```

## Supervision Tree

```
Electric.Application
├── AdmissionControl (rate limiting)
├── Registry (pub/sub)
└── StackSupervisor (per database)
    ├── ProcessRegistry (partitioned for scalability)
    ├── StackConfig (ETS-based config)
    ├── AsyncDeleter (cleanup)
    ├── Shape Changes Registry
    ├── Storage Backend
    ├── EtsInspector (schema cache)
    └── MonitoredCoreSupervisor
        └── Connection.Supervisor
            └── Connection.Manager (state machine)
                ├── ReplicationClient
                ├── Connection Pools (admin + snapshot)
                └── Shapes.Supervisor (started when ready)
                    ├── ShapeLogCollector
                    ├── PublicationManager
                    ├── DynamicConsumerSupervisor
                    │   └── Consumer + Snapshotter (per shape)
                    ├── ShapeCache
                    ├── SchemaReconciler
                    └── ExpiryManager
```

## Connection Manager State Machine

The `Connection.Manager` orchestrates database connectivity through phases:

```
                    ┌─────────────────────┐
                    │  connection_setup   │
                    └─────────┬───────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ start_repl_   │   │ start_conn_     │   │ start_shapes_   │
│ client        │   │ pool            │   │ supervisor      │
└───────┬───────┘   └────────┬────────┘   └────────┬────────┘
        │                    │                     │
        │  ┌─────────────────┴─────────────────┐   │
        │  │         All connections ready      │   │
        │  └─────────────────┬─────────────────┘   │
        │                    │                     │
        └────────────────────┼─────────────────────┘
                             ▼
                    ┌─────────────────────┐
                    │      running        │
                    │  (streaming WAL)    │
                    └─────────────────────┘
```

## Shape Lifecycle

### Creation Flow

```
1. Client Request: GET /v1/shape?table=users&where=age>18

2. API Layer:
   └── Shapes.Api.validate/2
       └── Parse parameters
       └── Create Shape struct
       └── ShapeCache.get_or_create_shape_handle/2

3. ShapeCache:
   └── ShapeStatus.add_shape/2
       └── Generate handle (hash of definition)
       └── Persist to ShapeDb
   └── DynamicConsumerSupervisor.start_shape_consumer/2

4. Consumer Init:
   └── Create storage writer
   └── Subscribe to ShapeLogCollector
   └── Start Snapshotter

5. Snapshotter:
   └── Run initial SELECT query
   └── Stream results to storage
   └── Mark snapshot complete

6. Consumer:
   └── Process ongoing transactions
   └── Filter by WHERE clause
   └── Write to storage
   └── Notify clients
```

### Termination Triggers

- **Schema Change**: Column added/removed/changed type
- **Manual Deletion**: DELETE /v1/shape request
- **Quota Exceeded**: ExpiryManager removes least-used shapes
- **Dependency Failed**: Parent shape in subquery was deleted

## HTTP API Layer

### Request Pipeline

```
Request
  │
  ▼
┌─────────────────────────────────────────────┐
│              Plug.Router                     │
│  1. RequestId - Generate unique ID           │
│  2. ServerHeader - Add version               │
│  3. RemoteIp - Extract client IP             │
│  4. Match - Route matching                   │
│  5. LabelProcessPlug - Debug labels          │
│  6. TraceContextPlug - Distributed tracing   │
│  7. Telemetry - Metrics                      │
│  8. Logger - Request logging                 │
│  9. Authenticate - Secret validation         │
│  10. CORS - Cross-origin headers             │
│  11. Dispatch - Forward to handler           │
└─────────────────────┬───────────────────────┘
                      ▼
┌─────────────────────────────────────────────┐
│           ServeShapePlug                     │
│  1. Fetch query params                       │
│  2. Start telemetry span                     │
│  3. Validate request                         │
│  4. Check admission control                  │
│  5. Serve shape response                     │
│  6. End telemetry span                       │
└─────────────────────────────────────────────┘
```

### Response Modes

| Mode         | Condition                  | Behavior                                   |
| ------------ | -------------------------- | ------------------------------------------ |
| Initial Sync | `offset=-1`                | Return full snapshot + up-to-date marker   |
| Catch-up     | `offset=N, live=false`     | Return changes since N, return immediately |
| Long-poll    | `offset=N, live=true`      | Wait for new changes, timeout after 20s    |
| SSE Stream   | `live=true, live_sse=true` | Keep connection open, stream events        |

## Storage Architecture

### PureFileStorage Layout

```
shapes/
└── {shape_handle}/
    ├── snapshot/
    │   ├── chunk_0.jsonl
    │   ├── chunk_1.jsonl
    │   └── ...
    ├── log/
    │   ├── log.latest.0.jsonfile.bin
    │   ├── log.latest.0.chunk.bin
    │   └── log.compacted.{N}.jsonfile.bin
    └── metadata/
        ├── version.bin
        ├── pg_snapshot.bin
        ├── last_persisted_txn_offset.bin
        ├── last_snapshot_chunk.bin
        └── shape_definition.json
```

### Two-Layer Buffering

```
Write Path:
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Consumer      │───▶│   ETS Buffer    │───▶│   Disk File     │
│   (append)      │    │   (64KB/1s)     │    │   (persistent)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘

Read Path:
┌─────────────────┐
│   Reader        │
│   (stream)      │
└────────┬────────┘
         │
         ├──▶ Disk (if offset <= last_persisted)
         │
         └──▶ ETS (if offset > last_persisted)
```

## Key Design Decisions

### Immutability

Shapes are immutable - same definition always produces same handle. This enables:

- HTTP caching with stable ETags
- CDN-friendly chunked responses
- Client-side caching

### Transactional Consistency

- Snapshot uses xmin/xmax isolation
- Changes only visible after PostgreSQL commit
- Consistent reads across shape lifecycle

### Scalability Patterns

- Partitioned registries (ProcessRegistry)
- Per-shape process isolation
- Admission control with separate limits
- Storage chunking for parallel reads

### Fault Tolerance

- OTP supervision with restart strategies
- Exponential backoff on connection errors
- Persistent state (replication slot, shape metadata)
- Atomic offset markers for crash recovery
