# Electric Go Reimplementation — Implementation Plan

## Overview

This document describes the implementation plan for an experimental reimplementation of the Electric Sync Service in Go. The plan is organized into dependency tiers, where components within the same tier have zero dependencies on each other and can be built by parallel agents.

The companion document `AGENT_NOTES.md` provides progressive disclosure notes for implementing agents.

## Source Reference

The full RFC specification is maintained separately. Key source files in the Elixir codebase are at `packages/sync-service/lib/electric/`.

## Go Module Structure

```
electric-go/
├── cmd/
│   └── electric/
│       └── main.go                  # Entry point
├── pkg/
│   ├── offset/                      # A. LogOffset
│   │   ├── offset.go
│   │   └── offset_test.go
│   ├── key/                         # B. KeyFormat
│   │   ├── key.go
│   │   └── key_test.go
│   ├── columns/                     # C. ColumnParser
│   │   ├── parser.go
│   │   └── parser_test.go
│   ├── etag/                        # D. ETagComputer
│   │   ├── etag.go
│   │   └── etag_test.go
│   ├── cursor/                      # E. CursorGenerator
│   │   ├── cursor.go
│   │   └── cursor_test.go
│   ├── cache/                       # F. CacheHeaders
│   │   ├── headers.go
│   │   └── headers_test.go
│   ├── schema/                      # G. SchemaHeader
│   │   ├── header.go
│   │   ├── types.go
│   │   └── header_test.go
│   ├── wire/                        # H. WireProtocol
│   │   ├── protocol.go
│   │   ├── encode.go
│   │   └── protocol_test.go
│   ├── where/                       # I. WhereParser
│   │   ├── parser.go
│   │   ├── eval.go
│   │   ├── types.go
│   │   ├── functions.go
│   │   ├── operators.go
│   │   └── where_test.go
│   ├── storage/                     # J+O. StorageInterface + Impl
│   │   ├── interface.go
│   │   ├── memory.go
│   │   ├── memory_test.go
│   │   ├── sqlite.go
│   │   ├── sqlite_test.go
│   │   └── equivalence_test.go
│   ├── postgres/                    # K. PgConnector
│   │   ├── connector.go
│   │   ├── settings.go
│   │   └── connector_test.go
│   ├── filter/                      # L. ChangeFilter
│   │   ├── filter.go
│   │   └── filter_test.go
│   ├── snapshot/                    # M. SnapshotQuery
│   │   ├── query.go
│   │   ├── pgsnapshot.go
│   │   └── query_test.go
│   ├── replication/                 # N. ReplicationClient
│   │   ├── client.go
│   │   ├── decoder.go
│   │   ├── publication.go
│   │   ├── slot.go
│   │   └── client_test.go
│   ├── registry/                    # P. ShapeRegistry
│   │   ├── registry.go
│   │   ├── handle.go
│   │   └── registry_test.go
│   ├── consumer/                    # Q. Consumer
│   │   ├── consumer.go
│   │   └── consumer_test.go
│   ├── collector/                   # R. ShapeLogCollector
│   │   ├── collector.go
│   │   └── collector_test.go
│   └── http/                        # S+T+U. HTTP layer
│       ├── router.go
│       ├── serve_shape.go
│       ├── delete_shape.go
│       ├── options_shape.go
│       ├── health.go
│       ├── live.go
│       ├── cors.go
│       ├── router_test.go
│       ├── serve_shape_test.go
│       └── live_test.go
├── go.mod
└── go.sum
```

---

## Dependency Graph

```
Tier 0 (leaf types, zero deps)
├── A. LogOffset
├── B. KeyFormat
├── C. ColumnParser
├── D. ETagComputer
├── E. CursorGenerator
├── F. CacheHeaders
└── G. SchemaHeader

Tier 1 (depends on Tier 0 types only)
├── H. WireProtocol         [A, B]
├── I. WhereParser           [standalone, uses pg_query_go]
├── J. StorageInterface      [A]
└── K. PgConnector           [standalone, uses pgx]

Tier 2 (depends on Tier 0 + Tier 1)
├── L. ChangeFilter          [I, H]
├── M. SnapshotQuery         [K, I, C]
├── N. ReplicationClient     [K, A]
└── O. StorageImpl           [J, H, A]

Tier 3 (composition)
├── P. ShapeRegistry         [A, O]
├── Q. Consumer              [L, M, O, P]
└── R. ShapeLogCollector     [N, P, L]

Tier 4 (HTTP layer)
├── S. HTTPRouter            [all]
├── T. ServeShape            [P, Q, O, D, E, F, G, H]
└── U. LiveMode              [T, R]

Tier 5 (integration)
└── V. Integration Tests     [full stack]
```

---

## Phase 1: Tier 0 — Leaf Types (7 parallel agents)

