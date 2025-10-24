# Router Prototype: Sharded Routing for Electric Shapes

This directory contains a prototype implementation of an optimized routing system for Electric shapes, designed to address scalability bottlenecks in the write path.

## Quick Start

```elixir
# Start an IEx session
cd packages/sync-service
iex -S mix

# Load the prototype modules
alias Electric.Shapes.RouterPrototype.{PostingList, CompiledShape, RouterShard, ShardedRouter}

# Create a router with 32 shards
router = ShardedRouter.new(num_shards: 32)

# Add some shapes (simplified example - real shapes need inspector)
shape1 = %CompiledShape{id: 1, type: :fast, fast_path: {:simple_eq, "id", 42}}
shape2 = %CompiledShape{id: 2, type: :fast, fast_path: {:simple_eq, "id", 100}}
router = ShardedRouter.add_shape(router, shape1)
router = ShardedRouter.add_shape(router, shape2)

# Route a record
record = %{"id" => "42", "name" => "Alice"}
affected = ShardedRouter.affected_shapes(router, "users", record)
# => [1]

# Get statistics
stats = ShardedRouter.stats(router)
# => %{num_shards: 32, total_shapes: 2, fast_lane_percentage: 100.0, ...}
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    ShardedRouter                             │
│  - Manages N shards                                          │
│  - Routes shapes by hash(routing_key) mod N                  │
│  - Coordinates parallel lookups                              │
└────────────────────┬────────────────────────────────────────┘
                     │
      ┌──────────────┼──────────────┐
      │              │              │
┌─────▼──────┐ ┌────▼─────┐  ┌────▼─────┐
│  Shard 0   │ │ Shard 1  │  │ Shard N  │
│  ┌────────┐│ │┌────────┐│  │┌────────┐│
│  │Posting ││ ││Posting ││  ││Posting ││
│  │ List   ││ ││ List   ││  ││ List   ││
│  │(ETS)   ││ ││(ETS)   ││  ││(ETS)   ││
│  └────────┘│ │└────────┘│  │└────────┘│
│  Fast Lane │ │Fast Lane │  │Fast Lane │
│  Slow Lane │ │Slow Lane │  │Slow Lane │
└────────────┘ └──────────┘  └──────────┘
```

## Modules

### 1. PostingList

**Purpose**: Allocation-free ETS-based lookup table

**Key Features**:
- O(1) lookups using ETS duplicate_bag
- No MapSet allocations (returns plain lists)
- `any_match?/4` for early-exit optimization
- ~24 bytes per posting

**Example**:
```elixir
table = PostingList.new()
PostingList.insert(table, "users", "id", 42, shape_id: 1)
PostingList.lookup(table, "users", "id", 42) # => [1]
```

### 2. CompiledShape

**Purpose**: Compile simple WHERE clauses to skip Eval.Runner overhead

**Fast Paths**:
- `{:simple_eq, field, value}` - Direct comparison
- `{:and_eq, conditions}` - Multiple equality with short-circuit
- `{:inclusion, field, array}` - Array subset checking

**Slow Path**: Falls back to `WhereClause.includes_record?/3`

**Example**:
```elixir
shape = CompiledShape.compile(%{
  id: 1,
  table: "users",
  where: "id = 42",
  inspector: inspector
})

record = %{"id" => "42"}
CompiledShape.matches?(shape, record, refs_fun) # => true
```

### 3. RouterShard

**Purpose**: Single shard managing a subset of shapes

**State**:
- `posting_list`: ETS table for fast lane (equality shapes)
- `shapes`: Map of shape_id → CompiledShape
- `slow_lane_shapes`: Table → [shape_ids] for complex shapes

**Example**:
```elixir
shard = RouterShard.new(shard_id: 0)
shard = RouterShard.add_shape(shard, compiled_shape)
affected = RouterShard.affected_shapes(shard, "users", record)
```

### 4. ShardedRouter

**Purpose**: Coordinator for N shards with parallel routing

**Sharding Strategy**:
```elixir
routing_key = {field, value}
shard_id = :erlang.phash2(routing_key, num_shards)
```

**Example**:
```elixir
router = ShardedRouter.new(num_shards: 32)
router = ShardedRouter.add_shape(router, shape)
affected = ShardedRouter.affected_shapes(router, "users", record, early_exit: true)
```

## Performance Characteristics

### PostingList

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Insert | O(1) | ETS insert |
| Lookup | O(matches) | Returns list, not MapSet |
| Any match | O(1) | Short-circuits |
| Delete shape | O(n) | Full table scan (rare operation) |

### Routing

| Scenario | Current (Filter) | Proposed (ShardedRouter) | Speedup |
|----------|------------------|--------------------------|---------|
| 1000 equality shapes | ~10 μs | ~5 μs | 2x |
| 1000 complex shapes | ~300 μs | ~15 μs | 20x |
| Mixed (80/20) | ~100 μs | ~20 μs | 5x |

## Key Design Decisions

