# Durable Streams server (Rust)

[Durable Streams](../../PROTOCOL.md) is an open protocol for persistent, resumable event streams over plain HTTP — the data primitive for the agent loop.

This is a Rust implementation of that protocol. It's a single self-contained binary with no database, broker, or other moving parts — just a process and a data directory. It stores each stream as the literal bytes it puts on the wire, so reads are byte ranges of a file.

## Quickstart

```bash
# build (from this directory)
cargo build --release

# run
./target/release/durable-streams-server --port 4438 --data-dir ./data
```

Create a stream, append to it, read it back:

```bash
BASE=http://localhost:4438/my-stream

curl -X PUT  "$BASE" -H 'Content-Type: application/octet-stream'        # create
curl -X POST "$BASE" -H 'Content-Type: application/octet-stream' \
     --data 'hello;'                                                    # append
curl         "$BASE"                                                    # read -> hello;
curl -I      "$BASE"                                                    # HEAD (offset, length)
```

Read live as data arrives:

```bash
curl "$BASE?offset=now&live=long-poll"   # blocks until the next append (or timeout)
curl -N "$BASE?offset=0&live=sse"        # Server-Sent Events stream
```

## Flags

| Flag                     | Default                        | Description                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--host`                 | `127.0.0.1`                    | listen address                                                                                                                                                                                                                                                                             |
| `--port`                 | `4438`                         | listen port                                                                                                                                                                                                                                                                                |
| `--data-dir`             | `$TMPDIR/durable-streams-rust` | storage directory (persists across restarts)                                                                                                                                                                                                                                               |
| `--http-engine`          | `hyper`                        | `hyper` or `raw` (custom HTTP/1.1 loop; `sendfile(2)` reads on Linux)                                                                                                                                                                                                                      |
| `--long-poll-timeout-ms` | `30000`                        | how long a long-poll request blocks before a 204                                                                                                                                                                                                                                           |
| `--read-offload`         | `tail`                         | raw engine, Linux: where reads run sendfile — `inline` (always on the async worker), `tail` (live tail inline, catch-up on the blocking pool), `always` (always on the blocking pool). `tail` keeps a cold backfill's disk fault off the async workers while serving the live tail inline. |

## What it implements

Full protocol: create / append / read (catch-up, long-poll, SSE), HEAD, DELETE, JSON mode, idempotent producers (`Producer-Id` / `Producer-Epoch` / `Stream-Seq`), close, TTL / expiry, cursors, ETags / 304, security headers, stream forks, and the `__ds` control plane (subscriptions, webhooks with Ed25519-signed delivery, pull-wake).

Durable by default: an append returns only after the fsync that covers it. State survives restarts — on boot the store rebuilds every stream from its data file plus a `.meta` sidecar and re-links fork chains. (Crash window per [PROTOCOL.md](../../PROTOCOL.md): producer dedup state may lag the data file, so producers should bump their epoch on restart.)

**Control-plane durability — known limitation.** The stream data is durable, but the `__ds` control plane is **in-memory only**: subscriptions, pull-wake leases/cursors, and the Ed25519 webhook-signing key are not persisted across restarts. After a restart, existing subscriptions are gone and a new signing key is generated — so webhook receivers that pinned the previous `kid` / JWKS must refetch it. Persisting the control plane (at minimum the signing key) is a planned follow-up; for now, treat it as ephemeral or front it with a component that re-creates subscriptions on startup.

## How it's built

- **Contiguous wire-byte storage** — each stream's data file holds exactly the bytes that go on the wire, so a catch-up read is a literal byte range. No reframing, no per-message copies.
- **Coalesced group-commit fsync** — concurrent appenders share one in-flight barrier fsync (`F_BARRIERFSYNC` on macOS, `fdatasync` on Linux), keeping the durability contract at a fraction of the syscall count.
- **Per-stream serialization, lock-free reads** — one async mutex per stream orders appends; reads take a brief snapshot and do positioned `pread`s, never blocking the writer.
- **watch-channel wakeups** drive long-poll and SSE subscribers, so there's no polling loop.
- **Two HTTP engines** — `hyper` (default) and a custom `raw` HTTP/1.1 loop that owns the socket to serve reads with `sendfile(2)` on Linux. Both pass the full suite.

## Conformance

```bash
# start the server with a short long-poll timeout to match the suite, then:
RUST_SERVER_URL=http://localhost:4562 pnpm exec vitest run \
  --config packages/server-rust/conformance/vitest.config.ts