### A. LogOffset

**File**: `pkg/offset/offset.go`

**Struct**:
```go
type LogOffset struct {
    TxOffset int64
    OpOffset int
}
```

**Functionality**:
- Parse from string: `"-1"` → BeforeAll, `"0_0"` → First, `"{tx}_{op}"` → regular
- Serialize to string: `fmt.Sprintf("%d_%d", tx, op)`
- Compare: lexicographic on (TxOffset, OpOffset)
- Special values: `BeforeAll (-1, 0)`, `First (0, 0)`, `LastBeforeReal (0, MaxInt)`
- Increment: `(tx, op) → (tx, op+1)`

**Tests (port from** `test/electric/replication/log_offset_test.exs`**)**:
- Parse valid offsets: `"-1"`, `"0_0"`, `"123_456"`
- Parse invalid offsets: `"abc"`, `"1_"`, `"_1"`, `""`, `"1_2_3"`
- Compare: A < B, A == B, A > B, BeforeAll < everything
- Increment: basic, overflow of op_offset
- String roundtrip: parse → string → parse == original
- Special value comparisons: BeforeAll < First < LastBeforeReal

**Additional tests to add**:
- Boundary: max int64 tx_offset
- Boundary: zero values
- Sort a slice of offsets

---

### B. KeyFormat

**File**: `pkg/key/key.go`

**Function**:
```go
func BuildKey(schema, table string, pkValues []string) string
```

**Functionality**:
- Format: `"<schema>"."<table>"/"<pk1>"/"<pk2>"`
- Escape `/` as `//` within PK values
- NULL PK represented as empty string

**Tests (port from** `test/electric/shapes/shape_test.exs` **key-related tests)**:
- Single PK: `("public", "users", ["42"])` → `"public"."users"/"42"`
- Composite PK: `("public", "orders", ["EU", "7"])` → `"public"."orders"/"EU"/"7"`
- PK with slash: `("public", "t", ["a/b"])` → `"public"."t"/"a//b"`
- NULL PK: `("public", "t", [""])` → `"public"."t"/`
- Schema quoting: `("my schema", "my table", ["1"])` → correctly quoted

**Additional tests**:
- Empty PK values list (tables without PK)
- PK value with multiple slashes
- Unicode in schema/table/PK

---

### C. ColumnParser

**File**: `pkg/columns/parser.go`

**Function**:
```go
func ParseColumns(input string) ([]string, error)
```

**Functionality**:
- Parse comma-separated list of column names
- Unquoted names → lowercased
- Quoted names (`"Foo"`) → preserve case
- Doubled quotes (`"has""q"`) → `has"q`
- Commas inside quotes are part of the name

**Tests (port from** `test/electric/plug/utils_test.exs` **column parsing)**:
- `"id"` → `["id"]`
- `"id,name"` → `["id", "name"]`
- `"PoTaTo"` → `["potato"]` (lowercased)
- `'"PoT@To",PoTaTo'` → `["PoT@To", "potato"]`
- `'"PoTaTo,sunday",foo'` → `["PoTaTo,sunday", "foo"]`
- `'"fo""o",bar'` → `["fo\"o", "bar"]`
- `""` → error (empty identifier)
- `"foo,"` → error (trailing comma)
- `'"id,"name"'` → error (invalid unquoted identifier)

**Additional tests**:
- Single column
- Column name that is only quotes
- Very long column names

---

### D. ETagComputer

**File**: `pkg/etag/etag.go`

**Functions**:
```go
func Compute(handle string, reqOffset, respOffset LogOffset) string
func ComputeNoChange(handle string, reqOffset, respOffset LogOffset) string
func Quote(etag string) string
func ParseIfNoneMatch(header string) []string
```

**Functionality**:
- Normal: `"{handle}:{reqOffset}:{respOffset}"`
- NoChange: `"{handle}:{reqOffset}:{respOffset}:{monotonic}"`
- Quote: wrap in `"`
- ParseIfNoneMatch: split by `,`, trim whitespace and `"` from each

**Tests (port from** `test/electric/shapes/api/response_test.exs`**)**:
- Normal ETag format
- NoChange ETag includes monotonic suffix
- Quoted format
- ParseIfNoneMatch with single value
- ParseIfNoneMatch with multiple comma-separated values
- ParseIfNoneMatch with extra whitespace

**Additional tests**:
- NoChange uniqueness: two calls in succession produce different ETags
- Empty If-None-Match header

---

### E. CursorGenerator

**File**: `pkg/cursor/cursor.go`

**Function**:
```go
func NextCursor(longPollTimeoutMs int, prevCursor string) int
```

**Functionality**:
- Epoch: Oct 9 2024 00:00:00 UTC
- Algorithm: `ceil(seconds_since_epoch / timeout_seconds) * timeout_seconds`
- If result equals prevCursor (as string), add random jitter 1–3600
- If timeout is 0: return 0

