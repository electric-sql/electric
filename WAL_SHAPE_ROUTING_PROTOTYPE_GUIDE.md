# WAL→Shape Routing Optimization - Prototype Guide

## Current System Summary

Electric's shape routing processes each incoming WAL transaction through a two-stage filtering pipeline:

1. **Stage 1 - Routing** (ShapeLogCollector): Determines which shapes are affected by the transaction using optimized predicate indexes
2. **Stage 2 - Filtering** (Consumer): Applies shape-specific filtering and appends changes to individual shape logs

## Key Metrics to Measure

When building your prototype, measure these dimensions:

1. **Routing Latency**: Time to determine affected shapes (ShapeLogCollector.publish)
2. **Filtering Latency**: Time to apply shape-specific filters (Consumer.do_handle_txn)
3. **Throughput**: Transactions/second, changes/second
4. **Memory**: Size of Filter state, index structures
5. **Shape Log Append Time**: Time to write to storage

## Prototype Development Checklist

### Phase 1: Understand Current Flow
- [x] Read ShapeLogCollector (lines 329-363, handle_transaction flow)
- [x] Read Filter.affected_shapes implementation
- [x] Trace one change through full pipeline
- [x] Understand WhereCondition optimization strategy

### Phase 2: Identify Bottlenecks
- [ ] Add timing instrumentation to key functions:
  - Filter.affected_shapes
  - WhereCondition.affected_shapes
  - Consumer.filter_changes
  - ShapeCache.Storage.append_to_log!
- [ ] Benchmark with realistic shape subscriptions
- [ ] Profile with various WHERE clause patterns

### Phase 3: Design Optimization
- [ ] Prototype 2-3 different approaches
- [ ] Evaluate tradeoffs: throughput vs latency vs memory
- [ ] Consider integration with existing code

### Phase 4: Implementation
- [ ] Implement chosen approach
- [ ] Integrate with ShapeLogCollector routing
- [ ] Add comprehensive tests
- [ ] Benchmark vs baseline

## Suggested Optimization Approaches

### Option A: Batch Routing (Quick Win)
**Idea**: Route multiple shapes in parallel instead of sequentially

**Starting point**: ShapeLogCollector.publish (line 346-349)
**Current code**: Serial ConsumerRegistry.publish per layer
**Change**: Collect all shapes in layer, dispatch in parallel

**Pros**: Easy to implement, potentially 2-4x throughput gain
**Cons**: Doesn't improve Filter.affected_shapes latency

### Option B: Enhanced Index Structures
**Idea**: Add more optimizable WHERE patterns or use better data structures

**Starting point**: WhereCondition.optimise_where (lines 66-111)
**Current patterns**: field=const, array@>const, AND combinations
**Enhancements**:
- Range conditions (field > const, field < const)
- IN clauses (field IN (const1, const2, ...))
- Bitmap indexes for boolean fields
- Bloom filters for existence checks

**Pros**: Reduces full predicate evaluations
**Cons**: More complex index management, memory overhead

### Option C: Predicate Result Caching
**Idea**: Cache WHERE clause evaluation results for frequently seen records

**Starting point**: WhereClause.includes_record? (line 7-14)
**Approach**:
- Cache: Map<record_key, Set<matching_shape_ids>>
- Invalidate on: new shape subscription, shape deletion
- Use record's PK as cache key

**Pros**: High hit rate for repeated records
**Cons**: Cache invalidation complexity, memory usage

### Option D: WAL Operation Batching
**Idea**: Batch multiple changes before routing, amortize filter overhead

**Starting point**: ShapeLogCollector.publish (line 329)
**Approach**:
- Buffer incoming transactions
- Route batch of N changes together
- Share lookups across batch

**Pros**: Better data locality, reduced filter calls
**Cons**: Introduces latency, complexity

### Option E: Pre-computed Routing Maps
**Idea**: Build routing bitmaps for each operation type

