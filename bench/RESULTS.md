# Benchmark results: Rust vs Node server

Date: 2026-06-13. Both servers file-backed with per-append durable fsync
(Node: libuv `fdatasync` = `F_BARRIERFSYNC`; Rust: `F_BARRIERFSYNC` on macOS,
`fdatasync` on Linux, coalesced/group-commit). Same Node-based load clients for
every server, so cross-server numbers are comparable. Rust built `--release`.

Two Rust HTTP engines are compared:

- **rust-hyper** — `--http-engine hyper` (default): tokio + hyper.
- **rust-raw** — `--http-engine raw`: custom HTTP/1.1 loop. On Linux it serves
  read responses with **sendfile(2)** (kernel page cache → socket, zero userspace
  copy); on macOS it falls back to positioned reads (no sendfile), so on macOS
  rust-raw ≈ rust-hyper minus framework overhead.

---

## 1. macOS (10 cores, 16 GB, Apple SSD)

### Official suite (`@durable-streams/benchmarks`, via the TS client)

| Metric (mean)                    | Node     | rust-hyper | rust-raw   | best vs Node |
| -------------------------------- | -------- | ---------- | ---------- | ------------ |
| Latency overhead (RTT − ping)    | 19.76 ms | 0.85 ms    | 0.82 ms    | **24×**      |
| Small messages (100 B, conc. 75) | 4,214 /s | 116,319 /s | 106,707 /s | **28×**      |
| Large messages (1 MB)            | 324 /s   | 977 /s     | 1,112 /s   | **3.4×**     |

### Scale-out raw HTTP (2 worker processes, one request per message)

| Workload                          | Node     | rust-hyper | rust-raw   | best vs Node |
| --------------------------------- | -------- | ---------- | ---------- | ------------ |
| Unbatched appends (100 B, 150 ln) | 131 /s   | 30,386 /s  | 31,233 /s  | **~238×**    |
| Catch-up reads (10 MB, 32 lanes)  | 351 MB/s | 3,580 MB/s | 3,957 MB/s | **11×**      |

## 2. Linux (Docker, release) — where sendfile applies

| Workload                           | rust-hyper  | rust-raw (sendfile) |
| ---------------------------------- | ----------- | ------------------- |
| Unbatched appends (100 B)          | 25,220 /s   | 25,661 /s           |
| Catch-up reads (10 MB)             | 1,524 MB/s  | 1,556 MB/s          |
| **Server CPU at ~1,580 MB/s read** | **113.9 %** | **11.8 %**          |

**The zero-copy headline:** at equal read throughput, the sendfile engine uses
~**10× less server CPU** (one core's worth of work shrinks to a tenth). Read
throughput is _equal_ only because the Node load-generator processes saturate
first — the raw engine has an order of magnitude more headroom that a heavier
client (or TLS-via-kTLS, or more readers) would expose.

## Why each optimization matters (recap)

| Optimization                             | What it buys                                                 |
| ---------------------------------------- | ------------------------------------------------------------ |
| Contiguous wire-byte storage             | reads are plain byte ranges → enables sendfile, no reframing |
| Group-commit coalesced fsync             | N concurrent appends ≈ 1 fsync (vs Node's per-append fsync)  |
| Per-stream single-writer, no global lock | exactly-once bookkeeping with zero cross-stream contention   |
| Lock-free positioned reads               | hot-tail reads are page-cache hits, never block the writer   |
| Event-driven long-poll/SSE (watch)       | no polling loop (Node dev server polls SSE ~100 ms)          |
| sendfile(2) in the raw engine (Linux)    | page cache → socket in-kernel: ~10× less CPU per byte served |

## Saturation notes

- **Append path:** disk-fsync-bound (one SSD's barrier-fsync capacity), not
  server-bound — Rust uses ~2.6 of 10 cores at the plateau.
- **Read path:** load-generator-bound. The Node clients saturate before the Rust
  server; the Linux CPU measurement is what exposes the real server-side gap.
  Pushing throughput further needs a compiled load generator (oha/wrk) or more
  client machines.

## Reproduce

```bash
cargo build --release --manifest-path packages/server-rust/Cargo.toml
BIN=packages/server-rust/target/release/durable-streams-server

# pick an engine with --http-engine {hyper|raw}
$BIN --port 4564 --data-dir .streams-dev/bench-rust --http-engine raw &
BENCH_URL=http://localhost:4564 BENCH_ENV=rust pnpm exec vitest bench --run \
  --config packages/server-rust/bench/vitest.bench.config.ts

PORT=4565 DATA_DIR=.streams-dev/bench-node pnpm exec tsx packages/server-rust/bench/node-server.ts &
BENCH_URL=http://localhost:4565 BENCH_ENV=node pnpm exec vitest bench --run \
  --config packages/server-rust/bench/vitest.bench.config.ts

# scale-out (append / read); use 127.0.0.1 and let TIME_WAIT drain between runs
BENCH_URL=http://127.0.0.1:4564 WORKERS=2 CONCURRENCY=75 node packages/server-rust/bench/scale-out.ts
MODE=read SEED_MB=10 BENCH_URL=http://127.0.0.1:4564 WORKERS=2 CONCURRENCY=16 node packages/server-rust/bench/scale-out.ts
```

Delete `.streams-dev/bench-*` after runs.