**Tests (port from** `test/electric/plug/utils_test.exs` **cursor tests)**:
- Zero timeout → 0
- Non-zero timeout → deterministic within same interval
- Different interval → different cursor
- Same cursor as prev → jitter added
- Nil/empty prev cursor → no jitter

**Additional tests**:
- Very large timeout values
- Cursor increases over time

---

### F. CacheHeaders

**File**: `pkg/cache/headers.go`

**Types**:
```go
type ResponseType int
const (
    InitialSync ResponseType = iota
    CatchUp
    Live
    Conflict409WithHandle
    Conflict409NoHandle
    Error4xx5xx
    NonGetMethod
)

type CacheConfig struct {
    MaxAge             int  // seconds, default 60
    StaleAge           int  // seconds, default 300
    SendCacheHeaders   bool // default true
}
```

**Function**:
```go
func CacheControlHeader(rt ResponseType, config CacheConfig) string
func SurrogateControlHeader(rt ResponseType, config CacheConfig) string
```

**Tests (port from** `test/electric/shapes/api/response_test.exs` **cache headers)**:
- InitialSync → `"public, max-age=604800, s-maxage=3600, stale-while-revalidate=2629746"`
- CatchUp → `"public, max-age=60, stale-while-revalidate=300"` (with defaults)
- Live → `"public, max-age=5, stale-while-revalidate=5"`
- Conflict409WithHandle → `"public, max-age=60, must-revalidate"`
- Conflict409NoHandle → `"public, max-age=1, must-revalidate"`
- Error4xx5xx → `"no-store"` + surrogate `"no-store"`
- NonGetMethod → `"no-cache"`
- SendCacheHeaders=false → empty string
- Custom MaxAge and StaleAge

**Additional tests**:
- Config with zero values

---

### G. SchemaHeader

**File**: `pkg/schema/header.go`

**Types**:
```go
type ColumnInfo struct {
    Name      string
    Type      string
    PKIndex   int    // -1 if not PK
    NotNull   bool
    Dims      int    // array dimensions, 0 if not array
    MaxLength int    // varchar limit, 0 if none
    Length    int     // char/bit fixed length, 0 if none
    Precision int    // numeric/time precision, 0 if none
    Scale     int    // numeric scale, 0 if none
    Fields    string // interval field restriction, "" if none
    TypeMod   int    // raw type modifier, 0 if none
}
```

**Function**:
```go
func EncodeSchemaHeader(columns []ColumnInfo) string
```

**Output**: JSON object mapping column names to type descriptors. Zero-value fields are omitted.

**Tests (port from** `test/electric/schema_test.exs`**)**:
- Simple int4 PK column
- Text column (no extras)
- Array column (dims=1)
- Varchar with max_length
- Numeric with precision and scale
- Multiple columns combined
- Not-null flag
- Composite PK (two columns with pk_index 0 and 1)

**Additional tests**:
- All supported PostgreSQL types
- Column with all optional fields set
- Empty column list

---

## Phase 2: Tier 1 — Core Logic (4 parallel agents)

### H. WireProtocol

**File**: `pkg/wire/protocol.go`

**Depends on**: A.LogOffset, B.KeyFormat

**Types**:
```go
type Operation string
const (
    OpInsert Operation = "insert"
    OpUpdate Operation = "update"
    OpDelete Operation = "delete"
)

type ReplicaMode string
const (
    ReplicaDefault ReplicaMode = "default"
    ReplicaFull    ReplicaMode = "full"
)

type LogItem struct {
    Offset  LogOffset
    Key     string
    Op      Operation
    JSON    []byte  // pre-serialized, ready to send
}
```

**Functions**:
```go
func EncodeInsert(key string, record map[string]any, offset LogOffset, relation [2]string, txids []int, last bool) LogItem
func EncodeUpdate(key string, record, oldRecord map[string]any, changedCols []string, pkCols []string, offset LogOffset, relation [2]string, txids []int, replica ReplicaMode, last bool) LogItem
func EncodeDelete(key string, oldRecord map[string]any, pkCols []string, offset LogOffset, relation [2]string, txids []int, replica ReplicaMode, last bool) LogItem
func EncodePKChange(oldKey, newKey string, oldRecord, newRecord map[string]any, pkCols []string, offset LogOffset, relation [2]string, txids []int, replica ReplicaMode, last bool) []LogItem
func EncodeControlUpToDate(globalLSN int64) []byte
```

