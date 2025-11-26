# Int-Mapping + SQLite + SIEVE Cache Prototype

This document analyzes the potential memory savings from replacing in-memory shape data with integer-mapped objects stored in SQLite, fronted by a SIEVE cache.

## Current Memory Model Analysis

### Baseline: 200k shapes = ~500MB RAM
**Average per shape: ~2.5KB**

### ETS Tables (4 per stack)

| Table | Key | Value | Memory per Shape |
|-------|-----|-------|------------------|
| `shape_hash_lookup_table` | `Shape.comparable()` tuple | shape_handle (String) | ~400-800 bytes |
| `shape_meta_table` | shape_handle (String ~24 bytes) | `{handle, Shape.t(), bool, LogOffset}` | ~1.5-2KB |
| `shape_relation_lookup_table` | `{oid, shape_handle}` tuple | nil | ~40 bytes per relation |
| `shape_last_used_table` | shape_handle (String) | `{handle, monotonic_time}` | ~40 bytes |

### Shape Handle Format
```elixir
"#{hash}-#{DateTime.utc_now() |> DateTime.to_unix(:microsecond)}"
# Example: "12345-1732000000000000" (~24 bytes as binary)
```

### Shape Struct Memory Breakdown
```elixir
%Shape{
  root_table: {"public", "users"},        # ~30 bytes (tuple + 2 binaries)
  root_table_id: 16384,                   # 8 bytes (small int)
  root_pk: ["id", "tenant_id"],           # ~32 bytes (list + binaries)
  root_column_count: 10,                  # 8 bytes
  selected_columns: [...],                # ~100-500 bytes (list of binaries)
  explicitly_selected_columns: [...],     # ~100-500 bytes
  where: %Expr{query: "...", eval: ...},  # ~200-2000 bytes (AST can be large)
  shape_dependencies: [],                 # 8 bytes if empty
  shape_dependencies_handles: [],         # 8 bytes if empty
  flags: %{selects_all_columns: true},    # ~48 bytes
  storage: %{compaction: :disabled},      # ~48 bytes
  replica: :default,                      # 8 bytes (atom)
  log_mode: :full                         # 8 bytes (atom)
}
# Total: ~600-3500 bytes per shape
```

### Shape.comparable() Key (used as ETS key)
```elixir
{:shape,
  {root_table_id, root_table},    # ~38 bytes
  root_pk,                        # ~32 bytes
  {:eval_expr, query, returns},   # ~100-500 bytes
  selected_columns,               # ~100-500 bytes
  sorted_flags,                   # ~16 bytes
  replica,                        # 8 bytes
  log_mode}                       # 8 bytes
# Total: ~300-1100 bytes per comparable key
```

## Memory Distribution Estimate (200k shapes, 500MB)

| Component | Bytes per Shape | Total | % |
|-----------|-----------------|-------|---|
| shape_hash_lookup_table keys | ~500 | 100MB | 20% |
| shape_hash_lookup_table values (handles) | ~32 | 6.4MB | 1.3% |
| shape_meta_table (handle + Shape + metadata) | ~2000 | 400MB | 80% |
| shape_relation_lookup_table | ~50 | 10MB | 2% |
| shape_last_used_table | ~50 | 10MB | 2% |
| **Total** | ~2632 | ~526MB | 100% |

## Proposed Architecture: Int-Mapping + SQLite + SIEVE

### Core Idea

1. **Replace string shape_handles with 64-bit integers**
2. **Store Shape structs in SQLite** (serialized as JSON or term_to_binary)
3. **Use SIEVE cache** for hot shapes in memory
4. **Keep minimal ETS indexes** using integer keys

### Component Design

```
┌─────────────────────────────────────────────────────────────────┐
│                         API Layer                                │
│    (shape_handle returned to clients is still the string)       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ShapeStatus (modified)                        │
│                                                                  │
│  ETS: shape_handle_to_int                                       │
│       Key: string handle  →  Value: int64 internal_id           │
│                                                                  │
│  ETS: int_to_handle (reverse lookup for API)                    │
│       Key: int64  →  Value: string handle                       │
│                                                                  │
│  ETS: shape_hash_to_int                                         │
│       Key: Shape.comparable() hash (int32)  →  Value: int64     │
│                                                                  │
│  ETS: shape_relation_lookup (int keys)                          │
│       Key: {oid, int64}  →  Value: nil                          │
│                                                                  │
│  Counter: next_internal_id (atomics)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SIEVE Cache Layer                           │
│                                                                  │
│  Capacity: ~50k-100k shapes in memory                           │
│                                                                  │
│  Data Structure:                                                 │
│  - ETS table: {int64 → {Shape.t(), visited_bit, queue_pos}}    │
│  - FIFO queue: :queue or linked list via ETS                    │
│  - Hand pointer: atomics ref                                    │
│                                                                  │
│  Operations:                                                     │
│  - get(int_id) → Shape.t() | :miss                              │
│  - put(int_id, shape) → evicted_ids                             │
│  - touch(int_id) → :ok (set visited bit)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SQLite Storage                              │
│                                                                  │
│  Database: :memory: or file-backed                              │
│                                                                  │
│  Table: shapes                                                   │
│  ┌─────────────┬──────────────┬────────────────┬──────────────┐ │
│  │ internal_id │ shape_handle │ shape_data     │ metadata     │ │
│  │ INTEGER PK  │ TEXT UNIQUE  │ BLOB           │ BLOB         │ │
│  └─────────────┴──────────────┴────────────────┴──────────────┘ │
│                                                                  │
│  Table: shape_hashes (for comparable lookup)                    │
│  ┌─────────────┬─────────────────┐                              │
│  │ hash        │ internal_id     │                              │
│  │ INTEGER     │ INTEGER FK      │                              │
│  └─────────────┴─────────────────┘                              │
│                                                                  │
│  Using: exqlite (NIF-based, fast)                               │
│  Journal mode: WAL                                              │
│  Pragmas: synchronous=OFF, temp_store=MEMORY                    │
└─────────────────────────────────────────────────────────────────┘
```

