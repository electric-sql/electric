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
| `--splice-appends`       | off                            | raw engine, Linux: zero-copy `splice(2)` for **binary** appends (socket → file, no userspace copy). Off by default; JSON/chunked/non-Linux fall back. A CPU lever (same append rate at ~½–⅓ the server CPU), not a throughput lever — appends are fsync-bound.                             |
| `--tier`                 | `off`                          | cold-storage tier: `off`, `local` (sealed segments to a local dir), or `s3` (S3-compatible object storage). See [Tiered storage](#tiered-storage-cold-offload). Off by default — behaviour is byte-identical to a single-file server.                                                      |

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
- **`raw`** (Linux) — the custom HTTP/1.1 loop. Serves reads with `sendfile(2)` (zero-copy page cache → socket, ~10× less CPU per byte) and wins large reads. `sendfile` is an always-permitted syscall, so this works even under restrictive container seccomp where `io_uring` is blocked — making it the practical fast engine for most Linux deployments. `--read-offload tail` (the default) keeps a cold backfill's disk fault off the async workers.
- **`uring`** (Linux, **experimental**) — `io_uring` via tokio-uring, thread-per-core. Fastest on small high-concurrency reads (batched submit/complete, no epoll round-trip, no blocking-pool handoff). **Requires the `io_uring` syscalls to be permitted** — many container seccomp profiles, gVisor, and hardened/locked-down hosts block them, and the server will fail to start there. Enable it on bare metal or tuned hosts where `io_uring` is available; otherwise prefer `raw`.

See [`bench/RESULTS.md`](bench/RESULTS.md) for the measured trade-offs (uring wins small reads; raw/sendfile wins large reads and has the tightest cold-read tail; uring uses more CPU for its throughput).

## Tiered storage (cold offload)

Opt-in (`--tier`, off by default). Because streams are append-only and immutable by position, the server can break a stream into fixed-size, CDN-friendly **segments** (`--tier-segment-bytes`, default 8 MiB): once data leaves the hot tail it is **sealed** and offloaded to object storage, and catch-up reads of cold history are served from there. Recent data stays local (the hot tier, served zero-copy as today). With `--tier off` the server is byte-identical to a single-file deployment.

- **S3-compatible, not AWS-only.** The `s3` backend works with any S3-compatible endpoint — Cloudflare R2, Fly/Tigris, MinIO, Backblaze B2 — via a configurable endpoint + path-style addressing. It's built on the `object_store` crate behind the **`tier` Cargo feature** (so a default build pulls no object-storage dependencies): `cargo build --release --features tier`. A `local` backend (sealed segments to a directory) needs no feature/deps and is handy for testing.
- **How it stays correct.** Each stream keeps a manifest of its sealed segments. The lifecycle is seal → upload → `head`-verify → durably flip the manifest entry `local → remote` → only then unlink the staged chunk file (safe even under an in-flight read — Unix keeps an open fd readable after unlink). A read resolves each requested offset against the manifest — local ranges (live file or sealed chunk file) keep the zero-copy `sendfile`/io_uring path; remote ranges are fetched by range-GET and streamed in. JSON seals always land on a value boundary (never inside a string). Durability is unchanged: an append still acks only after the local fsync — offload is strictly post-durability. Fully-sealed ranges are stamped `Cache-Control: immutable` for long-lived CDN caching, and remote objects are GC'd ref-count-aware with forks. The live data file's sealed region is not yet reclaimed — hole-punching it races with in-flight lazy reads, so safe reclaim (read/punch coordination or compaction) is a planned follow-up; until then a tiered stream keeps a redundant local copy of its sealed prefix.
- **Flags:** `--tier {off|local|s3}`, `--tier-segment-bytes`, `--tier-key-prefix`, `--tier-local-dir` (local), `--tier-endpoint` / `--tier-region` / `--tier-bucket`, `--tier-path-style` / `--tier-virtual-hosted`, `--tier-allow-http`. S3 credentials come from `DS_S3_ACCESS_KEY_ID` / `DS_S3_SECRET_ACCESS_KEY` (with `AWS_*` fallback), env only.
- **Current limitation:** large cold reads are materialized into memory (`Body::Full`) rather than streamed (`Body::Channel`) — fine for moderate segment/read sizes; streaming cold reads is a planned follow-up.

Conformance passes with tiering on as well as off (verified with a small `--tier-segment-bytes` so streams seal and offload mid-suite; catch-up reads, ETag/304, closed-stream EOF, and forks are all served correctly from cold).

## Observability (OpenTelemetry)

Opt-in via the **`telemetry` Cargo feature** (off by default — a default build pulls no OpenTelemetry dependencies and adds zero hot-path overhead): `cargo build --release --features telemetry`. Configured entirely by the standard `OTEL_*` env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_TRACES_SAMPLER`, …); spans + metrics export over OTLP/gRPC.

The instrumentation is deliberately lean and aimed at finding bottlenecks: a single `ds.request` span (bounded attributes only — never the stream path/id) plus metrics. The two most useful are **`ds.append.fsync.batch_size`** (group-commit health — how many appends fold into one fsync) and **`ds.read.offload.wait`** (blocking-pool queue wait, the cold-read pressure signal); alongside append fsync/lock-wait/total duration, read duration by mode, tail-cache hit ratio, and a request counter. All labels are bounded (engine, live, cache, outcome, …).

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

Two sources. **Cross-server vs Node** (macOS, 2026-06-16) for the headline gap,
and the **engine matrix** (native Linux, 2026-06-17) measured with the autobench
suite — server pinned to a cgroup (`AllowedCPUs` + `MemoryMax`, CPU read from
`CPUUsageNSec`), `wrk` `taskset`-pinned to disjoint cores, `performance` governor,
3 repeats per cell. Pinning client and server to separate cores is what exposes
the real engine differences; running the load generator on the server's cores
masks them. Full tables + methodology: [`bench/autobench/`](bench/autobench/).

### Cross-server vs Node — macOS, official suite (`@durable-streams/benchmarks`)

| Metric (mean)                    | Node     | rust-hyper | rust-raw   | best vs Node |
| -------------------------------- | -------- | ---------- | ---------- | ------------ |
| Latency overhead (RTT − ping)    | 23.19 ms | 1.10 ms    | 1.17 ms    | **21×**      |
| Small messages (100 B, conc. 75) | 3,796 /s | 115,798 /s | 117,083 /s | **31×**      |
| Large messages (1 MB)            | 420 /s   | 1,083 /s   | 1,244 /s   | **3.0×**     |
| Unbatched appends (100 B, c75)   | 127 /s   | 30,740 /s  | 32,261 /s  | **254×**     |
| Catch-up reads (10 MB)           | 472 MB/s | 3,252 MB/s | 3,502 MB/s | **7.4×**     |

### Engine matrix — native Linux (12-core Xeon, isolated)

**Engine vs server cores** (hot 1 KB read, client on disjoint cores). The gap is
real when the server is the bottleneck; it closes only once the 4-core load
generator saturates first:

| server cores | hyper   | raw         | uring       |
| ------------ | ------- | ----------- | ----------- |
| 2            | 118k /s | 184k /s     | **258k /s** |
| 4            | 193k /s | 290k /s     | **361k /s** |
| 8            | 258k /s | **287k /s** | 278k /s     |

**Reads by size** (8 cores, conn 256). raw/sendfile dominates large reads at half
the CPU:

| read size | hyper           | raw                  | uring           |
| --------- | --------------- | -------------------- | --------------- |
| 1 KB      | 259k /s         | **287k /s**          | 275k /s         |
| 16 KB     | 186k /s         | **196k /s**          | 186k /s         |
| 1 MB      | 7.1k /s (742 %) | **14.2k /s (379 %)** | 8.2k /s (691 %) |

**Appends** (100 B, 8 cores). raw scales cleanly; uring _regresses_ past 4 cores
(thread-per-core contention on the per-stream fsync path):

| conn | hyper   | raw         | uring   |
| ---- | ------- | ----------- | ------- |
| 64   | 97k /s  | **110k /s** | 75k /s  |
| 256  | 166k /s | **207k /s** | 102k /s |

**`--splice-appends`** (1 MB binary, raw): off 393/s @ **84 % CPU** vs on 380/s @
**40 % CPU** — same throughput (fsync-bound), ~half the CPU. A CPU lever, not a
throughput one.

**Cold tier read** (`--tier local`, 32 MB stream served from the blobstore via
`Body::Channel`): ~**5,100 MB/s**.

Takeaways: **raw is the best all-rounder at full utilization** — top or tied on
reads (and 2× on large reads via zero-copy `sendfile`, at half the CPU) and best
on appends. **uring** wins small reads decisively only when the server is
CPU-constrained (its `io_uring_enter` batches recv+send), and is the weakest on
appends. So `raw` is the default fast engine; `uring` suits CPU-bound,
small-read-heavy workloads on hosts where the `io_uring` syscalls are permitted.

### Running them

```bash
# Engine matrix (native Linux host w/ systemd + cgroups; authoritative numbers)
SR_DIR=packages/server-rust bash packages/server-rust/bench/autobench/run.sh
PROFILE=smoke SR_DIR=… bash …/autobench/run.sh   # ~5-min pipeline check

# Cross-server (Node vs hyper vs raw): official suite + scale-out
packages/server-rust/bench/run-all.sh                    # -> bench/out/

# Quick engine micro-bench anywhere via Docker (lower fidelity, no isolation)
ENGINES="hyper raw uring" packages/server-rust/bench/micro/docker-run.sh
```

Bench data dirs are gitignored; clean `.streams-dev/bench-*` and `bench/*/out`
when done.