**Tests (port from** `test/electric/log_items_test.exs`**)**:
- Insert encoding: all fields present, correct JSON structure
- Update default mode: only PKs + changed columns in value
- Update full mode: full record in value, changed in old_value
- Delete default mode: only PKs in value
- Delete full mode: full old record in value
- PK change: produces two items (delete with key_change_to, insert with key_change_from)
- PK change offset: insert offset = delete offset + 1 in op_offset
- Control message: up-to-date with global_last_seen_lsn
- last header: present when last=true, absent otherwise
- txids: array in headers
- lsn: string representation of tx_offset
- op_position: op_offset value

**Additional tests**:
- NULL values in records
- Empty record
- Large record (many columns)
- Multiple txids
- Merge updates (for log merging)

---

### I. WhereParser

**File**: `pkg/where/parser.go`, `pkg/where/eval.go`, `pkg/where/functions.go`, `pkg/where/operators.go`

**Depends on**: standalone (uses `pganalyze/pg_query_go` for parsing)

**This is the largest component.** It consists of:

1. **Parser**: SQL string → PostgreSQL AST (via pg_query_go)
2. **Type Checker**: AST + column types → typed expression tree
3. **Evaluator**: expression tree + record → bool/value
4. **Known Functions**: operator and function registry with implementations
5. **Normalizer**: AST → canonical SQL string

**Types**:
```go
type Expr struct {
    Query    string            // normalized SQL
    Eval     ExprNode          // evaluable tree
    Returns  PgType            // return type (should be bool)
    UsedRefs map[string]PgType // columns referenced
}

type ExprNode interface {
    Evaluate(record map[string]any) (any, error)
    Type() PgType
}
```

**Tests (port from** `test/electric/replication/eval/` **— all files)**:

Parser tests:
- Valid boolean expressions
- Invalid SQL (syntax errors with location)
- Semicolons rejected
- Extra clauses rejected (ORDER BY, GROUP BY, etc.)
- Aggregates rejected

Type checker tests:
- Column reference resolution
- Unknown column → error
- Type coercion (int4 to int8, etc.)
- Explicit casts (`x::int4`)
- Parameterized queries ($1, $2)
- Parameter type conflicts → error
- Constant folding (immutable functions with all-const args)

Operator tests (each from known_functions.ex):
- Comparison: `=`, `<>`, `<`, `>`, `<=`, `>=` for all type pairs
- Boolean: `AND`, `OR`, `NOT`, `IS NULL`, `IS NOT NULL`, `IS TRUE`, etc.
- `IS DISTINCT FROM`, `IS NOT DISTINCT FROM`
- Numeric: `+`, `-`, `*`, `/`, `^`, `|/`, `@`, `&`, `|`, `#`, `~`
- String: `||`, `LIKE`, `ILIKE`, `NOT LIKE`, `NOT ILIKE`, `lower()`, `upper()`
- Array: `=`, `<>`, `@>`, `<@`, `&&`, `||`, `array_cat`, `array_prepend`, `array_append`, `array_ndims`
- Set: `IN`, `NOT IN`, `BETWEEN`, `NOT BETWEEN`, `BETWEEN SYMMETRIC`, `ANY()`, `ALL()`
- Date/time arithmetic: all from §2.1.2.4

Evaluator tests:
- Each operator with concrete values
- NULL handling: strict functions return NULL
- Non-strict: `NULL OR TRUE` → `TRUE`, `NULL AND FALSE` → `FALSE`
- Type-specific: date arithmetic, interval arithmetic, text operations
- Arrays: indexing, slicing, containment
- Enums: compared as strings

Normalization tests:
- Parameter substitution: `$1` → `'value'::type`
- Whitespace normalization
- Keyword uppercasing

**Additional tests**:
- Deeply nested expressions
- All supported types as column refs
- WHERE clause with 20+ conditions
- Edge cases: empty string, only whitespace, only a boolean literal

---

### J. StorageInterface

**File**: `pkg/storage/interface.go`

**Depends on**: A.LogOffset

**Interfaces**:
```go
type StackStorage interface {
    GetAllStoredShapeHandles() (map[string]struct{}, error)
    GetStoredShapes(handles []string) map[string]ShapeResult
}

type ShapeStorage interface {
    FetchLatestOffset() (LogOffset, error)
    SnapshotStarted() bool
    GetLogStream(since, upTo LogOffset) LogStream
    GetChunkEndOffset(offset LogOffset) *LogOffset
    FetchPgSnapshot() (*PgSnapshot, error)

    MakeNewSnapshot(rows RowStream) error
    MarkSnapshotAsStarted() error
    SetPgSnapshot(snap PgSnapshot) error
    AppendToLog(items []LogItem) error
    Cleanup() error
}

type Writer interface {
    AppendToLog(items []LogItem) error
    Terminate() error
}

type LogStream interface {
    Next() ([]byte, bool)  // returns pre-serialized JSON, ok
    Close()
}

type PgSnapshot struct {
    Xmin       int64
    Xmax       int64
    XipList    []int64
    FilterTxns bool
}
```

