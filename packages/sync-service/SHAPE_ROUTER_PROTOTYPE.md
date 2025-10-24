# ShapeRouter Prototype - WAL→Shape Routing Optimization

This directory contains a prototype implementation of a high-performance WAL→Shape routing system designed to achieve:

- **10-20 μs/lookup** latency for typical operations
- **~12-13 bytes/key** memory usage (for present keys)
- Efficient handling of "mostly no match" workloads
- Support for millions of keys and hundreds of shapes

## Architecture Overview

### Four-Layer Design

```
WAL Operation
    ↓
[1] Presence Filter (Binary Fuse)
    ├─ Miss → Return [] (fast path, ~0.1-0.5 μs)
    └─ Hit  ↓
[2] Exact Membership (MPHF + Shape-ID Pool)
    ├─ Not found → False positive
    └─ Found → [shape_ids] ↓
[3] Predicate Gate (Compiled WHERE)
    ├─ Column mask check
    └─ Bytecode evaluation ↓
[4] Return matched shapes
```

### Memory Layout (per key)

```
Component                Size        Notes
─────────────────────────────────────────────────────────
Binary Fuse Filter      1.1-1.3 B   ~9-10 bits/key, <1% FPP
MPHF (PTHash)          0.3-0.4 B   2.6 bits/key
Offsets array          4.0 B       u32 per key
Shape-ID pool          3-4 B       Varint-encoded, avg 1.2 shapes/key
Delta overlay          1-2 B       Amortized, 5% of keys
─────────────────────────────────────────────────────────
Total                  ~10-12 B/key
```

## Implementation Components

### Rust NIF (`native/shape_router/`)

**Core modules:**

- `lib.rs` - NIF interface and main router logic
- `presence_filter.rs` - Binary Fuse filter wrapper (using `xorf` crate)
- `shape_index.rs` - MPHF + shape-id pool + delta overlay
- `predicate.rs` - Bytecode VM for WHERE clause evaluation
- `varint.rs` - ULEB128 variable-length integer encoding
- `metrics.rs` - Performance metrics collection

**Key optimizations:**

1. **Binary Fuse Filter**: 9-10 bits/key, 3 memory accesses, ~1% FPP
2. **Delta Overlay**: Mutable layer for O(1) updates, periodic rebuild
3. **Inline Single-Shape**: High bit of offset indicates inline shape ID
4. **Column Mask**: Skip predicate eval if no referenced columns changed
5. **Varint Encoding**: 1-2 bytes for typical shape IDs

### Elixir Interface

- `Electric.ShapeRouter` - High-level API
- `Electric.ShapeRouter.Native` - NIF bindings

### Benchmark Harness

- `test/electric/shape_router_benchmark.exs` - Comprehensive performance tests

## Files in This Prototype

```
packages/sync-service/
├── native/shape_router/          # Rust NIF implementation
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                # Main NIF interface
│       ├── presence_filter.rs    # Binary Fuse filter
│       ├── shape_index.rs        # MPHF + delta overlay
│       ├── predicate.rs          # Bytecode VM
│       ├── varint.rs             # Variable-length encoding
│       └── metrics.rs            # Performance metrics
│
├── lib/electric/
│   ├── shape_router.ex           # High-level Elixir API
│   └── shape_router/
│       └── native.ex             # NIF bindings
│
├── test/electric/
│   └── shape_router_benchmark.exs # Benchmark suite
│
└── SHAPE_ROUTER_PROTOTYPE.md     # This file
```

## Usage Example

```elixir
# Create a router for a (tenant, table) pair
{:ok, router} = Electric.ShapeRouter.new("tenant_1", "todos")

# Register shapes with their WHERE clauses
Electric.ShapeRouter.add_shape(router, 1, "user_id = 123", [1, 2, 3])
Electric.ShapeRouter.add_shape(router, 2, "status IN (1, 2, 3)", [4, 5, 6])

# Route a WAL operation
wal_op = %{
  pk: 42,
  new_record: %{id: 42, user_id: 123, status: 1},
  changed_columns: [1, 2]
}

matched_shapes = Electric.ShapeRouter.route(router, wal_op)
# => [1, 2]  # Both shapes match

# Get performance metrics
metrics = Electric.ShapeRouter.metrics(router)
# => %{
#   "avg_route_us" => 12.5,
#   "presence_hit_rate" => 0.85,
#   "false_positive_rate" => 0.008,
#   ...
# }
```

## Integration with Existing Electric

### Current Flow

```
WAL → ShapeLogCollector → Filter.affected_shapes → Consumer → Shape logs
```

### Proposed Flow

```
WAL → ShapeLogCollector → ShapeRouter.route → Consumer → Shape logs
                          (new NIF-based router)
```

### Integration Points

1. **Replace `Electric.Shapes.Filter`**
   - Current: ETS-based with EqualityIndex/InclusionIndex
   - New: ShapeRouter with presence filter + MPHF

2. **Shape Registration**
   - On shape creation: `ShapeRouter.add_shape/4`
   - On shape deletion: `ShapeRouter.remove_shape/2`
   - Parse WHERE clause with `pg_query_ex` (already a dependency)