**Starting point**: Filter structure initialization
**Approach**:
- For common patterns, pre-compute which shapes match
- Store as bitmaps or sparse matrices
- Update on shape subscription/deletion
- Use for rapid lookup during routing

**Pros**: Very fast routing lookups (O(1) typically)
**Cons**: Requires pre-computation, works best for static patterns

## File Structure for Prototyping

```
lib/electric/
├── shapes/
│   ├── filter.ex                    <- Add routing optimization here
│   ├── filter/
│   │   ├── where_condition.ex       <- Enhance pattern detection
│   │   └── indexes/                 <- Add new index types
│   ├── shape.ex                     <- Optimize convert_change?
│   └── consumer.ex                  <- Optimize filter_changes?
├── replication/
│   └── shape_log_collector.ex       <- Key orchestrator
└── shape_cache/
    └── storage.ex                   <- Append performance
```

## Testing Approach

### Unit Tests
- Test new index structures thoroughly
- Test optimization patterns with various WHERE clauses
- Compare results against baseline Filter

### Integration Tests
- Run existing shape tests to verify behavior
- Add tests for your optimization with real shapes

### Benchmarks
Create benchmarks in `test/support/`:
```elixir
defmodule Electric.Benchmarks.ShapeRouting do
  def benchmark_filter_affected_shapes do
    # Create various shape/change combinations
    # Measure Filter.affected_shapes performance
    # Compare before/after optimization
  end
  
  def benchmark_shape_filtering do
    # Measure Consumer.filter_changes performance
  end
  
  def benchmark_storage_append do
    # Measure append_to_log! performance with many shapes
  end
end
```

## Recommended Starting Point

1. **Add instrumentation first** (least risky):
   - Add telemetry/timing to key hot paths
   - Identify actual bottleneck with real workload
   - Don't optimize blindly

2. **Then try Option A (Batch Routing)**:
   - Highest ROI/effort ratio
   - Cleanest code impact
   - Measurable improvement

3. **Then evaluate Option B or C**:
   - Depends on bottleneck identified
   - More complex but potentially higher gains

## Key Facts About Current Architecture

### Strengths
- WhereCondition intelligently optimizes patterns
- EqualityIndex provides O(1) lookups for common case
- InclusionIndex handles complex array patterns efficiently
- Dependency layers ensure correct ordering

### Weaknesses
- All shapes in WhereCondition.other_shapes evaluated fully
- No caching of predicate evaluations
- Serial processing through layers
- No batching optimization at orchestrator level

### Constraints
- Must maintain exact shape semantics (all changes must be correct)
- Must handle schema changes (terminating affected shapes)
- Must respect PG snapshot boundaries
- Must maintain dependency ordering

## Performance Baseline Questions

Before prototyping, answer these:

1. How many concurrent shapes are typically active?
2. What are typical WHERE clause patterns?
3. What's the transaction rate (changes/sec)?
4. What's the change distribution across shapes?
5. Is latency or throughput the primary concern?
6. What's the memory budget per shape?

These answers drive which optimization is most valuable.

## Code Complexity Estimate

- **Option A (Batch Routing)**: 1-2 days (low complexity)
- **Option B (Enhanced Indexes)**: 3-5 days (medium complexity)
- **Option C (Predicate Caching)**: 2-3 days (medium complexity)
- **Option D (WAL Batching)**: 5-7 days (high complexity)
- **Option E (Pre-computed Maps)**: 3-4 days (medium-high complexity)

## Documentation Generated

This guide and architecture documentation have been saved:
- `/home/user/electric/SHAPE_ROUTING_ARCHITECTURE.md` - Complete architecture
- `/home/user/electric/SHAPE_ROUTING_CODE_REFERENCE.md` - Code locations and functions

## Next Steps

1. Choose optimization approach based on bottleneck
2. Study the existing implementations in detail
3. Create minimal prototype
4. Benchmark thoroughly
5. Refine based on results
6. Submit for code review

Good luck with your prototype!