**No tests** for the interface itself — tested via implementations.

**Also define**: `MemoryStorage` implementation (see below).

---

### J+O (partial). MemoryStorage

**File**: `pkg/storage/memory.go`

**Depends on**: J.StorageInterface, A.LogOffset

This is built as part of the StorageInterface agent since it's the simplest implementation and is needed as a test harness.

```go
type MemoryStorage struct {
    mu             sync.RWMutex
    log            []memLogEntry
    chunkBounds    []LogOffset
    pgSnapshot     *PgSnapshot
    snapshotDone   bool
    shapeDef       json.RawMessage
    chunkThreshold int
    currentChunk   int
}
```

**Tests**:
- Full CRUD cycle: create snapshot, append log, read stream
- Chunk boundaries created at threshold
- GetChunkEndOffset returns correct boundary
- FetchLatestOffset returns max
- Cleanup resets everything
- Concurrent reads during writes (race detector)
- Empty shape (no snapshot yet)

---

### K. PgConnector

**File**: `pkg/postgres/connector.go`

**Depends on**: standalone (uses `jackc/pgx`)

**Functionality**:
- Standard connection pool (`pgxpool`) with display settings applied via AfterConnect hook
- Replication connection using `pgx` replication protocol mode
- Apply display settings on connect
- Advisory lock acquisition with retry
- IdentifySystem command

**Tests** (require real PostgreSQL — use `testcontainers-go` or skip with build tag):
- Connect with valid DSN
- Display settings applied (query `SHOW DateStyle` etc. after connect)
- Advisory lock acquisition
- Advisory lock conflict detection
- Connection pool basic operation
- Replication mode connect

---

## Phase 3: Tier 2 — Functional Components (4 parallel agents)

### L. ChangeFilter

**File**: `pkg/filter/filter.go`

**Depends on**: I.WhereParser, H.WireProtocol

**Types**:
```go
type WALChange struct {
    Type      ChangeType // Insert, Update, Delete
    Relation  [2]string  // [schema, table]
    Record    map[string]any  // new record (insert/update)
    OldRecord map[string]any  // old record (update/delete)
    OldKey    string          // non-nil if PK changed
    Key       string
    Offset    LogOffset
    Txid      int
    Last      bool
}

type ShapeFilter struct {
    Table           [2]string
    Where           *Expr       // compiled WHERE, nil if none
    SelectedColumns []string    // nil means all
    PKCols          []string
    Replica         ReplicaMode
}
```

**Function**:
```go
func (f *ShapeFilter) FilterChange(change WALChange) []LogItem
```

**Tests (port from** `test/electric/shapes/shape_test.exs` **filtering + `consumer/change_handling_test.exs`)**:
- Wrong table → nil
- INSERT matching WHERE → insert LogItem
- INSERT not matching WHERE → nil
- DELETE matching WHERE → delete LogItem
- DELETE not matching WHERE → nil
- UPDATE (in,in) → update LogItem
- UPDATE (in,out) → delete LogItem (moved out of shape)
- UPDATE (out,in) → insert LogItem (moved into shape)
- UPDATE (out,out) → nil
- No WHERE clause → accept all
- Column filtering: only selected columns in output
- PK change: old_key != key → delete + insert pair
- replica:default: delete has only PKs, update has PKs + changed
- replica:full: delete has full record, update has value + old_value
- No PK table: delete has all columns

**Additional tests**:
- Shape with complex WHERE (AND, OR, nested)
- Update that changes a column referenced in WHERE
- Update that changes only non-selected columns
- NULL values in WHERE evaluation

---

### M. SnapshotQuery

**File**: `pkg/snapshot/query.go`

**Depends on**: K.PgConnector, I.WhereParser, C.ColumnParser

**Functions**:
```go
func BuildSnapshotQuery(schema, table string, columns []string, where string) string
func ExecuteSnapshot(ctx context.Context, pool *pgxpool.Pool, query string) (*PgSnapshot, RowStream, error)
func ParsePgSnapshot(raw string) (PgSnapshot, error)
func VisibleInSnapshot(xid int64, snap PgSnapshot) bool
func AfterSnapshot(xid int64, snap PgSnapshot) bool
```

**Tests (port from** `test/electric/shapes/consumer/initial_snapshot_test.exs`**)**:
- Query building: simple table, with columns, with WHERE
- Query building: schema-qualified table
- pg_snapshot parsing: `"100:105:101,103"` → {xmin:100, xmax:105, xip:[101,103]}
- pg_snapshot parsing: empty xip_list `"100:105:"`
- VisibleInSnapshot: xid < xmin → true
- VisibleInSnapshot: xid >= xmax → false
- VisibleInSnapshot: xid in xip_list → false (not visible, was in-progress)
- VisibleInSnapshot: xmin <= xid < xmax, not in xip → true
- AfterSnapshot: xid >= xmax and not in xip → true
- AfterSnapshot: xid in xip → false

