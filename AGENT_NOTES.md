# Electric Go Reimplementation — Agent Notes

> Progressive disclosure document. Jump to the section relevant to your assigned component.
> Read §1 (Context) first. Then read only the section for your component.

---

## Table of Contents

- [1. Context](#1-context) — **READ THIS FIRST**
- [2. Component Index](#2-component-index) — find your component
- [3. Tier 0 Components](#3-tier-0-components)
  - [3.A LogOffset](#3a-logoffset)
  - [3.B KeyFormat](#3b-keyformat)
  - [3.C ColumnParser](#3c-columnparser)
  - [3.D ETagComputer](#3d-etagcomputer)
  - [3.E CursorGenerator](#3e-cursorgenerator)
  - [3.F CacheHeaders](#3f-cacheheaders)
  - [3.G SchemaHeader](#3g-schemaheader)
- [4. Tier 1 Components](#4-tier-1-components)
  - [4.H WireProtocol](#4h-wireprotocol)
  - [4.I WhereParser](#4i-whereparser)
  - [4.J StorageInterface + MemoryStorage](#4j-storageinterface--memorystorage)
  - [4.K PgConnector](#4k-pgconnector)
- [5. Tier 2 Components](#5-tier-2-components)
  - [5.L ChangeFilter](#5l-changefilter)
  - [5.M SnapshotQuery](#5m-snapshotquery)
  - [5.N ReplicationClient](#5n-replicationclient)
  - [5.O SQLiteStorage](#5o-sqlitestorage)
- [6. Tier 3 Components](#6-tier-3-components)
  - [6.P ShapeRegistry](#6p-shaperegistry)
  - [6.Q Consumer](#6q-consumer)
  - [6.R ShapeLogCollector](#6r-shapelogcollector)
- [7. Tier 4 Components](#7-tier-4-components)
  - [7.S HTTPRouter](#7s-httprouter)
  - [7.T ServeShape](#7t-serveshape)
  - [7.U LiveMode](#7u-livemode)
- [8. Cross-Cutting Concerns](#8-cross-cutting-concerns)

---

## 1. Context

**READ THIS SECTION REGARDLESS OF WHICH COMPONENT YOU ARE BUILDING.**

### 1.1 What is Electric?

Electric is a sync engine that sits between PostgreSQL and HTTP clients. It allows clients to synchronize subsets ("shapes") of a PostgreSQL database over HTTP.

Data flow: `PostgreSQL WAL → Electric → HTTP → Client`

Electric is **read-only** — it never writes to the database.

### 1.2 What is a Shape?

A shape is a subset of one table, defined by:
- `table`: schema-qualified table name (e.g., `public.users`)
- `where`: optional SQL WHERE clause to filter rows
- `columns`: optional list of columns to include
- `replica`: `default` or `full` (controls update/delete content)

### 1.3 What is the Sync Protocol?

1. Client sends `GET /v1/shape?table=users&offset=-1` → receives snapshot (all matching rows as `insert` operations)
2. Client sends `GET /v1/shape?table=users&offset=X&handle=H` → receives log of changes since offset X
3. Client sends `GET /v1/shape?table=users&offset=X&handle=H&live=true` → server holds request until new data or timeout (long-poll)

Each response is a JSON array of log items (data messages + control messages).

### 1.4 What are we building?

A Go reimplementation of the Electric sync service. The implementation must be API-compatible with the existing TypeScript client tests.

**Removed features** (not in scope):
- Server-Sent Events (SSE)
- Subset queries (ORDER BY/LIMIT/OFFSET)
- Move tags / subquery shapes / shape dependencies
- Log compaction
- Admission control
- Idle connection timeout
- Multi-tenancy

### 1.5 Project Structure

```
electric-go/
├── cmd/electric/main.go
├── pkg/
│   ├── offset/       # A. LogOffset
│   ├── key/          # B. KeyFormat
│   ├── columns/      # C. ColumnParser
│   ├── etag/         # D. ETagComputer
│   ├── cursor/       # E. CursorGenerator
│   ├── cache/        # F. CacheHeaders
│   ├── schema/       # G. SchemaHeader
│   ├── wire/         # H. WireProtocol
│   ├── where/        # I. WhereParser
│   ├── storage/      # J+O. Storage
│   ├── postgres/     # K. PgConnector
│   ├── filter/       # L. ChangeFilter
│   ├── snapshot/     # M. SnapshotQuery
│   ├── replication/  # N. ReplicationClient
│   ├── registry/     # P. ShapeRegistry
│   ├── consumer/     # Q. Consumer
│   ├── collector/    # R. ShapeLogCollector
│   └── http/         # S+T+U. HTTP layer
├── go.mod
└── go.sum
```

### 1.6 Coding Conventions

- Use Go stdlib conventions: exported types/functions start with uppercase
- Error handling: return `error`, don't panic
- Tests: use `testing` package + `testify/assert` for assertions
- Table-driven tests preferred
- Test files: `*_test.go` alongside source
- Every exported function must have a test
- Port existing Elixir tests first, then add new edge cases
- Reference source test file in comments: `// Ported from: test/electric/replication/log_offset_test.exs`

### 1.7 Go Dependencies

```
github.com/jackc/pgx/v5          # PostgreSQL
github.com/pganalyze/pg_query_go # SQL parser
modernc.org/sqlite                # Pure Go SQLite
github.com/stretchr/testify       # Test assertions
```

### 1.8 Key Data Types (cross-component)

These types are defined in their respective packages but used everywhere:

```go
// pkg/offset/offset.go
type LogOffset struct {
    TxOffset int64
    OpOffset int
}

// pkg/wire/protocol.go
type Operation string // "insert", "update", "delete"
type ReplicaMode string // "default", "full"
type LogItem struct {
    Offset LogOffset
    Key    string
    Op     Operation
    JSON   []byte
}

// pkg/storage/interface.go
type PgSnapshot struct {
    Xmin       int64
    Xmax       int64
    XipList    []int64
    FilterTxns bool
}
```

### 1.9 Testing Philosophy

Every component is tested at three levels:

1. **Unit**: isolated, mock all external dependencies
2. **Compositional**: wire 2+ real components together (use MemoryStorage instead of SQLite, mock PG)
3. **System**: full stack with real PG (existing TypeScript tests)

You MUST write comprehensive unit tests. You SHOULD write compositional tests if your component has interfaces it consumes.

The MemoryStorage (built in Tier 1) is the primary compositional test tool — it replaces SQLite without any I/O, making tests fast and deterministic.

### 1.10 Elixir Source Reference

The original implementation is at `packages/sync-service/lib/electric/`. Tests are at `packages/sync-service/test/electric/`. When porting tests, read the Elixir test file to understand the intent, then write idiomatic Go table-driven tests.

---

## 2. Component Index

Find your assigned component and jump to that section.

| ID | Component | Section | Package | Tier | Dependencies |
|----|-----------|---------|---------|------|--------------|
| A | LogOffset | [3.A](#3a-logoffset) | `pkg/offset` | 0 | none |
| B | KeyFormat | [3.B](#3b-keyformat) | `pkg/key` | 0 | none |
| C | ColumnParser | [3.C](#3c-columnparser) | `pkg/columns` | 0 | none |
| D | ETagComputer | [3.D](#3d-etagcomputer) | `pkg/etag` | 0 | none |
| E | CursorGenerator | [3.E](#3e-cursorgenerator) | `pkg/cursor` | 0 | none |
| F | CacheHeaders | [3.F](#3f-cacheheaders) | `pkg/cache` | 0 | none |
| G | SchemaHeader | [3.G](#3g-schemaheader) | `pkg/schema` | 0 | none |
| H | WireProtocol | [4.H](#4h-wireprotocol) | `pkg/wire` | 1 | A, B |
| I | WhereParser | [4.I](#4i-whereparser) | `pkg/where` | 1 | none |
| J | StorageInterface | [4.J](#4j-storageinterface--memorystorage) | `pkg/storage` | 1 | A |
| K | PgConnector | [4.K](#4k-pgconnector) | `pkg/postgres` | 1 | none |
| L | ChangeFilter | [5.L](#5l-changefilter) | `pkg/filter` | 2 | I, H |
| M | SnapshotQuery | [5.M](#5m-snapshotquery) | `pkg/snapshot` | 2 | K, I, C |
| N | ReplicationClient | [5.N](#5n-replicationclient) | `pkg/replication` | 2 | K, A |
| O | SQLiteStorage | [5.O](#5o-sqlitestorage) | `pkg/storage` | 2 | J, H, A |
| P | ShapeRegistry | [6.P](#6p-shaperegistry) | `pkg/registry` | 3 | A, O/J |
| Q | Consumer | [6.Q](#6q-consumer) | `pkg/consumer` | 3 | L, M, O, P |
| R | ShapeLogCollector | [6.R](#6r-shapelogcollector) | `pkg/collector` | 3 | N, P, L |
| S | HTTPRouter | [7.S](#7s-httprouter) | `pkg/http` | 4 | all |
| T | ServeShape | [7.T](#7t-serveshape) | `pkg/http` | 4 | P, O, D-H |
| U | LiveMode | [7.U](#7u-livemode) | `pkg/http` | 4 | T, R |

---

## 3. Tier 0 Components

These have zero dependencies. Pure data types and pure functions.

### 3.A LogOffset

**Package**: `pkg/offset`
**Elixir source**: `lib/electric/replication/log_offset.ex`
**Elixir tests**: `test/electric/replication/log_offset_test.exs`

A LogOffset identifies a position in a shape's operation log. Format: `{TxOffset}_{OpOffset}`.

- `TxOffset`: int64 derived from PostgreSQL LSN
- `OpOffset`: int, position within transaction

**Special values**:
| Name | TxOffset | OpOffset | String |
|------|----------|----------|--------|
| BeforeAll | -1 | 0 | `"-1"` |
| First | 0 | 0 | `"0_0"` |
| LastBeforeReal | 0 | MaxInt | not serialized, internal only |

**Parse rules**:
- `"-1"` → BeforeAll
- `"0_0"` → First
- `"{tx}_{op}"` → LogOffset{tx, op}
- Anything else → error

**Comparison**: lexicographic. A < B if A.TxOffset < B.TxOffset, or if equal, A.OpOffset < B.OpOffset.

**Key detail**: when a PK change occurs, the insert gets offset = delete offset incremented by 1 in OpOffset. So `Increment(offset)` → `{offset.TxOffset, offset.OpOffset + 1}`.

---

### 3.B KeyFormat

**Package**: `pkg/key`
**Elixir source**: `lib/electric/shapes/querying.ex` (key building functions)
**Elixir tests**: `test/electric/shapes/shape_test.exs` (search for "key")

The key uniquely identifies a record. Format:

```
"<schema>"."<table>"/"<pk1>"/"<pk2>"
```

- Schema and table are double-quoted
- PK values are separated by `/`
- `/` within a PK value is escaped as `//`
- NULL is represented as empty string

Example: `"public"."users"/"42"` for table `public.users` with PK id=42.

---

### 3.C ColumnParser

**Package**: `pkg/columns`
**Elixir source**: `lib/electric/plug/utils.ex` (parse_columns_param)
**Elixir tests**: `test/electric/plug/utils_test.exs`

Parses comma-separated column names from the `columns` query parameter.

Rules:
- Unquoted names → lowercased (`FoO` → `foo`)
- Quoted names → preserve case (`"FoO"` → `FoO`)
- Double quotes escaped by doubling (`"has""q"` → `has"q`)
- Commas inside quotes are part of the name
- Empty identifiers are invalid

---

### 3.D ETagComputer

**Package**: `pkg/etag`
**Elixir source**: `lib/electric/shapes/api/response.ex` (etag function)

Format: `"{handle}:{reqOffset}:{respOffset}"`

For no-change live responses: `"{handle}:{reqOffset}:{respOffset}:{monotonic}"` where monotonic is a nanosecond timestamp that ensures uniqueness.

`If-None-Match` parsing: split by `,`, trim whitespace and `"` from each value.

---

### 3.E CursorGenerator

**Package**: `pkg/cursor`
**Elixir source**: `lib/electric/plug/utils.ex` (get_next_interval_timestamp)

The cursor is a cache-busting value for live requests.

```
epoch = 2024-10-09T00:00:00Z
diff = now_utc - epoch (in seconds)
interval = long_poll_timeout_ms / 1000
cursor = ceil(diff / interval) * interval
if cursor == prev_cursor: cursor += rand(1..3600)
if interval == 0: cursor = 0
```

---

### 3.F CacheHeaders

**Package**: `pkg/cache`
**Elixir source**: `lib/electric/shapes/api/response.ex` (put_cache_headers)

Maps response type to `cache-control` and `surrogate-control` header values.

| Response Type | cache-control |
|---------------|---------------|
| Initial sync (offset=-1) | `public, max-age=604800, s-maxage=3600, stale-while-revalidate=2629746` |
| Catch-up (non-live) | `public, max-age={MaxAge}, stale-while-revalidate={StaleAge}` |
| Live | `public, max-age=5, stale-while-revalidate=5` |
| 409 with handle | `public, max-age=60, must-revalidate` |
| 409 no handle | `public, max-age=1, must-revalidate` |
| 4xx/5xx | `no-store` + surrogate: `no-store` |
| Non-GET method | `no-cache` |

Defaults: MaxAge=60, StaleAge=300. Configurable. Can be globally disabled.

---

### 3.G SchemaHeader

**Package**: `pkg/schema`
**Elixir source**: `lib/electric/schema.ex`

The `electric-schema` response header is a JSON object mapping column names to type descriptors.

```json
{
  "id": {"type": "int4", "pk_index": 0, "not_null": true},
  "name": {"type": "text"},
  "tags": {"type": "text", "dims": 1}
}
```

Fields: `type` (always), `pk_index` (if PK), `not_null` (if true), `dims` (if array), `max_length` (varchar), `length` (char/bit), `precision`, `scale`, `fields` (interval), `type_mod`.

Zero-value fields are omitted from JSON.

---

## 4. Tier 1 Components

### 4.H WireProtocol

**Package**: `pkg/wire`
**Elixir source**: `lib/electric/log_items.ex`
**Elixir tests**: `test/electric/log_items_test.exs`
**Depends on**: A.LogOffset, B.KeyFormat

Encodes change records into the JSON format sent to clients. Each log item is pre-serialized as `[]byte` at write time (storage stores bytes, HTTP sends bytes directly).

**Data message format**:
```json
{
  "key": "\"public\".\"users\"/\"42\"",
  "value": {"id": "42", "name": "Alice"},
  "headers": {
    "operation": "insert",
    "relation": ["public", "users"],
    "txids": [12345],
    "lsn": "2847364",
    "op_position": 0
  }
}
```

**Operations**:
- `insert`: value = full record
- `update` (default): value = PKs + changed columns
- `update` (full): value = full new record, old_value = changed columns with old values
- `delete` (default): value = PKs only
- `delete` (full): value = full old record
- PK change: delete(old_key, key_change_to=new_key) + insert(new_key, key_change_from=old_key)

**Control message**: `{"headers": {"control": "up-to-date", "global_last_seen_lsn": "123"}}`

**Important**: all values are strings (PostgreSQL text format), except `int2`/`int4` (JSON number), `bool` (JSON boolean), `json`/`jsonb` (parsed JSON), arrays (JSON arrays), and NULL (JSON null). `int8` is a string because JavaScript can't handle 64-bit integers.

---

### 4.I WhereParser

**Package**: `pkg/where`
**Elixir source**: `lib/electric/replication/eval/parser.ex`, `lib/electric/replication/eval/env/known_functions.ex`, `lib/electric/replication/eval/runner.ex`
**Elixir tests**: `test/electric/replication/eval/` (all files)
**Depends on**: standalone (uses `pg_query_go`)

**This is the largest and most complex component.**

It must:
1. Parse a WHERE clause string into a PostgreSQL AST (via `pg_query_go`)
2. Type-check the AST against known column types
3. Resolve operator/function overloads
4. Build an evaluable expression tree
5. Evaluate the tree against a record (map[string]any → bool)
6. Normalize the query back to canonical SQL (for storage/comparison)

**Supported types**: `bool`, `int2`, `int4`, `int8`, `float4`, `float8`, `numeric`, `text`, `varchar`, `date`, `time`, `timestamp`, `timestamptz`, `interval`, `uuid`, `bytea`, `jsonb`, enums, arrays of any supported type.

**Supported operators**: see RFC §2.1.2.3 (comparison, boolean, numeric, string/pattern, array, range/set).

**Supported functions**: see RFC §2.1.2.4.

**Parameterized queries**: `$1`, `$2` etc. with type inference from context. Parameters always provided as strings, cast to appropriate type.

**Key design decision for Go**: the Elixir implementation builds an AST of closures. In Go, use an interface-based approach:

```go
type ExprNode interface {
    Eval(record map[string]any) (any, error)
    Type() PgType
}

type FuncNode struct {
    Name string
    Args []ExprNode
    Impl func(args ...any) (any, error)
    ReturnType PgType
    Strict bool
}
```

**Null handling**: strict functions return nil if any arg is nil. Non-strict functions (AND, OR, IS NULL, etc.) handle nil explicitly: `nil OR true → true`, `nil AND false → false`.

**Constant folding**: if all arguments to an immutable function are constants, evaluate at parse time.

---

### 4.J StorageInterface + MemoryStorage

**Package**: `pkg/storage`
**Elixir source**: `lib/electric/shape_cache/storage.ex`
**Depends on**: A.LogOffset

Define the Go interfaces and build the in-memory implementation.

**Key interfaces**:
```go
type ShapeStorage interface {
    FetchLatestOffset() (LogOffset, error)
    SnapshotStarted() bool
    GetLogStream(since, upTo LogOffset) iter.Seq[[]byte]
    GetChunkEndOffset(offset LogOffset) *LogOffset
    FetchPgSnapshot() (*PgSnapshot, error)
    MakeNewSnapshot(rows iter.Seq[[]byte]) error
    MarkSnapshotAsStarted() error
    SetPgSnapshot(snap PgSnapshot) error
    AppendToLog(items []LogItem) error
    Cleanup() error
}
```

**MemoryStorage**: implements ShapeStorage using Go slices and maps. This is a first-class component, not just a test helper. It must be correct and thread-safe.

**Chunk boundary rule**: when cumulative byte size of items in current chunk >= threshold (default 10MB), create a boundary at that offset.

**GetLogStream**: returns items where `since < item.offset <= upTo`. Exclusive on since, inclusive on upTo.

---

### 4.K PgConnector

**Package**: `pkg/postgres`
**Elixir source**: `lib/electric/postgres.ex`, `lib/electric/postgres/replication_client/connection_setup.ex`
**Depends on**: standalone (uses `jackc/pgx`)

Two connection types:
1. **Standard pool** (`pgxpool.Pool`): for snapshot queries, schema introspection, publication management
2. **Replication connection**: uses pgx replication mode for WAL streaming

**Display settings** (MUST be set on every connection before any query):
```sql
SET bytea_output = 'hex';
SET DateStyle = 'ISO, DMY';
SET TimeZone = 'UTC';
SET extra_float_digits = 1;
SET IntervalStyle = 'iso_8601';
```

Use pgxpool's `AfterConnect` hook to set these automatically.

---

## 5. Tier 2 Components

### 5.L ChangeFilter

**Package**: `pkg/filter`
**Elixir source**: `lib/electric/shapes/shape.ex` (convert_change function)
**Elixir tests**: `test/electric/shapes/shape_test.exs`, `test/electric/shapes/consumer/change_handling_test.exs`
**Depends on**: I.WhereParser, H.WireProtocol

Evaluates whether a WAL change belongs to a shape, and if so, converts it to log items.

**Core logic for UPDATE with WHERE**:
```
old_matches = where.Eval(old_record)
new_matches = where.Eval(new_record)

(true,  true)  → update
(true,  false) → delete (record moved OUT of shape)
(false, true)  → insert (record moved INTO shape)
(false, false) → skip
```

**Fast path**: if shape has no WHERE and selects all columns → accept without evaluation.

**PK change**: if old_key != new_key on an update → split into delete + insert with `key_change_to`/`key_change_from` headers.

---

### 5.M SnapshotQuery

**Package**: `pkg/snapshot`
**Elixir source**: `lib/electric/postgres/snapshot_query.ex`, `lib/electric/shapes/consumer/initial_snapshot.ex`
**Elixir tests**: `test/electric/shapes/consumer/initial_snapshot_test.exs`
**Depends on**: K.PgConnector, I.WhereParser, C.ColumnParser

Executes the initial snapshot query and captures the pg_snapshot for transaction filtering.

**Procedure**:
```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_current_snapshot(), pg_current_wal_lsn();
-- set display settings --
SELECT <columns> FROM <schema>.<table> WHERE <where>;
COMMIT;
```

**pg_snapshot format**: `"xmin:xmax:xip1,xip2,..."` → parse into struct.

**Visibility rules** (for filtering WAL transactions against snapshot):
- `xid < xmin` → visible in snapshot (skip from log)
- `xid >= xmax` → after snapshot (keep in log)
- `xid in xip_list` → was in-progress (keep in log)
- `xid >= xmin && xid < xmax && xid NOT in xip_list` → visible (skip)

---

### 5.N ReplicationClient

**Package**: `pkg/replication`
**Elixir source**: `lib/electric/postgres/replication_client.ex`, `lib/electric/postgres/replication_client/connection_setup.ex`
**Elixir tests**: `test/electric/postgres/replication_client_test.exs`
**Depends on**: K.PgConnector, A.LogOffset

Manages the PostgreSQL logical replication connection.

**Setup sequence** (§5.3 of RFC):
1. IDENTIFY_SYSTEM
2. Query PG version, backend PID
3. Advisory lock: `pg_advisory_lock(hashtext(slot_name))`
4. Create/verify publication
5. Create/find replication slot (pgoutput, NOEXPORT_SNAPSHOT)
6. Set display settings
7. START_REPLICATION

**WAL message types**: Relation, Begin, Insert, Update, Delete, Truncate, Commit.

**Transaction batching**: accumulate changes, emit TransactionFragment (batch size configurable, default 100).

**Standby status**: report flushed LSN back to PG periodically.

**Publication management**: `ALTER PUBLICATION ADD/DROP TABLE` — tables are added when shapes are created, removed when no shapes reference them.

---

### 5.O SQLiteStorage

**Package**: `pkg/storage`
**Elixir source**: `lib/electric/shape_cache/pure_file_storage.ex`
**Depends on**: J.StorageInterface, H.WireProtocol, A.LogOffset

Implements ShapeStorage using SQLite (pure Go via `modernc.org/sqlite`).

**Key requirement**: write equivalence tests that run the same operations against MemoryStorage and SQLiteStorage and assert identical results.

**Persistence**: shape definition and pg_snapshot are stored in the `meta` table. On server restart, shapes are recovered from storage.

---

## 6. Tier 3 Components

### 6.P ShapeRegistry

**Package**: `pkg/registry`
**Elixir source**: `lib/electric/shape_cache.ex`, `lib/electric/shape_cache/shape_status.ex`
**Elixir tests**: `test/electric/shape_cache/` files
**Depends on**: A.LogOffset, storage interface

Central registry of active shapes. Maps shape definitions to handles, manages shape lifecycle.

**Handle format**: `{hash}-{microsecond_timestamp}` where hash is derived from the normalized shape definition.

**Event system**: each shape has a channel/broadcast mechanism. Live HTTP requests subscribe to events:
- `NewChanges{LatestOffset}` — new data written
- `ShapeRotation{NewHandle}` — shape invalidated

**Thread safety**: all operations must be safe for concurrent access. Use `sync.RWMutex` or equivalent.

---

### 6.Q Consumer

**Package**: `pkg/consumer`
**Elixir source**: `lib/electric/shapes/consumer.ex`
**Elixir tests**: `test/electric/shapes/consumer_test.exs`
**Depends on**: L.ChangeFilter, M.SnapshotQuery, O.StorageImpl, P.ShapeRegistry

One goroutine per active shape. Manages the shape's lifecycle from snapshot to live streaming.

**Key complexity**: the snapshot and WAL stream overlap. WAL events arriving while the snapshot is being taken must be filtered using the pg_snapshot to avoid duplicates.

**For testing**: use MemoryStorage + mock SnapshotQuery (returns hardcoded rows) + channel-based mock ReplicationClient (feed TransactionFragments directly).

---

### 6.R ShapeLogCollector

**Package**: `pkg/collector`
**Elixir source**: `lib/electric/replication/shape_log_collector.ex`
**Elixir tests**: `test/electric/replication/shape_log_collector_test.exs`
**Depends on**: N.ReplicationClient, P.ShapeRegistry, L.ChangeFilter

Central dispatcher. Receives TransactionFragments from the ReplicationClient and routes changes to the correct Consumer(s) based on which tables are affected.

**Flush tracking**: tracks the minimum flushed offset across all consumers. When all consumers have flushed past a transaction, advances the replication client's flushed LSN.

---

## 7. Tier 4 Components

### 7.S HTTPRouter

**Package**: `pkg/http`
**Elixir source**: `lib/electric/plug/router.ex`
**Elixir tests**: `test/electric/plug/router_test.exs`

Routes:
| Method | Path | Handler |
|--------|------|---------|
| GET | `/v1/shape` | ServeShape |
| DELETE | `/v1/shape` | DeleteShape |
| OPTIONS | `/v1/shape` | OptionsShape |
| GET | `/v1/health` | HealthCheck |
| GET | `/` | Root (200 empty) |
| * | * | 404 |

CORS middleware on all `/v1/shape` responses:
- `access-control-allow-origin`: request's Origin or `*`
- `access-control-expose-headers`: all `electric-*` headers + `retry-after`
- `access-control-allow-methods`: `GET, POST, HEAD, DELETE, OPTIONS`

---

### 7.T ServeShape

**Package**: `pkg/http`
**Elixir source**: `lib/electric/plug/serve_shape_plug.ex`, `lib/electric/shapes/api.ex`
**Elixir tests**: `test/electric/plug/serve_shape_plug_test.exs` (1055 lines)

**Compositional test approach**: use `httptest.Server` + real ShapeRegistry + MemoryStorage + all real Tier 0 components. No PostgreSQL needed.

Pre-populate MemoryStorage with known data, then make HTTP requests and validate responses (status, headers, body).

---

### 7.U LiveMode

**Package**: `pkg/http`
**Elixir source**: `lib/electric/shapes/api.ex` (hold_until_change, handle_live_request)

**Go implementation pattern**: use `select` on:
- Shape event channel (from registry subscription)
- Timeout timer (`time.After(longPollTimeout)`)
- Context cancellation (client disconnected)

**Race window**: after subscribing to events, explicitly check if the shape has changed since the request was validated. If so, self-send the event.

---

## 8. Cross-Cutting Concerns

### 8.1 Error Response Format

All error responses:
```json
{
  "message": "Invalid request",
  "errors": {
    "table": ["table not found"]
  }
}
```

`errors` is optional. When absent, only `message`.

### 8.2 Authentication

If `ELECTRIC_SECRET` is configured: all `/v1/shape` requests (except OPTIONS) must include `?secret=<value>`. Mismatch → 401.

### 8.3 Health Check

```json
{"status": "active"}    // 200 — fully operational
{"status": "starting"}  // 202 — starting up
{"status": "waiting"}   // 202 — waiting for DB lock
```

### 8.4 Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVICE_PORT` | 3000 | HTTP port |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `ELECTRIC_SECRET` | nil | API secret (nil = no auth) |
| `LONG_POLL_TIMEOUT` | 20000 | Long-poll timeout (ms) |
| `CACHE_MAX_AGE` | 60 | max-age for non-live (seconds) |
| `CACHE_STALE_AGE` | 300 | stale-while-revalidate (seconds) |
| `CHUNK_BYTES_THRESHOLD` | 10485760 | Chunk size threshold (bytes, 10MB) |
| `DB_POOL_SIZE` | 20 | PostgreSQL pool size |
| `MAX_SHAPES` | 0 | Max simultaneous shapes (0 = unlimited) |
| `REPLICATION_STREAM_ID` | default | Replication slot/publication suffix |

### 8.5 Value Encoding

All values in log items follow PostgreSQL text representation:

| PG Type | JSON | Note |
|---------|------|------|
| int2, int4 | number | `42` |
| int8 | string | `"9223372036854775807"` (JS can't handle 64-bit) |
| float4, float8 | number or string | `4.5`, `"Infinity"`, `"NaN"` |
| bool | boolean | `true` |
| text, varchar | string | `"hello"` |
| json, jsonb | parsed JSON | `{"foo": "bar"}` |
| uuid | string | `"550e8400-..."` |
| timestamp, date | string | `"2024-01-15T10:30:00"` |
| bytea | string (hex) | `"\\x48656c6c6f"` |
| arrays | JSON array | `[1, 2, 3]` |
| NULL | null | `null` |

### 8.6 Chunked Transfer Encoding

For large responses, use HTTP chunked transfer encoding. The body is a JSON array `[item1, item2, ...]` streamed incrementally. The opening `[` is sent first, then items separated by `,`, then `]` at the end.

### 8.7 Content-Type

All `/v1/shape` responses: `application/json`

### 8.8 Server Header

All responses must include: `electric-server: ElectricGo/0.1.0` (or similar version string).
