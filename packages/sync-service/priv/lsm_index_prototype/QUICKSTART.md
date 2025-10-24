# LSM Index Prototype - Quick Start

**TL;DR**: This is a prototype of an LSM-based route index for Electric. Read `DESIGN_ANALYSIS.md` for full details.

## What Is This?

An alternative to `EqualityIndex` that uses LSM-tree architecture to support:
- Millions of keys (vs thousands)
- ~12-13 bytes/key memory (vs ~20-30)
- 10-20μs lookups
- Multi-tenant isolation
- Persistence

## 5-Minute Overview

### The Problem

Current `EqualityIndex` uses Elixir maps:
```elixir
%{value1 => condition1, value2 => condition2, ...}
```

Works great for thousands of keys, but:
- ~20-30 bytes per entry
- No persistence
- Hundreds of MB at millions of keys

### The Solution

LSM-tree with:
1. **Overlay**: Fast mutable hash table for recent changes
2. **Segments**: Immutable Minimal Perfect Hash indexes
3. **Lanes**: Partition keyspace for bounded read amplification
4. **Compaction**: Background merging

```
Lookup: Hash → Lane → Overlay → L0 → L1 → L2
                       ↑ Hot    ↑ Warm   ↑ Cold
                       ≤1μs     ≤10μs   ≤20μs
```

## File Overview

```
lsm_index_prototype/
├── DESIGN_ANALYSIS.md          ← Read this for full details
├── README.md                   ← Technical overview
├── QUICKSTART.md              ← You are here
├── rust/                       ← Rust NIF implementation
│   ├── src/
│   │   ├── lib.rs             ← NIF exports
│   │   ├── hash.rs            ← SipHash + jump hash
│   │   ├── overlay.rs         ← Mutable overlay
│   │   ├── segment.rs         ← Immutable segments
│   │   ├── lane.rs            ← LSM tree per lane
│   │   ├── compaction.rs      ← Compaction logic
│   │   └── manifest.rs        ← State tracking
│   ├── benches/lsm_bench.rs   ← Rust benchmarks
│   └── Cargo.toml
└── benchmark.exs               ← Elixir benchmarks
```

Elixir wrapper: `lib/electric/shapes/filter/indexes/lsm_equality_index.ex`

## Key Design Decisions

### 1. Lane Partitioning

Split keyspace into 64 lanes using jump consistent hash:
```
hash = SipHash(key)
lane = jump_consistent_hash(hash, 64)
```

**Why?**: Bounds read amplification. Each lane has max 3-4 segments, so worst-case lookup probes 4 structures (vs log(N) without lanes).

### 2. Minimal Perfect Hash (MPH)

Segments use MPH for O(1) lookup with ~1.56 bits/key metadata (RecSplit) or ~3 bits/key (BBHash).

**Why?**: ~12 bytes/key total vs ~20+ for hash tables.

### 3. Rust NIF

Core in Rust for:
- Memory control (no GC pressure)
- Memory-mapped I/O
- Cache-friendly data structures

**Why?**: Hot path (called on every transaction). Performance matters.

### 4. Background Compaction

Overlay → Segment compaction runs in background threads.

**Why?**: Can't block BEAM scheduler (compaction takes 100ms-1s).

## How It Works

### Insert Path

```elixir
# Elixir
index = Index.add_shape(index, value, shape_id, and_where)

# Under the hood:
# 1. Hash value → lane
# 2. Insert into lane's overlay (Rust NIF)
# 3. Maybe trigger compaction if overlay full
# 4. Return new Elixir struct
```

### Lookup Path

```elixir
# Elixir
shapes = Index.affected_shapes(index, field, record, shapes_map)

# Under the hood:
# 1. Hash record[field] → lane
# 2. Check lane overlay → return if found
# 3. Check lane L0 segment → return if found
# 4. Check lane L1 segment → return if found
# 5. Return None
```

### Compaction

```
Overlay (10K entries, fills in ~1 min)
    ↓ compact (background thread)
New L0 Segment (immutable)
    ↓ merge when too many segments
L1 Segment (merged)
```

## Prototype vs Production

| Feature | Prototype | Production |
|---------|-----------|------------|
| Segments | HashMap | RecSplit/BBHash MPH |
| Storage | In-memory | Memory-mapped files |
| Compaction | Sync | Background workers |
| Persistence | No | Yes (manifest + segments) |
| Error handling | Basic | Comprehensive |
| Metrics | None | Prometheus |

**Prototype goal**: Validate design, not production-ready.

## Building (Optional)

The prototype includes Rust source but you don't need to build it to review the design.

If you want to run benchmarks:

```bash
cd rust
cargo build --release
cargo bench
```

## Reading Guide

**If you have 5 minutes**: Read this file (QUICKSTART.md)

**If you have 30 minutes**: Read README.md + skim Rust code

**If you have 2 hours**: Read DESIGN_ANALYSIS.md

**If you want to implement**: Read all docs + code

## Questions to Consider

1. **Do we need this?**
   - Current memory usage per table?
   - Expected max keys per table?
   - Timeline for multi-tenant isolation?

2. **Is the design sound?**
   - Latency acceptable?
   - Memory savings worth complexity?
   - Operational burden acceptable?

3. **What's the priority?**
   - Blocking scale issues now?
   - Or nice-to-have for future?

## Next Steps

1. **Review DESIGN_ANALYSIS.md** for full context
2. **Discuss as team**:
   - Scale requirements
   - Risk tolerance
   - Engineering capacity
3. **Decide**: Build it, defer it, or alternative approach

## Contact

Questions? Discuss in team sync or comment on the design doc.

**Location**: `packages/sync-service/priv/lsm_index_prototype/`