**Integration tests** (with real PG):
- Execute snapshot on a table with data
- Snapshot returns all matching rows
- pg_current_snapshot returns valid values

**Additional tests**:
- Empty table snapshot
- Large table snapshot (streaming behavior)
- Snapshot with WHERE that filters most rows

---

### N. ReplicationClient

**File**: `pkg/replication/client.go`, `pkg/replication/decoder.go`

**Depends on**: K.PgConnector, A.LogOffset

**Types**:
```go
type Relation struct {
    ID       uint32
    Schema   string
    Table    string
    Columns  []RelationColumn
}

type TransactionFragment struct {
    Changes           []WALChange
    Xid               int64
    LSN               int64
    LastLogOffset     LogOffset
    AffectedRelations map[uint32]struct{}
    IsFinal           bool  // true if this is the last fragment (has Commit)
}
```

**Functionality**:
- Full setup sequence per §5.3
- Decode pgoutput v1 messages: Relation, Begin, Insert, Update, Delete, Truncate, Commit
- Batch changes into TransactionFragments (configurable batch size, default 100)
- Send standby status updates (received, flushed, applied LSN)
- Publication management: CREATE, ALTER ADD TABLE, ALTER DROP TABLE
- Slot management: create, find existing, drop

**Tests (unit — message decoding from fixtures)**:
- Decode Relation message
- Decode Begin message
- Decode Insert message (with Relation context)
- Decode Update message (old + new tuple)
- Decode Delete message (key tuple)
- Decode Truncate message
- Decode Commit message
- Transaction batching: N changes → ceil(N/batch_size) fragments
- Last fragment has IsFinal=true
- LSN conversion to int64

**Integration tests** (with real PG):
- Full setup sequence
- Create publication
- Add table to publication
- Create replication slot
- Start streaming → receive changes after INSERT
- Standby status feedback

**Additional tests**:
- Large transaction fragmentation
- Multiple tables in one transaction
- Schema change (Relation message mid-stream)

---

### O. StorageImpl (SQLite)

**File**: `pkg/storage/sqlite.go`

**Depends on**: J.StorageInterface, H.WireProtocol, A.LogOffset

**Implementation using** `modernc.org/sqlite` **(pure Go, no CGO)**:

**Schema**:
```sql
CREATE TABLE log (
    tx_offset  INTEGER NOT NULL,
    op_offset  INTEGER NOT NULL,
    key        TEXT NOT NULL,
    op_type    TEXT NOT NULL,
    json_data  BLOB NOT NULL,
    PRIMARY KEY (tx_offset, op_offset)
);

CREATE TABLE chunk_boundaries (
    tx_offset  INTEGER NOT NULL,
    op_offset  INTEGER NOT NULL,
    PRIMARY KEY (tx_offset, op_offset)
);

CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
```

**Tests** — same as MemoryStorage tests, plus:

**Equivalence tests** (`pkg/storage/equivalence_test.go`):
```go
func TestStorageEquivalence(t *testing.T) {
    operations := []StorageOp{...}
    mem := NewMemoryStorage(config)
    sql := NewSQLiteStorage(config)
    for _, op := range operations {
        resultMem := op.Execute(mem)
        resultSQL := op.Execute(sql)
        assert.Equal(t, resultMem, resultSQL)
    }
}
```

Test sequences:
- Empty read
- Write snapshot (100 rows), read all
- Write snapshot + log entries, read combined stream
- Chunk boundary at threshold
- GetChunkEndOffset at various positions
- FetchLatestOffset
- Cleanup and verify empty
- Write, close, reopen, read (persistence)
- Shape definition storage and recovery
- PgSnapshot storage and recovery

**Additional tests**:
- Concurrent writes from multiple goroutines
- Very large snapshot (10k+ rows)
- Read while write is in progress

---

## Phase 4: Tier 3 — Composition (P is parallel with Q+R)

### P. ShapeRegistry

**File**: `pkg/registry/registry.go`

**Depends on**: A.LogOffset, O.StorageImpl (or MemoryStorage)

**Types**:
```go
type ShapeDefinition struct {
    Table    [2]string   // [schema, table]
    Where    string      // original WHERE string
    Columns  []string    // sorted, normalized
    Replica  ReplicaMode
}

type ShapeInstance struct {
    Handle     string
    Definition ShapeDefinition
    Status     ShapeStatus
    LastRead   time.Time
    Storage    ShapeStorage
    Events     chan ShapeEvent
}

type ShapeEvent struct {
    Type         ShapeEventType  // NewChanges, ShapeRotation
    LatestOffset LogOffset
    NewHandle    string
}
```

