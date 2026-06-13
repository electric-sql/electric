# Benchmark results: Rust vs Node server

Date: 2026-06-13. Machine: macOS, 10 cores, 16 GB RAM, Apple SSD.
Both servers file-backed with per-append durable fsync (Node: libuv fdatasync =
F_BARRIERFSYNC; Rust: F_BARRIERFSYNC, coalesced). Same Node-based load clients for
both servers. Rust built `--release`. Raw result JSONs were produced into
`.streams-dev/results-{rust,node}.json` (not checked in).

## 1. Official suite (`@durable-streams/benchmarks`, via TS client)

| Metric (mean)                                      | Node server           | Rust server           | Improvement |
| -------------------------------------------------- | --------------------- | --------------------- | ----------- |
| Latency overhead (append→long-poll RTT minus ping) | 18.81 ms              | 0.53 ms               | **35×**     |
| Small-message throughput (100 B, concurrency 75)   | 4,516 msg/s           | 88,586 msg/s          | **19.6×**   |
| Large-message throughput (1 MB)                    | 342 msg/s (~342 MB/s) | 730 msg/s (~730 MB/s) | **2.1×**    |

## 2. Scale-out raw HTTP appends (one POST per 100 B message, N worker processes × 75 lanes)

| Workers | Node server | Rust server  |
| ------- | ----------- | ------------ |
| 1       | 185 msg/s   | 15,480 msg/s |
| 2       | 147 msg/s   | 23,508 msg/s |
| 4       | 189 msg/s   | 20,385 msg/s |

Rust is **~80–120×** on unbatched appends. The official suite's smaller gap is the TS
client batching appends before they reach the server. Rust plateaus ~20–23k msg/s at
~2.6 of 10 cores — bounded by SSD barrier-fsync capacity plus load-generator CPU, not
by the server.

## 3. Scale-out catch-up reads (full reads of a 10 MB stream, 16 lanes/worker)

| Workers | Node server | Rust server |
| ------- | ----------- | ----------- |
| 2       | 340 MB/s    | 2,550 MB/s  |
| 4       | —           | 3,072 MB/s  |

Rust is **~8–9×**, still scaling at 4 workers; the Node _client_ processes saturate
their cores parsing 3 GB/s before the Rust server does (page-cache reads).

## Saturation notes

- Append path: disk fsync-bound (physical limit of one SSD), not server-bound.
- Read path: load-generator-bound. Pushing further needs either a compiled load
  generator (oha/wrk-style) or more machines — stopped here per compute budget.

## Reproduce

```bash
cargo build --release --manifest-path packages/server-rust/Cargo.toml
packages/server-rust/target/release/durable-streams-server --port 4564 --data-dir .streams-dev/bench-rust &
BENCH_URL=http://localhost:4564 BENCH_ENV=rust pnpm exec vitest bench --run \
  --config packages/server-rust/bench/vitest.bench.config.ts

PORT=4565 DATA_DIR=.streams-dev/bench-node pnpm exec tsx packages/server-rust/bench/node-server.ts &
BENCH_URL=http://localhost:4565 BENCH_ENV=node pnpm exec vitest bench --run \
  --config packages/server-rust/bench/vitest.bench.config.ts

# scale-out (append / read)
BENCH_URL=http://localhost:4564 WORKERS=4 CONCURRENCY=75 node packages/server-rust/bench/scale-out.ts
MODE=read SEED_MB=10 BENCH_URL=http://localhost:4564 WORKERS=4 CONCURRENCY=16 node packages/server-rust/bench/scale-out.ts
```

Delete `.streams-dev/bench-*` after runs.

## Post-fork regression check (2026-06-13)

After adding fork support (chained segment reads; reads no longer touch the
appender lock): latency overhead 0.53 ms (unchanged), scale-out appends
24,022 msg/s (was 23,508), scale-out reads 2,559 MB/s (was 2,550). No regressions.