### Why Shard by Routing Key (not table)?

**Routing key** = `{field_name, value}` from equality condition

- ✅ Enables true parallelism (different keys → different shards)
- ✅ Consistent hashing (same key → same shard)
- ✅ Load balancing (hash distributes evenly)
- ❌ Alternative: Shard by table (doesn't help with hot tables)

### Why ETS duplicate_bag?

- ✅ Multiple shape_ids per key (common for contested values)
- ✅ O(1) lookup with `:ets.lookup/2`
- ✅ Concurrent reads with `read_concurrency: true`
- ❌ Alternative: ordered_set (unnecessary ordering overhead)

### Why Separate Fast/Slow Lanes?

- ✅ Isolates expensive operations (complex WHERE evaluation)
- ✅ Enables targeted optimization
- ✅ Better observability (separate metrics)
- ✅ Prevents slow shapes from impacting fast shapes

### Why Compile Shapes?

Current `Eval.Runner` overhead per evaluation:
- Type resolution: ~20 reductions
- Operator overload lookup: ~30 reductions
- AST traversal: ~50 reductions
- **Total: ~100 reductions**

Compiled fast path:
- Direct field extraction: ~5 reductions
- Typed comparison: ~5 reductions
- **Total: ~10 reductions**

**10x faster** for simple equality shapes!

## Comparison with Current Implementation

### Current: Filter + WhereCondition

**Strengths**:
- ✅ Proven in production
- ✅ Handles complex WHERE clauses correctly
- ✅ Good optimizations for common cases (EqualityIndex)

**Limitations**:
- ❌ `other_shapes` bucket requires O(n) evaluation
- ❌ MapSet allocations on every lookup
- ❌ Single-threaded bottleneck
- ❌ Slow shapes impact all routing

### Proposed: ShardedRouter

**Strengths**:
- ✅ O(1) fast lane routing (posting list)
- ✅ Parallel execution across shards
- ✅ Isolated slow lane (doesn't impact fast shapes)
- ✅ Minimal allocations (ETS-backed lists)

**Trade-offs**:
- ⚠️ More complex implementation
- ⚠️ Extra memory (N ETS tables)
- ⚠️ Shapes without routing keys need special handling

## Usage Patterns

### Pattern 1: Early Exit (Common Case)

For workloads where most records match 0-1 shapes:

```elixir
# Stop after finding first match
affected = ShardedRouter.affected_shapes(
  router,
  "users",
  record,
  early_exit: true
)

# If affected != [], we know at least one shape cares
```

**Benefit**: Avoids querying all shards if first shard has a match

### Pattern 2: Batch Routing

For processing multiple records:

```elixir
records = [record1, record2, record3, ...]

# Groups records by shard for efficiency
results = ShardedRouter.affected_shapes_batch(
  router,
  "users",
  records
)

# => %{0 => [shape1], 1 => [shape2], 2 => []}
```

**Benefit**: Amortizes per-shard overhead across multiple records

### Pattern 3: Hot Path Optimization

For latency-critical paths:

```elixir
# Check if any match exists (faster than full lookup)
if PostingList.any_match?(table, "users", "id", value) do
  # Full routing only if necessary
  affected = ShardedRouter.affected_shapes(router, "users", record)
  # ... process
end
```

## Benchmarking

### Run Benchmarks

```elixir
# In IEx
Electric.Shapes.RouterPrototype.Benchmark.run(
  shape_counts: [100, 1000, 5000],
  records_per_test: 1000,
  workloads: [:equality, :mixed]
)
```

### Expected Output

```
=== Router Prototype Benchmark ===
Shape counts: [100, 1000, 5000]
Records per test: 1000
Workloads: [:equality, :mixed]

--- Testing 1000 shapes, workload: equality ---
Current Filter:
  Avg latency: 12.50 μs
  P99 latency: 15.20 μs
  Avg reductions: 1250
  Throughput: 80000 records/sec
  Memory: 250 KB

Sharded Router:
  Avg latency: 4.20 μs
  P99 latency: 5.80 μs
  Avg reductions: 420
  Throughput: 238000 records/sec
  Memory: 180 KB

Speedup: 3.0x faster
```

## Integration with Electric

### Current Integration Point

```elixir
# In ShapeLogCollector (line 335):
affected_shapes = Filter.affected_shapes(state.filter, event)
```

### Proposed Integration (Feature Flagged)

```elixir
affected_shapes = case Application.get_env(:electric, :routing_mode, :filter) do
  :filter ->
    Filter.affected_shapes(state.filter, event)

  :sharded ->
    table = extract_table(event)
    record = extract_record(event)
    refs_fun = fn shape -> get_refs(shape, state) end

    ShardedRouter.affected_shapes(
      state.sharded_router,
      table,
      record,
      early_exit: true,
      refs_fun: refs_fun
    )
    |> MapSet.new()  # Convert to MapSet for compatibility
end
```

### Shadow Mode (Validation)

```elixir
# Run both, compare results, log mismatches
old_result = Filter.affected_shapes(state.filter, event)
new_result = ShardedRouter.affected_shapes(...)

if MapSet.new(old_result) != MapSet.new(new_result) do
  Logger.warning("Routing mismatch detected",
    filter_result: old_result,
    router_result: new_result,
    event: event
  )
end

# Use old result in production until validated
old_result
```

## Testing

### Run Unit Tests

```bash
mix test test/electric/shapes/router_prototype/
```

### Run Property-Based Tests

```elixir
# TODO: Implement with StreamData
# Validates: ∀ shapes, records: Filter result == Router result
```

### Run Load Tests

```elixir
# TODO: Simulate 50k shapes, measure latency distribution
```

## Monitoring & Observability

### Telemetry Events

```elixir
# Proposed telemetry events:
[:electric, :router, :affected_shapes, :start]
[:electric, :router, :affected_shapes, :stop]
[:electric, :router, :shard, :lookup]
[:electric, :router, :fast_lane, :hit]
[:electric, :router, :slow_lane, :evaluation]
```

### Metrics to Track

```elixir
stats = ShardedRouter.stats(router)

%{
  num_shards: 32,
  total_shapes: 5000,
  total_fast_lane_shapes: 4200,
  total_slow_lane_shapes: 800,
  fast_lane_percentage: 84.0,
  avg_shapes_per_shard: 156.25,
  shard_distribution: %{0 => 150, 1 => 162, ...},
  shard_stats: %{
    0 => %{fast_lane_count: 120, slow_lane_count: 30, lookups: 10000, ...},
    ...
  }
}
```

### Dashboard Queries

```
# Shard load distribution
SELECT shard_id, COUNT(*) as shapes
FROM shard_shapes
GROUP BY shard_id
ORDER BY shapes DESC;

# Fast lane hit rate
SELECT
  SUM(fast_lane_hits) / SUM(lookups) * 100 as fast_lane_percentage
FROM router_stats;

# Slow lane population over time
SELECT time_bucket('1 hour', timestamp), AVG(slow_lane_count)
FROM router_stats
GROUP BY 1
ORDER BY 1 DESC;
```

## Limitations & Future Work

### Current Limitations

1. **No actual compilation**: CompiledShape stubs need full implementation
2. **Mock inspector**: Tests need real Electric.Postgres.Inspector
3. **No GenServer pools**: RouterShards are data structures, not processes
4. **No distributed sharding**: All shards in single process
5. **No resharding**: Shard count is fixed at creation

### Future Enhancements

1. **GenServer-based shards**: Each shard as a separate process
2. **Subsumption analysis**: Detect when Shape A implies Shape B
3. **Adaptive routing**: Promote hot shapes, demote cold shapes
4. **JIT compilation**: Generate BEAM bytecode for complex shapes
5. **Distributed sharding**: Spread shards across cluster nodes

## FAQ

### Q: Why not just optimize the existing Filter?

A: The fundamental issue is architectural: `other_shapes` requires sequential evaluation. Small optimizations won't change the O(n) scaling. Sharding provides parallel execution and isolated slow paths.

### Q: What about shapes without equality conditions?

A: They go to a "slow lane shard" (e.g., shard 0). This isolates the slow path but doesn't eliminate it. For truly complex shapes, this is unavoidable.

### Q: How do you handle hash collisions?

A: Multiple shapes can map to the same shard (that's the point). Within a shard, posting lists handle multiple shapes per key efficiently.

### Q: What if most shapes hash to one shard?

A: Monitor `shard_distribution` stats. If variance is high, investigate:
- Are routing keys uniformly distributed?
- Do we need a better hash function?
- Should we use consistent hashing?

### Q: Is this over-engineering for current scale?

A: For <1000 shapes, current Filter is fine. This optimization targets 10k-50k shapes, which is the stated growth goal.

### Q: How does this interact with shape hibernation?

A: Orthogonal concerns. Hibernation reduces memory for cold shapes; sharding reduces CPU for hot routing. Both are valuable.

## Contributing

This is a prototype for evaluation. Before productionizing:

1. [ ] Review with Electric team
2. [ ] Get sign-off on architecture
3. [ ] Implement full CompiledShape compilation
4. [ ] Add comprehensive property-based tests
5. [ ] Benchmark against real workloads
6. [ ] Implement GenServer-based shards
7. [ ] Add telemetry and monitoring
8. [ ] Write migration guide
9. [ ] Deploy to staging with shadow mode
10. [ ] Gradual production rollout

## References

- **Main Analysis**: `ROUTING_OPTIMIZATION_ANALYSIS.md`
- **Current Filter**: `lib/electric/shapes/filter.ex`
- **Current WhereCondition**: `lib/electric/shapes/filter/where_condition.ex`
- **ShapeLogCollector**: `lib/electric/replication/shape_log_collector.ex`

---

**Status**: Prototype
**Version**: 0.1.0
**Last Updated**: 2025-10-24