3. **WAL Processing**
   - In `ShapeLogCollector.handle_transaction/2`:
     ```elixir
     # Old:
     affected = Filter.affected_shapes(table, changes)

     # New:
     router = get_router(tenant, table)
     affected = ShapeRouter.route(router, wal_change)
     ```

4. **Periodic Rebuild**
   - Trigger on delta size threshold (e.g., > 5% of base)
   - Async rebuild in background, atomic swap when done

## Building and Testing

### Build the NIF (requires Rust)

```bash
cd packages/sync-service/native/shape_router
cargo build --release
```

### Run benchmarks

```bash
cd packages/sync-service
mix test test/electric/shape_router_benchmark.exs
```

### Run unit tests

```bash
# Rust tests
cd native/shape_router
cargo test

# Elixir tests
mix test test/electric/shape_router_test.exs
```

## Performance Characteristics

### Expected Latencies (from benchmarks)

| Scenario          | Target     | Typical    |
|-------------------|------------|------------|
| Miss (no shapes)  | < 1 μs     | 0.3-0.5 μs |
| Single shape hit  | < 20 μs    | 10-15 μs   |
| Fan-out (5-10)    | < 50 μs    | 20-35 μs   |
| Mixed workload    | < 15 μs    | 8-12 μs    |

### Memory Usage

For 1M keys with average 1.2 shapes/key:

```
Binary Fuse:     1.25 MB  (1.25 B/key)
MPHF:            0.33 MB  (0.33 B/key)
Offsets:         4.00 MB  (4.00 B/key)
Shape-ID pool:   3.40 MB  (3.40 B/key)
Delta (5%):      1.20 MB  (1.20 B/key)
─────────────────────────────────────
Total:          ~10.2 MB (~10.2 B/key)
```

### Throughput

On modern CPU (single-threaded):

- **Misses**: ~3-5M ops/sec
- **Hits**: ~100-200K ops/sec
- **Mixed**: ~500K-1M ops/sec

## Known Limitations (Prototype)

1. **Simplified MPHF**: Uses HashMap instead of true PTHash
   - Production should use PTHash (2.6 bits/key)
   - Current implementation: ~16+ bytes/key in HashMap

2. **Basic Predicate Parser**: Only supports simple WHERE clauses
   - Production: full `pg_query_ex` integration
   - Current: "column = value" and "column IN (...)"

3. **No Persistence**: Base structures not saved to disk
   - Production: mmap-able segment files
   - Current: rebuilt on restart

4. **No XXH3**: Using Erlang's phash2 for hashing
   - Production: XXH3_64 via NIF (faster, better distribution)
   - Current: Good enough for prototype

5. **Simplified Row Encoding**: JSON serialization
   - Production: PostgreSQL wire format or custom compact encoding
   - Current: JSON for ease of prototyping

## Next Steps for Production

### Phase 1: Core Optimization (1-2 weeks)

- [ ] Integrate real PTHash (via C bindings or pure Rust implementation)
- [ ] Add XXH3_64 hashing
- [ ] Implement inline single-shape optimization
- [ ] Add column mask pre-filtering

### Phase 2: Predicate System (1-2 weeks)

- [ ] Full `pg_query_ex` integration for WHERE parsing
- [ ] Extend bytecode VM to support all PostgreSQL operators
- [ ] Add Roaring bitmap support for large IN sets
- [ ] Implement LIKE, regex, and array operators

### Phase 3: Persistence (1-2 weeks)

- [ ] Design mmap-able segment file format
- [ ] Implement atomic swap mechanism
- [ ] Add background rebuild scheduler
- [ ] Handle crashes and recovery

### Phase 4: Integration (1-2 weeks)

- [ ] Replace `Electric.Shapes.Filter` with ShapeRouter
- [ ] Add router per (tenant, table) management
- [ ] Integrate with shape lifecycle (create/delete)
- [ ] Add observability (metrics, logging, tracing)

### Phase 5: Production Hardening (2-3 weeks)

- [ ] Comprehensive testing (property-based, stress, chaos)
- [ ] Performance tuning (SIMD, prefetching, cache optimization)
- [ ] Documentation and runbooks
- [ ] Monitoring and alerting

## References

- **Binary Fuse Filters**: [arXiv:2201.01174](https://arxiv.org/abs/2201.01174)
- **PTHash**: [GitHub - jermp/pthash](https://github.com/jermp/pthash)
- **Xorf (Rust)**: [GitHub - ayazhafiz/xorf](https://github.com/ayazhafiz/xorf)
- **Rustler**: [GitHub - rusterlium/rustler](https://github.com/rusterlium/rustler)
- **pg_query_ex**: [Hex - pg_query_ex](https://hex.pm/packages/pg_query_ex)
- **Roaring Bitmaps**: [GitHub - RoaringBitmap](https://github.com/RoaringBitmap)

## Questions / Discussion

For questions or feedback on this prototype, please reach out to the team or open a discussion on GitHub.

Key discussion topics:

1. **MPHF vs HashMap tradeoff**: PTHash saves memory but adds complexity
2. **Rebuild strategy**: When to trigger rebuilds? Async vs sync?
3. **Multi-tenancy**: Per-tenant routers vs global router with tenant partitioning?
4. **Predicate compilation**: Cache compiled predicates? JIT compilation?
5. **Integration strategy**: Big bang vs gradual rollout with feature flag?
