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

| Flag                     | Default                        | Description                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--host`                 | `127.0.0.1`                    | listen address                                                                                                                                                                                                                                                                 |
| `--port`                 | `4438`                         | listen port                                                                                                                                                                                                                                                                    |
| `--data-dir`             | `$TMPDIR/durable-streams-rust` | storage directory (persists across restarts)                                                                                                                                                                                                                                   |
| `--long-poll-timeout-ms` | `30000`                        | how long a long-poll request blocks before a 204                                                                                                                                                                                                                               |
| `--read-offload`         | `tail`                         | Linux: where reads run sendfile — `inline` (always on the async worker), `tail` (live tail inline, catch-up on the blocking pool), `always` (always on the blocking pool). `tail` keeps a cold backfill's disk fault off the async workers while serving the live tail inline. |
| `--splice-appends`       | off                            | raw engine, Linux: zero-copy `splice(2)` for **binary** appends (socket → file, no userspace copy). Off by default; JSON/chunked/non-Linux fall back. A CPU lever (same append rate at ~½–⅓ the server CPU), not a throughput lever — appends are fsync-bound.                 |
| `--tier`                 | `off`                          | cold-storage tier: `off`, `local` (sealed segments to a local dir), or `s3` (S3-compatible object storage). See [Tiered storage](#tiered-storage-cold-offload). Off by default — behaviour is byte-identical to a single-file server.                                          |
| `--durability`           | `strict`                       | append-durability mode: `strict` (per-stream `fdatasync` before ack), `wal` (sharded WAL, ack after WAL group-commit — no-loss + clean recovery), `fast` (no fsync, lossy tail). See [Durable WAL](../../docs/durable-wal.md).                                                |
| `--wal-shards`           | CPU count                      | WAL shard count (consult `--durability wal` only; fixed at data-dir creation — a mismatch on an existing dir exits with code 2).                                                                                                                                                |
| `--wal-segment-bytes`    | 128 MiB                        | per-shard WAL segment size; also sets the segment-roll threshold. Useful for forcing segment rolls in tests; in production the default is fine.                                                                                                                                  |
| `--strict-io-uring`      | off                            | Linux + `strict-uring` Cargo feature: replace `spawn_blocking` per-stream `fdatasync` with a single shared io_uring ring on a dedicated thread, batching many streams' fsyncs into one `io_uring_enter`. A CPU-per-append lever for `--durability strict`; falls back to `spawn_blocking` if io_uring is unavailable. Off by default. Build: `cargo build --release --features strict-uring`. |

## What it implements

Core protocol: create / append / read (catch-up, long-poll, SSE), HEAD, DELETE, JSON mode, idempotent producers (`Producer-Id` / `Producer-Epoch` / `Stream-Seq`), close, TTL / expiry, cursors, ETags / 304, security headers, and stream forks.

Durable by default: an append returns only after the fsync that covers it. State survives restarts — on boot the store rebuilds every stream from its data file plus a `.meta` sidecar and re-links fork chains. (Crash window per [PROTOCOL.md](../../PROTOCOL.md): producer dedup state may lag the data file, so producers should bump their epoch on restart.)

**Not implemented: subscriptions / the `__ds` control plane.** Webhook and pull-wake subscriptions (the protocol's `__ds` routes, Ed25519-signed delivery, JWKS) are not part of this server. Clients consume streams directly via long-poll / SSE; if you need push delivery, run it as a separate component on top.

## How it's built

- **Contiguous wire-byte storage** — each stream's data file holds exactly the bytes that go on the wire, so a catch-up read is a literal byte range. No reframing, no per-message copies.
- **Coalesced group-commit fsync** — concurrent appenders share one in-flight barrier fsync (`F_BARRIERFSYNC` on macOS, `fdatasync` on Linux), keeping the durability contract at a fraction of the syscall count.
- **Per-stream serialization, lock-free reads** — one async mutex per stream orders appends; reads take a brief snapshot and do positioned `pread`s, never blocking the writer.
- **watch-channel wakeups** drive long-poll and SSE subscribers, so there's no polling loop.
- **A single, hand-rolled HTTP/1.1 engine** — no framework: it owns the socket, so on Linux it serves reads with `sendfile(2)` (zero-copy page cache → socket, ~10× less CPU per byte) and binary appends with `splice(2)`; elsewhere it falls back to positioned reads.
- **Resident tail cache** — the most recent appended chunk is kept in memory, so caught-up live readers (long-poll / SSE) and immediate catch-up reads are served from one shared copy instead of a per-reader file read.

## Tiered storage (cold offload)

Opt-in (`--tier`, off by default). Because streams are append-only and immutable by position, the server can break a stream into fixed-size, CDN-friendly **segments** (`--tier-segment-bytes`, default 8 MiB): once data leaves the hot tail it is **sealed** and offloaded to object storage, and catch-up reads of cold history are served from there. Recent data stays local (the hot tier, served zero-copy as today). With `--tier off` the server is byte-identical to a single-file deployment.

- **S3-compatible, not AWS-only.** The `s3` backend works with any S3-compatible endpoint — Cloudflare R2, Fly/Tigris, MinIO, Backblaze B2 — via a configurable endpoint + path-style addressing. It's built on the `object_store` crate behind the **`tier` Cargo feature** (so a default build pulls no object-storage dependencies): `cargo build --release --features tier`. A `local` backend (sealed segments to a directory) needs no feature/deps and is handy for testing.
- **How it stays correct.** Each stream keeps a manifest of its sealed segments. The lifecycle is seal → upload → `head`-verify → durably flip the manifest entry `local → remote` → only then unlink the staged chunk file (safe even under an in-flight read — Unix keeps an open fd readable after unlink). A read resolves each requested offset against the manifest — local ranges (live file or sealed chunk file) keep the zero-copy `sendfile` path; remote ranges are fetched by range-GET and streamed in. JSON seals always land on a value boundary (never inside a string). Durability is unchanged: an append still acks only after the local fsync — offload is strictly post-durability. Fully-sealed ranges are stamped `Cache-Control: immutable` for long-lived CDN caching, and remote objects are GC'd ref-count-aware with forks. The live data file's redundant sealed prefix is reclaimed by **compaction**: once it exceeds `--tier-compact-bytes` (default 64 MiB), the live file is rewritten to hold only the hot tail, under the appender lock and crash-safe via a `pending_compaction` intent. In-flight reads drain off the old fd, so reads stay lock-free — this is why compaction is used rather than `fallocate` hole-punching, which raced those reads. Set `--tier-compact-bytes 0` to disable.
- **Flags:** `--tier {off|local|s3}`, `--tier-segment-bytes`, `--tier-compact-bytes` (live-file compaction threshold; `0` disables), `--tier-key-prefix`, `--tier-local-dir` (local), `--tier-endpoint` / `--tier-region` / `--tier-bucket`, `--tier-path-style` / `--tier-virtual-hosted`, `--tier-allow-http`. S3 credentials come from `DS_S3_ACCESS_KEY_ID` / `DS_S3_SECRET_ACCESS_KEY` (with `AWS_*` fallback), env only.
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

The core protocol suite passes; the subscription tests are out of scope (the `__ds`
control plane is not implemented — see above).

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

Measured on a dedicated 12-core Xeon (Linux 6.8): the server runs in its own
cgroup and `wrk` is `taskset`-pinned to disjoint cores (a reserved core keeps
`sshd` schedulable), CPU governor `performance`, 3 repeats per cell. See
[BENCHMARKS.md](./BENCHMARKS.md) for the full methodology, run environment, and
an engine-level comparison against [Ursula](https://github.com/tonbo-io/ursula).

**Reads** (8 cores, conn 256):

| read size | throughput | server CPU |
| --------- | ---------- | ---------- |
| 1 KB      | 236k /s    | 508 %      |
| 16 KB     | 160k /s    | 456 %      |
| 1 MB      | 11.2k /s   | 266 %      |

**Read scaling by server cores** (1 KB, conn 256): 2c → **193k /s**, 4c → **256k /s**, 8c → 236k /s (the load generator on its 3 cores saturates past 4 server cores).

**Appends** (100 B): 116k /s @ conn 64, **210k /s** @ conn 256. **`--splice-appends`** (1 MB binary): 375 → 404 /s at ~half the CPU (76 % → 43 %) — a CPU lever, not a throughput one. **Cold-tier read** (`--tier local`, via `Body::Channel`): ~5 GB/s.

Hot reads stay sub-millisecond (p50 ≤ 0.11 ms) even under a 512 MB-capped cold backfill. cv across repeats is < 1 % for most cells.