**Functions**:
```go
func (r *Registry) GetOrCreate(def ShapeDefinition) (handle string, err error)
func (r *Registry) Resolve(handle string, def ShapeDefinition) (ResolveResult, error)
func (r *Registry) Invalidate(handle string) error
func (r *Registry) InvalidateByTable(table [2]string) error
func (r *Registry) Subscribe(handle string) (<-chan ShapeEvent, func())
func (r *Registry) NotifyNewChanges(handle string, offset LogOffset)
func (r *Registry) RecoverFromStorage() error
```

**Tests (port from** `test/electric/shape_cache/` **files)**:
- GetOrCreate: new shape → new handle
- GetOrCreate: same definition → same handle
- GetOrCreate: different definition → different handle
- Resolve: valid handle + matching def → ok
- Resolve: valid handle + mismatched def → redirect
- Resolve: unknown handle → not found
- Invalidate: removes shape, notifies listeners
- InvalidateByTable: all shapes on table invalidated
- Subscribe: receives NewChanges events
- Subscribe: receives ShapeRotation on invalidation
- Concurrent GetOrCreate with same definition → only one created
- Shape count limit: exceeds MAX_SHAPES → error
- RecoverFromStorage: loads shapes from disk

**Additional tests**:
- Handle format: `{hash}-{timestamp}`
- Many concurrent subscribers
- Invalidate during active subscriptions
- Unsubscribe cleanup

---

### Q. Consumer

**File**: `pkg/consumer/consumer.go`

**Depends on**: L.ChangeFilter, M.SnapshotQuery, O.StorageImpl, P.ShapeRegistry

**Types**:
```go
type Consumer struct {
    handle     string
    shape      ShapeDefinition
    storage    ShapeStorage
    filter     *ShapeFilter
    snapshot   *SnapshotQuery
    registry   *Registry
    pgSnapshot *PgSnapshot
    status     ConsumerStatus // Initializing, Ready, Stopped
    changes    chan TransactionFragment
    done       chan struct{}
}
```

**Lifecycle**:
1. `Start()` → goroutine begins
2. Execute snapshot query, write to storage
3. Store pg_snapshot
4. Mark snapshot as started
5. Begin processing WAL changes from channel
6. For each TransactionFragment: filter, write to storage, notify registry
7. `Stop()` → flush and exit

**Tests (port from** `test/electric/shapes/consumer_test.exs`**)**:
- Full lifecycle with MemoryStorage
- Snapshot writes correct data
- WAL changes filtered and written to log
- pg_snapshot filtering: xid < xmin skipped
- pg_snapshot filtering: xid in xip_list kept
- pg_snapshot filtering: xid >= xmax kept, filtering disabled
- Notification after each write
- Flush tracking: reports correct last offset

**Additional tests**:
- Consumer stop during snapshot
- Consumer stop during WAL processing
- WAL changes arriving before snapshot completes (buffered)
- Empty snapshot (no matching rows)

---

### R. ShapeLogCollector

**File**: `pkg/collector/collector.go`

**Depends on**: N.ReplicationClient, P.ShapeRegistry, L.ChangeFilter

**Types**:
```go
type Collector struct {
    registry    *Registry
    consumers   map[string]*Consumer
    tableIndex  map[[2]string]map[string]struct{} // table → set of handles
    flushed     map[string]LogOffset              // handle → last flushed offset
    replication *ReplicationClient
    mu          sync.RWMutex
}
```

**Functions**:
```go
func (c *Collector) HandleTransaction(frag TransactionFragment)
func (c *Collector) AddShape(handle string, consumer *Consumer)
func (c *Collector) RemoveShape(handle string)
func (c *Collector) MinFlushedOffset() LogOffset
func (c *Collector) OnConsumerFlushed(handle string, offset LogOffset)
```

**Tests (port from** `test/electric/replication/shape_log_collector_test.exs`**)**:
- Route transaction to correct consumer by table
- Transaction affecting multiple tables → dispatched to all relevant consumers
- Transaction affecting no active shapes → dropped
- AddShape: new shape receives future transactions
- RemoveShape: removed shape no longer receives transactions
- Flush tracking: MinFlushedOffset returns minimum across all consumers
- Flush tracking: all consumers flushed → advance replication client

**Additional tests**:
- Concurrent AddShape/RemoveShape during transaction processing
- 100+ shapes on same table
- Transaction with changes across 10+ tables

---

## Phase 5: Tier 4 — HTTP Layer

### S. HTTPRouter

**File**: `pkg/http/router.go`

**Depends on**: all above

Uses `net/http` stdlib with a simple mux (or `chi`).

**Tests (port from** `test/electric/plug/router_test.exs`**)**:
- GET /v1/shape → handler called
- DELETE /v1/shape → handler called
- OPTIONS /v1/shape → 204 with CORS
- GET /v1/health → health response
- GET / → 200 empty
- Unknown path → 404
- CORS headers on all /v1/shape responses

