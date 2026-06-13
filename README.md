# Durable Streams server (Rust)

High-performance Rust implementation of the Durable Streams protocol, following the
design in `notes/rust-server-research.md`.

## Design highlights

- **Contiguous wire-byte storage**: the per-stream data file contains exactly the bytes
  the protocol puts on the wire (JSON messages stored as `value,` runs), so every
  catch-up read is a literal byte range of the file — no reframing, no per-message
  copies. JSON responses are `[` + range-minus-trailing-comma + `]`.
- **Coalesced group-commit fsync**: appenders share one in-flight barrier fsync
  (leader/follower), preserving the durability contract (response only after the
  covering fsync) at a fraction of the fsync count. On macOS uses `F_BARRIERFSYNC`
  to match Node's libuv `fdatasync`; on Linux uses `fdatasync`.
- **Per-stream serialization, lock-free reads**: one async mutex per stream serializes
  appends and producer validation (satisfying the protocol's per-(stream, producerId)
  requirement); reads take a brief RwLock snapshot and do positioned `pread`s.
- **watch-channel wakeups** for long-poll and SSE subscribers.
- Tokio + hyper (HTTP/1.1). The Linux zero-copy roadmap (io_uring, sendfile, kTLS)
  from the research notes is not yet wired in — the storage format was designed so it
  can be added without changing the on-disk layout.

## Run

```bash
cargo run --release -- --port 4437 --data-dir ./data [--long-poll-timeout-ms 30000]
```

## Scope

Implemented: create/append/read (catch-up, long-poll, SSE), HEAD, DELETE, JSON mode,
idempotent producers, Stream-Seq, close semantics, TTL/expiry, cursors, ETags/304,
security headers, and stream forks (offset + sub-offset divergence, chained
fork-of-fork reads through the parent chain, soft-delete refcount lifecycle with
cascade GC, TTL inheritance).

Not implemented: `__ds` control plane (subscriptions/webhooks), compression,
restart recovery scan (metadata is in-memory; data files are not yet replayed on
boot).

## Conformance

```bash
# start the server, then:
RUST_SERVER_URL=http://localhost:4563 pnpm exec vitest run \
  --config packages/server-rust/conformance/vitest.config.ts
```

Status: 326 passed / 6 skipped / 0 failed (skips are subscription tests, disabled
via `subscriptions: false`).

## Benchmarks

See `bench/`:

- `node-server.ts` — launches the reference Node server (file-backed) for comparison
- `server.bench.ts` — runs `@durable-streams/benchmarks` against `BENCH_URL`
- `scale-out.ts` — multi-process raw-HTTP load generator (append + read modes)

Results on an M-series MacBook (10 cores, macOS, both servers file-backed with
per-append fsync), June 2026 — see `bench/RESULTS.md`.
