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
| `--http-engine`          | `hyper`                        | `hyper`, `raw` (custom HTTP/1.1 loop; `sendfile(2)` reads on Linux), or `uring` (io_uring, thread-per-core; Linux only)                                                                                                                                                                    |
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
- **Three HTTP engines** — `hyper` (default, portable), a custom `raw` HTTP/1.1 loop that owns the socket to serve reads with `sendfile(2)` on Linux, and `uring` (Linux): a thread-per-core current-thread runtime backed by **io_uring** (via tokio-uring) for socket and file I/O — batched submit/complete with no epoll round-trip and no blocking-pool handoff for cold reads. All three pass the full suite; the request handlers are shared, only the I/O loop differs.
- **Resident tail cache** — the most recent appended chunk is kept in memory, so caught-up live readers (long-poll / SSE) and immediate catch-up reads are served from one shared copy instead of a per-subscriber file read.

## Choosing an engine

All three speak the same protocol and pass the full suite; they differ only in how they move bytes. Pick with `--http-engine`:

- **`hyper`** (default) — portable, runs anywhere (any OS, any kernel). Start here unless you have a reason not to.
- **`raw`** (Linux) — the custom HTTP/1.1 loop. Serves reads with `sendfile(2)` (zero-copy page cache → socket, ~10× less CPU per byte) and wins large reads. `sendfile` is an always-permitted syscall, so this works even under restrictive container seccomp where io_uring is blocked — making it the practical fast engine for most Linux deployments. `--read-offload tail` (the default) keeps a cold backfill's disk fault off the async workers.
- **`uring`** (Linux, **experimental**) — io*uring via tokio-uring, thread-per-core. Fastest on small high-concurrency reads (batched submit/complete, no epoll round-trip, no blocking-pool handoff). \*\*Requires the `io_uring*\*`syscalls to be permitted** — many container seccomp profiles, gVisor, and hardened/locked-down hosts block them, and the server will fail to start there. Enable it on bare metal or tuned hosts where io_uring is available; otherwise prefer`raw`.

See [`bench/RESULTS.md`](bench/RESULTS.md) for the measured trade-offs (uring wins small reads; raw/sendfile wins large reads and has the tightest cold-read tail; uring uses more CPU for its throughput).

## Conformance

```bash
# start the server with a short long-poll timeout to match the suite, then:
RUST_SERVER_URL=http://localhost:4562 pnpm exec vitest run \
  --config packages/server-rust/conformance/vitest.config.ts
```

Status: **332 passed / 0 failed**, on all three engines (`hyper`, `raw`, `uring`).

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

## Benchmarks

Measured 2026-06-16, file-backed with per-append durable fsync. Rust built
`--release`. Full tables, setup, and analysis: [`bench/RESULTS.md`](bench/RESULTS.md).

### Cross-server — macOS, official suite (`@durable-streams/benchmarks`, via the TS client)

| Metric (mean)                    | Node     | rust-hyper | rust-raw   | best vs Node |
| -------------------------------- | -------- | ---------- | ---------- | ------------ |
| Latency overhead (RTT − ping)    | 23.19 ms | 1.10 ms    | 1.17 ms    | **21×**      |
| Small messages (100 B, conc. 75) | 3,796 /s | 115,798 /s | 117,083 /s | **31×**      |
| Large messages (1 MB)            | 420 /s   | 1,083 /s   | 1,244 /s   | **3.0×**     |
| Unbatched appends (100 B, c75)   | 127 /s   | 30,740 /s  | 32,261 /s  | **254×**     |
| Catch-up reads (10 MB)           | 472 MB/s | 3,252 MB/s | 3,502 MB/s | **7.4×**     |

On macOS `raw ≈ hyper` (no sendfile there). The engine differences show up on Linux:

### Engine micro-benchmarks — Linux (Docker, `wrk -t4 -c64`)

Hot reads (cached catch-up GETs):

| Read size | hyper   | raw                   | uring       |
| --------- | ------- | --------------------- | ----------- |
| 1 KB      | 212k /s | 355k /s               | **419k /s** |
| 16 KB     | 229k /s | 296k /s               | **365k /s** |
| 1 MB      | 12k /s  | **35k /s** (sendfile) | 23k /s      |

Cold isolation — hot 4 KB reads under concurrent cold 1 GB backfills (`fadvise(DONTNEED)`):

| engine / mode | hot p50   | hot max      |
| ------------- | --------- | ------------ |
| raw `inline`  | 96 µs     | **714.9 ms** |
| raw `tail`    | 103 µs    | **10.7 ms**  |
| uring         | **78 µs** | 80.8 ms      |

Takeaways: **uring** wins small high-concurrency reads (io_uring batches recv/send
— ~20% more throughput at lower latency); **raw/sendfile** wins large resident
reads (zero-copy beats copy-streaming); for cold-read isolation **raw `tail`** has
the tightest tail (the blocking-pool offload caps `inline`'s 715 ms worst case at
11 ms) while **uring** has the best median and avoids the collapse natively with no
offload knob (async io_uring file reads, no worker stall, bounded memory). The
resident tail cache makes raw's offload modes identical for hot reads, so
`--read-offload` now only affects cold reads (`tail` stays the raw default).

### Running them

```bash
# Cross-server (Node vs hyper vs raw): official suite + scale-out
packages/server-rust/bench/run-all.sh                    # -> bench/out/

# Engine micro-benchmarks (Linux/Docker): hyper vs raw vs uring
ENGINES="hyper raw uring" packages/server-rust/bench/micro/docker-run.sh
```

Bench data dirs are gitignored; clean `.streams-dev/bench-*` and `bench/*/out`
when done.