---

### T. ServeShape

**File**: `pkg/http/serve_shape.go`

**Depends on**: P, O, D, E, F, G, H

**Tests (port from** `test/electric/plug/serve_shape_plug_test.exs` **— 1055 lines)**:

This is one of the most comprehensive test files. Port all tests that don't involve SSE or subset queries.

Categories:
- Initial sync: correct snapshot data, headers
- Catch-up: log chunks, offset progression
- Handle validation: mismatch → 409
- Schema header: correct JSON, only on non-live 200
- ETag and 304
- Cache headers per response type
- Error responses: missing table, invalid WHERE, missing offset
- Column selection
- Replica modes
- DELETE endpoint (port from `delete_shape_plug_test.exs`)
- OPTIONS endpoint (port from `options_shape_plug_test.exs`)

**Compositional test setup**:
```go
func setupTestServer(t *testing.T) (*httptest.Server, *registry.Registry, *storage.MemoryStorage) {
    mem := storage.NewMemoryStorage(config)
    reg := registry.New(registry.Config{Storage: mem})
    handler := http.NewRouter(http.Config{
        Registry: reg,
        // ... all real Tier 0 components
    })
    server := httptest.NewServer(handler)
    return server, reg, mem
}
```

This allows full HTTP testing without PostgreSQL.

---

### U. LiveMode

**File**: `pkg/http/live.go`

**Depends on**: T.ServeShape, R.ShapeLogCollector, P.ShapeRegistry

**Tests (port from** `test/electric/plug/serve_shape_plug_test.exs` **live-related tests)**:
- Live with immediate data → data returned
- Live with no data → hold → timeout → up-to-date
- Live with data arriving during hold → data returned
- Shape rotation during hold → 409
- Out-of-bounds offset → half-timeout → 400
- Out-of-bounds offset with data arriving → normal
- Cursor header present
- Cache headers: max-age=5
- Multiple concurrent live requests on same shape

**Compositional test setup**: same as ServeShape, plus goroutines that inject events into the registry.

---

## Phase 6: Tier 5 — Integration Tests

### V. TypeScript Integration Tests

**Prerequisites**: Go binary built, PostgreSQL running, test modifications applied.

**Steps**:
1. Apply SSE removal patch to `integration.test.ts` and `client.test.ts`
2. Start Go binary with `ELECTRIC_URL=http://localhost:3000`
3. Run `pnpm test -- test/integration.test.ts`
4. Run `pnpm test -- test/client.test.ts`
5. Analyze failures, fix Go implementation

**Test patches needed**:
```typescript
// integration.test.ts — change:
const fetchAndSse = [{ liveSse: false }, { liveSse: true }]
// to:
const fetchAndSse = [{ liveSse: false }]

// client.test.ts — remove:
// - describe('Shape - SSE') block (lines ~1338-1537)
// - describe('Shape - changes_only mode') block (lines ~1542-2645)
// - SSE fallback tests (lines ~2648-3047)
// - change fetchAndSse to [{ liveSse: false }]
```

---

## Testing Strategy Summary

### Test Pyramid

```
         /\
        /  \     System: TS integration tests (existing)
       /    \    ~50 tests against full stack
      /------\
     /        \   Compositional: HTTP + MemoryStorage
    /          \  ~100 tests, no PostgreSQL needed
   /------------\
  /              \ Unit: isolated components
 /                \ ~500+ tests, pure Go, no I/O
/------------------\
```

### Compositional Testing Seams

| Seam | Real | Mock/Stub |
|------|------|-----------|
| Storage | MemoryStorage (real, in-process) | — |
| PostgreSQL | — | Mock PgConnector (for unit), Real PG (for integration) |
| HTTP | httptest.Server (real) | — |
| ReplicationClient | — | Channel-based mock (feed test TransactionFragments) |
| SnapshotQuery | — | Function that returns hardcoded rows |
| Time | — | Inject clock interface for cursor/timeout tests |

### Storage Equivalence Tests

```
For each test case:
  Execute(MemoryStorage)  → expected
  Execute(SQLiteStorage)  → actual
  Assert expected == actual
```

This guarantees that the SQLite implementation (which has I/O, serialization, and SQL complexity) behaves identically to the trivially-correct in-memory implementation.

---

## Go Dependencies

```
github.com/jackc/pgx/v5          # PostgreSQL driver + replication protocol
github.com/pganalyze/pg_query_go # PostgreSQL SQL parser (libpg_query binding)
modernc.org/sqlite                # Pure Go SQLite (no CGO)
github.com/stretchr/testify       # Test assertions
```

Optional:
```
github.com/go-chi/chi/v5          # HTTP router (or use stdlib)
```