## Memory Estimates: Int-Mapping + SQLite + SIEVE

### Per-Shape Memory (In-Memory Components Only)

| Component | Current | New (Int Mapping) | Savings |
|-----------|---------|-------------------|---------|
| **Handle storage** | ~24 bytes string × 4 tables | 8 bytes int × 3 tables | -72 bytes |
| **hash_lookup key** | ~500 bytes tuple | 4 bytes (int32 hash) | -496 bytes |
| **hash_lookup value** | ~24 bytes string | 8 bytes int | -16 bytes |
| **meta table** | ~2000 bytes (full shape) | Cache only (0 if cold) | -2000 bytes |
| **relation_lookup** | ~50 bytes | ~16 bytes (int keys) | -34 bytes |
| **last_used** | ~50 bytes | 0 (SIEVE replaces) | -50 bytes |
| **SIEVE overhead** | 0 | ~20 bytes per cached | +20 bytes (hot only) |

### Memory Model Comparison (1 Million Shapes)

#### Current Approach (Extrapolated)
```
1M shapes × 2.5KB = 2.5GB RAM
```

#### Int-Mapping + SQLite + SIEVE (100k cache)

**Always in memory (per shape):**
- `shape_handle_to_int` ETS: 24 + 8 bytes = 32 bytes
- `int_to_handle` ETS: 8 + 24 bytes = 32 bytes
- `shape_hash_to_int` ETS: 4 + 8 bytes = 12 bytes
- `shape_relation_lookup` ETS: 8 + 8 bytes = 16 bytes per relation

**Per shape total (minimal):** ~90 bytes

**SIEVE cache (hot shapes only, 100k):**
- Full Shape.t(): ~1.5KB average
- SIEVE metadata: ~20 bytes
- **Per cached shape:** ~1.5KB

