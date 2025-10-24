# LSM-Based Route Index Prototype

This directory contains a prototype implementation of an LSM-style equality index for Electric's route filtering system.

## Overview

The prototype implements a log-structured merge (LSM) tree with minimal perfect hashing (MPH) for efficient, scalable route lookups with the following characteristics:

- **Target latency**: 10-20μs per lookup
- **Memory footprint**: ~12-13 bytes/key (estimated for production MPH)
- **Scale**: Designed for millions of keys
- **High churn**: Efficient constant add/remove operations
- **Multi-tenant**: Easy backup, migration, zero-downtime updates

## Architecture

### Core Components

1. **Overlay** (`overlay.rs`): Fast mutable hash table for recent changes
2. **Segments** (`segment.rs`): Immutable MPH-based indexes (simplified for prototype)
3. **Lanes** (`lane.rs`): Partitioned LSM trees for bounded read amplification
4. **Compaction** (`compaction.rs`): Background merging of overlay into segments
5. **Manifest** (`manifest.rs`): Atomic state tracking for zero-downtime updates

### Lookup Path

```
Key → Hash (SipHash-2-4) → Lane (Jump Consistent Hash)
                              ↓
                      Lane N Lookup:
                        1. Overlay (newest)
                        2. Segment L0
                        3. Segment L1
                        4. Segment L2
                        → Return first match
```

## Directory Structure

```
lsm_index_prototype/
├── rust/                   # Rust NIF implementation
│   ├── src/
│   │   ├── lib.rs         # NIF exports
│   │   ├── hash.rs        # SipHash + jump consistent hash
│   │   ├── overlay.rs     # Mutable overlay
│   │   ├── segment.rs     # Immutable segments
│   │   ├── lane.rs        # Lane-based partitioning
│   │   ├── compaction.rs  # Compaction logic
│   │   └── manifest.rs    # Manifest management
│   ├── benches/
│   │   └── lsm_bench.rs   # Criterion benchmarks
│   └── Cargo.toml
├── benchmark.exs           # Elixir benchmark script
└── README.md              # This file
```

## Building

**Note**: This is a prototype that demonstrates the design. The Rust NIF needs to be compiled to actually run.

To build the Rust NIF:

```bash
cd packages/sync-service/priv/lsm_index_prototype/rust
cargo build --release
```

To run Rust benchmarks:

```bash
cd packages/sync-service/priv/lsm_index_prototype/rust
cargo bench
```

To run Elixir benchmarks (requires NIF to be built):

```bash
cd packages/sync-service
mix run priv/lsm_index_prototype/benchmark.exs
```

## Usage

The LSM index implements the same `Index.Protocol` as the existing `EqualityIndex`:

```elixir
# Create index
index = LsmEqualityIndex.new(:int4, num_lanes: 64)

# Add shapes
index = Index.add_shape(index, 42, shape_id, and_where)

# Lookup
shapes = Index.affected_shapes(index, "user_id", record, shapes_map)

# Stats
stats = LsmEqualityIndex.stats(index)
# => %{
#   num_lanes: 64,
#   total_overlay_entries: 5000,
#   total_segment_entries: 95000,
#   total_segments: 6,
#   total_entries: 100000
# }
```

## Prototype Limitations

This is a **prototype for evaluation**, not production-ready code. Key limitations:

1. **No true MPH**: Uses simple HashMap instead of RecSplit/BBHash
2. **No persistence**: Segments aren't actually memory-mapped to disk
3. **Synchronous compaction**: No background worker pool
4. **No xor-filters**: Miss-heavy workload optimization not implemented
5. **Simplified merging**: Production would use leveled compaction with size ratios
6. **Limited error handling**: Production needs comprehensive error recovery
7. **No metrics/monitoring**: Production needs observability

## Production Roadmap

To take this to production:

### Phase 1: Core Infrastructure
- [ ] Implement true RecSplit or BBHash MPH
- [ ] Add memory-mapped segment files
- [ ] Implement atomic manifest swaps
- [ ] Add checksum verification

### Phase 2: Performance
- [ ] Background compaction worker pool
- [ ] Leveled compaction with size ratios
- [ ] xor-filters for miss-heavy workloads
- [ ] SIMD optimizations where applicable

### Phase 3: Operations
- [ ] Comprehensive error handling
- [ ] Metrics and monitoring
- [ ] Backup/restore tooling
- [ ] Zero-downtime migration support
- [ ] Multi-tenant isolation

### Phase 4: Advanced Features
- [ ] Incremental segment loading
- [ ] Bloom filters for negative probes
- [ ] Adaptive compaction policies
- [ ] Query pattern optimization

## Key Design Decisions

### Why LSM?

- **Memory efficiency**: ~12-13 bytes/key vs ~20+ for hash maps at scale
- **Write efficiency**: O(1) inserts into overlay, background compaction
- **Read consistency**: Immutable segments + atomic swaps
- **Operational simplicity**: Segments are just files, easy backup/restore

### Why Lane Partitioning?

- **Bounded reads**: Max 3-4 segment probes regardless of total size
- **Parallel compaction**: Different lanes compact independently
- **Hot key handling**: Jump consistent hash distributes load
- **Cache locality**: Hot lanes stay in CPU cache

### Why Jump Consistent Hash?

- **Fast**: ~12 integer ops, <1μs
- **Stable**: Minimal key movement when lanes added/removed
- **No state**: Pure function, no lookup table
- **Uniform**: Good distribution properties

### Why SipHash?

- **DOS resistance**: Keyed hash prevents adversarial collisions
- **Fast enough**: ~2-3 cycles/byte on modern CPUs
- **64-bit**: Perfect size for fingerprints

## References

Key papers and resources referenced in the design:

- **LSM Trees**: [The Log-Structured Merge-Tree](https://www.cs.umb.edu/~poneil/lsmtree.pdf)
- **RecSplit**: [RecSplit: Minimal Perfect Hashing via Recursive Splitting](https://arxiv.org/abs/1910.06416)
- **BBHash**: [Fast and Scalable Minimal Perfect Hashing](https://github.com/rizkg/BBHash)
- **Jump Consistent Hash**: [A Fast, Minimal Memory, Consistent Hash Algorithm](https://arxiv.org/abs/1406.2294)
- **Xor Filters**: [Xor Filters: Faster and Smaller Than Bloom Filters](https://arxiv.org/abs/1912.08258)
- **Swiss Tables**: [Abseil Swiss Tables Design](https://abseil.io/about/design/swisstables)

## License

Same as Electric (Apache 2.0)