```

Status: **332 passed / 0 failed**, on both engines.

## Releasing

Prebuilt binaries are published to GitHub Releases by the
`release-server-rust` workflow when a `server-rust-v*` tag is pushed:

```bash
# bump version in Cargo.toml, then:
git tag server-rust-v0.1.0
git push origin server-rust-v0.1.0
```

This builds `durable-streams-server` for linux and macOS (x86_64 + arm64)
and attaches the tarballs plus SHA-256 checksums to the release.

---

## Benchmarks (preliminary)

These numbers are preliminary. Measured 2026-06-13, both servers file-backed with per-append durable fsync (Node: libuv `fdatasync` = `F_BARRIERFSYNC`; Rust: `F_BARRIERFSYNC` on macOS, `fdatasync` on Linux, coalesced/group-commit). The same Node-based load clients drive every server, so cross-server numbers are comparable. Rust built `--release`. `rust-hyper` is `--http-engine hyper` (tokio + hyper); `rust-raw` is `--http-engine raw` (custom HTTP/1.1 loop, `sendfile(2)` reads on Linux; on macOS it falls back to positioned reads, so there `rust-raw ≈ rust-hyper` minus framework overhead).

### macOS (10 cores, 16 GB, Apple SSD) — official suite (`@durable-streams/benchmarks`, via the TS client)

| Metric (mean)                    | Node     | rust-hyper | rust-raw   | best vs Node |
| -------------------------------- | -------- | ---------- | ---------- | ------------ |
| Latency overhead (RTT − ping)    | 19.76 ms | 0.85 ms    | 0.82 ms    | **24×**      |
| Small messages (100 B, conc. 75) | 4,214 /s | 116,319 /s | 106,707 /s | **28×**      |
| Large messages (1 MB)            | 324 /s   | 977 /s     | 1,112 /s   | **3.4×**     |

### Linux (Docker, release) — where sendfile applies

| Workload                           | rust-hyper  | rust-raw (sendfile) |
| ---------------------------------- | ----------- | ------------------- |
| Unbatched appends (100 B)          | 25,220 /s   | 25,661 /s           |
| Catch-up reads (10 MB)             | 1,524 MB/s  | 1,556 MB/s          |
| **Server CPU at ~1,580 MB/s read** | **113.9 %** | **11.8 %**          |

The zero-copy headline: at equal read throughput, the sendfile engine uses ~**10× less server CPU** (one core's worth of work shrinks to a tenth). Read throughput is _equal_ only because the Node load-generator processes saturate first — the raw engine has an order of magnitude more headroom that a heavier client (or kTLS, or more readers) would expose.

### Running them

The official suite (`@durable-streams/benchmarks`, latency + small/large-message throughput) runs against any server over HTTP. Run it against this server on each engine, and against the reference Node server for comparison:

```bash
# build the Rust server
cargo build --release --manifest-path packages/server-rust/Cargo.toml
BIN=packages/server-rust/target/release/durable-streams-server

# Rust server — pick an engine with --http-engine {hyper|raw}
$BIN --port 4564 --data-dir .streams-dev/bench-rust --http-engine raw &
BENCH_URL=http://localhost:4564 BENCH_ENV=rust pnpm exec vitest bench --run \
  --config packages/server-rust/bench/vitest.bench.config.ts

# reference Node server, for comparison
PORT=4565 DATA_DIR=.streams-dev/bench-node pnpm exec tsx packages/server-rust/bench/node-server.ts &
BENCH_URL=http://localhost:4565 BENCH_ENV=node pnpm exec vitest bench --run \
  --config packages/server-rust/bench/vitest.bench.config.ts
```

Each run writes `benchmark-results.json` to the cwd. Delete `.streams-dev/bench-*` and stop the backgrounded servers when done.