**SQLite storage (all shapes):**
- On disk (or in SQLite's memory with its own management)
- shape_data BLOB: ~1KB (compressed term_to_binary)
- Indexes: ~100 bytes per shape

### Final Estimate

| Component | 1M Shapes | Notes |
|-----------|-----------|-------|
| **ETS indexes (minimal)** | 90MB | 90 bytes × 1M |
| **SIEVE cache (100k hot)** | 150MB | 1.5KB × 100k |
| **SQLite in-memory** | ~200MB | With WAL + indexes |
| **SQLite on-disk** | ~0 (RAM) | Just file I/O |
| **Total (in-memory SQLite)** | ~440MB | |
| **Total (file-backed SQLite)** | ~240MB | |

### Comparison Summary

| Scenario | Current | Int+SQLite+SIEVE (memory) | Int+SQLite+SIEVE (file) |
|----------|---------|---------------------------|-------------------------|
| 200k shapes | 500MB | 88MB | 48MB |
| 500k shapes | 1.25GB | 220MB | 120MB |
| 1M shapes | 2.5GB | 440MB | 240MB |
| 2M shapes | 5.0GB | 880MB | 480MB |

**Savings: 82-90% RAM reduction**

## SIEVE Cache Implementation (Elixir)

```elixir
defmodule Electric.ShapeCache.SieveCache do
  @moduledoc """
  SIEVE cache implementation for shape data.

  SIEVE is simpler than LRU: on cache hit, just set visited=1.
  On eviction, scan from hand position, clearing visited bits until
  finding an unvisited entry to evict.
  """

  use GenServer

  defstruct [
    :cache_table,      # ETS: int_id -> {shape, visited}
    :queue,            # :queue of int_ids (FIFO insertion order)
    :hand_ref,         # atomics reference for hand position
    :capacity,
    :size
  ]

  def start_link(opts) do
    capacity = Keyword.fetch!(opts, :capacity)
    GenServer.start_link(__MODULE__, capacity, name: __MODULE__)
  end

  def init(capacity) do
    cache_table = :ets.new(:sieve_cache, [:set, :public, read_concurrency: true])
    hand_ref = :atomics.new(1, signed: false)

    {:ok, %__MODULE__{
      cache_table: cache_table,
      queue: :queue.new(),
      hand_ref: hand_ref,
      capacity: capacity,
      size: 0
    }}
  end

  @doc "Get shape from cache, returns :miss if not cached"
  def get(int_id) do
    case :ets.lookup(:sieve_cache, int_id) do
      [{^int_id, shape, _visited}] ->
        # Set visited bit (SIEVE touch operation)
        :ets.update_element(:sieve_cache, int_id, {3, 1})
        {:ok, shape}
      [] ->
        :miss
    end
  end

  @doc "Put shape in cache, may trigger eviction"
  def put(int_id, shape) do
    GenServer.call(__MODULE__, {:put, int_id, shape})
  end

  def handle_call({:put, int_id, shape}, _from, state) do
    state = maybe_evict(state)

    :ets.insert(state.cache_table, {int_id, shape, 0})
    queue = :queue.in(int_id, state.queue)

    {:reply, :ok, %{state | queue: queue, size: state.size + 1}}
  end

  defp maybe_evict(%{size: size, capacity: cap} = state) when size < cap, do: state

  defp maybe_evict(state) do
    # SIEVE eviction: scan from hand, clear visited bits, evict first unvisited
    {victim_id, new_queue} = find_victim(state.queue, state.cache_table)
    :ets.delete(state.cache_table, victim_id)
    %{state | queue: new_queue, size: state.size - 1}
  end

  defp find_victim(queue, cache_table) do
    {{:value, int_id}, rest} = :queue.out(queue)

    case :ets.lookup(cache_table, int_id) do
      [{^int_id, _shape, 0}] ->
        # Not visited, evict this one
        {int_id, rest}

      [{^int_id, _shape, 1}] ->
        # Visited, clear bit and move to back of queue
        :ets.update_element(cache_table, int_id, {3, 0})
        find_victim(:queue.in(int_id, rest), cache_table)

      [] ->
        # Entry was removed externally, skip
        find_victim(rest, cache_table)
    end
  end
end
```

## SQLite Schema

```sql
-- Main shapes table
CREATE TABLE shapes (
    internal_id INTEGER PRIMARY KEY,
    shape_handle TEXT UNIQUE NOT NULL,
    shape_data BLOB NOT NULL,          -- term_to_binary(Shape.t())
    snapshot_started INTEGER DEFAULT 0,
    latest_offset_tx INTEGER,
    latest_offset_op INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Hash lookup for Shape.comparable() -> internal_id
CREATE TABLE shape_hashes (
    hash INTEGER NOT NULL,
    internal_id INTEGER NOT NULL REFERENCES shapes(internal_id) ON DELETE CASCADE,
    PRIMARY KEY (hash)
);

-- Relation lookup for efficient "which shapes use this table?" queries
CREATE TABLE shape_relations (
    oid INTEGER NOT NULL,
    internal_id INTEGER NOT NULL REFERENCES shapes(internal_id) ON DELETE CASCADE,
    PRIMARY KEY (oid, internal_id)
);
CREATE INDEX idx_shape_relations_oid ON shape_relations(oid);

-- Pragmas for performance
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;  -- 256MB memory-mapped I/O
PRAGMA cache_size = -64000;    -- 64MB page cache
```

## Implementation Phases

### Phase 1: Add exqlite dependency and basic infra
- Add `{:exqlite, "~> 0.23"}` to mix.exs
- Create `Electric.ShapeCache.SqliteStorage` module
- Create SQLite database schema

### Phase 2: Implement SIEVE cache
- Create `Electric.ShapeCache.SieveCache` module
- Concurrent-safe implementation with ETS + :queue

### Phase 3: Int-mapping layer
- Create `Electric.ShapeCache.IntMapper` module
- Atomic counter for internal IDs
- Bidirectional ETS mapping tables

### Phase 4: Integrate with ShapeStatus
- Modify `ShapeStatus` to use int-mapped lookups
- Shape retrieval goes: ETS index -> SIEVE cache -> SQLite
- Maintain API compatibility (return string handles)

### Phase 5: Benchmarking & tuning
- Memory benchmarks at 100k, 500k, 1M shapes
- Tune SIEVE cache size for hit rate
- SQLite pragma tuning

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| SQLite write contention | Single writer process, batch inserts |
| Cache miss latency | Pre-warm cache on startup, async prefetch |
| Complexity increase | Extensive testing, gradual rollout |
| SQLite NIF crashes | Dirty scheduler isolation, supervision |
| Hash collisions | Use full comparable() for verification |

## References

- [SIEVE: Simpler than LRU (NSDI '24)](https://www.usenix.org/conference/nsdi24/presentation/zhang-yazhuo)
- [exqlite - SQLite3 driver for Elixir](https://github.com/elixir-sqlite/exqlite)
- [ecto_sqlite3 - Ecto adapter](https://github.com/elixir-sqlite/ecto_sqlite3)
- [PR #3350 - Roaring Bitmaps optimization](https://github.com/electric-sql/electric/pull/3350)
