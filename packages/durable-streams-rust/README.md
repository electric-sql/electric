# Durable Streams server (Rust)

[Durable Streams](../../PROTOCOL.md) is an open protocol for persistent, resumable event streams over plain HTTP — the data primitive for the agent loop.

This is a Rust implementation of that protocol. It's a single self-contained binary with no database, broker, or other moving parts — just a process and a data directory. It stores each stream as the literal bytes it puts on the wire, so reads are byte ranges of a file.

## Install

Three ways to get the server (Linux/macOS, x64/arm64):

```bash
# 1. cargo (builds the binary `durable-streams-server`)
cargo install durable-streams

# 2. npm (downloads a prebuilt binary for your platform)
npm install -g @electric-ax/durable-streams-server-rust

# 3. Docker (multi-arch image)
docker run -p 4437:4437 electricax/durable-streams-server-rust
```

cargo and npm both install the `durable-streams-server` command; the Docker image
runs it directly.

## Quickstart

**Build prerequisites:** a Rust toolchain — stable, **≥ 1.75** (the MSRV; edition
2021). Just `cargo`/`rustc` + a C linker; no system libraries and no default cargo
features. Builds on Linux and macOS, x64 and arm64.

```bash
# build (run from packages/durable-streams-rust)
cargo build --release        # → ./target/release/durable-streams-server
cargo test  --release        # unit + integration tests (protocol conformance: see Conformance below)

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

`durable-streams-server [flags]` — every flag is optional. The defaults give a
durable, single-node server on `127.0.0.1:4437` with its data dir under `$TMPDIR`.

**Network & storage**

| Flag                     | Default                        | Description                                                     |
| ------------------------ | ------------------------------ | --------------------------------------------------------------- |
| `--host`                 | `127.0.0.1`                    | listen address (use `0.0.0.0` to accept remote connections)     |
| `--port`                 | `4437`                         | listen port (the protocol default, PROTOCOL.md §13.1)           |
| `--data-dir`             | `$TMPDIR/durable-streams-rust` | storage directory; persists across restarts                     |
| `--long-poll-timeout-ms` | `30000`                        | how long a `live=long-poll` request blocks before returning 204 |

**Durability** — controls how appends are made durable. See [ARCHITECTURE.md › Durability modes](ARCHITECTURE.md#durability-modes).

| Flag                  | Default   | Description                                                                                                                                                                                                                                                                                                                            |
| --------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--durability`        | `wal`     | `wal` (default) — durable group-commit `fdatasync`; an append acks only after its record is in the sharded WAL. `memory` (Linux-only) — no WAL; binary appends use zero-copy `socket→file` splice, ack on the page-cache write; **NOT locally crash-durable** — durability is delegated to (future) replication. Exits 2 on non-Linux. |
| `--wal-shards`        | CPU cores | (`wal` mode) shard / group-commit-committer count; persisted on first run, a later run must match it                                                                                                                                                                                                                                   |
| `--wal-segment-bytes` | `128 MiB` | (`wal` mode) per-shard WAL segment size; lower it only to force segment rolls in tests/benches                                                                                                                                                                                                                                         |

**Read path** — performance knobs; none change protocol behaviour. Leave at defaults unless a benchmark says otherwise.

| Flag                 | Default                       | Description                                                                                                                                                                                                       |
| -------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--tail-cache-bytes` | `0` (Linux) / `65536` (macOS) | resident tail-cache cap in bytes; `0` disables it (every read resolves to the file via `sendfile`/`pread`). Off by default on Linux (`sendfile` is already fast), on by default on macOS (no `sendfile`).         |
| `--read-offload`     | `tail`                        | Linux: where `sendfile` reads run — `inline` (async worker), `tail` (live tail inline, catch-up on the blocking pool), `always` (blocking pool). `tail` keeps a cold backfill's disk fault off the async workers. |

**Cold-storage tier** — off by default; see [Tiered storage](#tiered-storage-cold-offload). With `--tier off` the server is byte-identical to a single-file deployment.

| Flag                                          | Default    | Description                                                                              |
| --------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `--tier`                                      | `off`      | `off` \| `local` (sealed segments to a local dir) \| `s3` (S3-compatible object storage) |
| `--tier-local-dir`                            | —          | (`tier=local`) directory for sealed segments                                             |
| `--tier-endpoint`                             | —          | (`tier=s3`) S3 endpoint URL                                                              |
| `--tier-region`                               | —          | (`tier=s3`) region                                                                       |
| `--tier-bucket`                               | —          | (`tier=s3`) bucket name                                                                  |
| `--tier-key-prefix`                           | —          | object-key prefix for sealed segments                                                    |
| `--tier-segment-bytes`                        | `8 MiB`    | sealed-segment size (fixed-size, CDN-friendly)                                           |
| `--tier-compact-bytes`                        | `64 MiB`   | small-segment compaction threshold                                                       |
| `--tier-path-style` / `--tier-virtual-hosted` | path-style | S3 addressing style                                                                      |
| `--tier-allow-http`                           | off        | allow plain HTTP to the S3 endpoint (e.g. a local MinIO)                                 |

S3 credentials come from the **environment**, never flags: `DS_S3_ACCESS_KEY_ID` /
`DS_S3_SECRET_ACCESS_KEY` (or the standard `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`).

### Choosing a configuration

| Your situation                                    | Use                                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Bounded local disk with long history**          | `--tier s3` (or `local`) — seal cold segments to object storage; the recent tail stays local and zero-copy. |
| **High fan-out p99 across many streams on Linux** | try `--tail-cache-bytes 65536` (off by default there because `sendfile` already covers it).                 |

### Run-configuration matrix

The server runs in several configurations — durability (`wal` vs `memory`), the
resident tail cache on/off, and read-offload. Each is **protocol-equivalent**:
CI runs the whole conformance suite once per configuration (the `rust-conformance`
matrix in `.github/workflows/ci.yml`), passing the flags through the `RUST_SERVER_ARGS`
env var that the test harness forwards to the spawned binary. These are exactly the
configurations CI guards.

| Config                    | Flags                      | Exercises                                                   | Platform |
| ------------------------- | -------------------------- | ----------------------------------------------------------- | -------- |
| `wal-default`             | _(none)_                   | WAL durability, buffered append, resident cache off (Linux) | all      |
| `wal-resident-cache`      | `--tail-cache-bytes 65536` | WAL + resident tail cache on                                | all      |
| `wal-read-offload-always` | `--read-offload always`    | reads served on the blocking pool                           | Linux    |
| `memory`                  | `--durability memory`      | no WAL; zero-copy socket→file append; page-cache ack        | Linux    |

Run one configuration's conformance suite locally:

```bash
RUST_SERVER_ARGS="--durability memory" pnpm vitest run --project server-rust
```

(The Linux-only configs need a Linux host — e.g. Docker — because `memory`
exits 2 elsewhere.)

## What it implements

Core protocol: create / append / read (catch-up, long-poll, SSE), HEAD, DELETE, JSON mode, idempotent producers (`Producer-Id` / `Producer-Epoch` / `Stream-Seq`), close, TTL / expiry, cursors, ETags / 304, security headers, and stream forks.

Durable: in `wal` mode (the default), an append returns only after its record is durable in the sharded write-ahead log (WAL). The WAL acks on a group-commit `fdatasync` and recovers cleanly on restart: every WAL record carries both a header CRC32C (torn-header detector — a partially-written header fails immediately) and a payload CRC32C verified on recovery, so no torn or zeroed record is ever replayed. State survives restarts — on boot the store rebuilds every stream from its data file plus a `.meta` sidecar, re-links fork chains, and replays the WAL to reconcile any un-checkpointed tail. (Crash window per [PROTOCOL.md](../../PROTOCOL.md): producer dedup state may lag the data file, so producers should bump their epoch on restart.)

In `memory` mode there is no WAL and no WAL replay. Recovery is a sidecar pass: each stream is rebuilt from its per-stream data file and `.meta` sidecar; durability is delegated to (future) replication.

## How it's built

- **Contiguous wire-byte storage** — each stream's data file holds exactly the bytes that go on the wire, so a catch-up read is a literal byte range. No reframing, no per-message copies.
- **Sharded WAL durability** — in `wal` mode (the default), appends are acked only after their record is durable in the sharded write-ahead log. One group-commit committer per shard batches many streams' appends into a single `fdatasync` (`F_FULLFSYNC` on macOS), minimizing fsync operations regardless of stream cardinality. Per-stream files are the read view; checkpoint periodically fsyncs them and recycles WAL segments. See [Durability](ARCHITECTURE.md#durability).
- **Per-stream serialization, lock-free reads** — one async mutex per stream orders appends; reads take a brief snapshot and do positioned `pread`s, never blocking the writer.
- **watch-channel wakeups** drive long-poll and SSE subscribers, so there's no polling loop.
- **A single, hand-rolled HTTP/1.1 engine** — no framework: it owns the socket, so on Linux it serves reads with `sendfile(2)` (zero-copy page cache → socket, ~10× less CPU per byte) and binary appends with `splice(2)`; elsewhere it falls back to positioned reads.

## Tiered storage (cold offload)

Opt-in (`--tier`, off by default). Because streams are append-only and immutable by position, the server can break a stream into fixed-size, CDN-friendly **segments** (`--tier-segment-bytes`, default 8 MiB): once data leaves the hot tail it is **sealed** and offloaded to object storage, and catch-up reads of cold history are served from there. Recent data stays local (the hot tier, served zero-copy as today). With `--tier off` the server is byte-identical to a single-file deployment.

- **S3-compatible, not AWS-only.** The `s3` backend works with any S3-compatible endpoint — Cloudflare R2, Fly/Tigris, MinIO, Backblaze B2 — via a configurable endpoint + path-style addressing. It's built on the `object_store` crate behind the **`tier` Cargo feature** (so a default build pulls no object-storage dependencies): `cargo build --release --features tier`. A `local` backend (sealed segments to a directory) needs no feature/deps and is handy for testing.
- **How it stays correct.** Each stream keeps a manifest of its sealed segments. The lifecycle is seal → upload → `head`-verify → durably flip the manifest entry `local → remote` → only then unlink the staged chunk file (safe even under an in-flight read — Unix keeps an open fd readable after unlink). A read resolves each requested offset against the manifest — local ranges (live file or sealed chunk file) keep the zero-copy `sendfile` path; remote ranges are fetched by range-GET and streamed in. JSON seals always land on a value boundary (never inside a string). Durability is unchanged: an append still acks only after the local fsync — offload is strictly post-durability. Fully-sealed ranges are stamped `Cache-Control: immutable` for long-lived CDN caching, and remote objects are GC'd ref-count-aware with forks. The live data file's redundant sealed prefix is reclaimed by **compaction**: once it exceeds `--tier-compact-bytes` (default 64 MiB), the live file is rewritten to hold only the hot tail, under the appender lock and crash-safe via a `pending_compaction` intent. In-flight reads drain off the old fd, so reads stay lock-free — this is why compaction is used rather than `fallocate` hole-punching, which raced those reads. Set `--tier-compact-bytes 0` to disable.
- **Flags:** `--tier {off|local|s3}`, `--tier-segment-bytes`, `--tier-compact-bytes` (live-file compaction threshold; `0` disables), `--tier-key-prefix`, `--tier-local-dir` (local), `--tier-endpoint` / `--tier-region` / `--tier-bucket`, `--tier-path-style` / `--tier-virtual-hosted`, `--tier-allow-http`. S3 credentials come from `DS_S3_ACCESS_KEY_ID` / `DS_S3_SECRET_ACCESS_KEY` (with `AWS_*` fallback), env only.
  Conformance passes with tiering on as well as off (verified manually with a small `--tier-segment-bytes` so streams seal and offload mid-suite; catch-up reads, ETag/304, closed-stream EOF, and forks are all served correctly from cold). Note this is a manual check, not a CI gate: the `rust-conformance` matrix in `.github/workflows/ci.yml` builds the default feature set (no `--features tier`) and never passes `--tier`, so the tier code path is not exercised in CI today.

## Observability (OpenTelemetry)

Opt-in via the **`telemetry` Cargo feature** (off by default — a default build pulls no OpenTelemetry dependencies and adds zero hot-path overhead): `cargo build --release --features telemetry`. Configured entirely by the standard `OTEL_*` env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_TRACES_SAMPLER`, …); spans + metrics export over OTLP/gRPC.

The instrumentation is deliberately lean and aimed at finding bottlenecks: a single `ds.request` span (bounded attributes only — never the stream path/id) plus metrics. The two most useful are **`ds.append.fsync.batch_size`** (group-commit health — how many appends fold into one fsync) and **`ds.read.offload.wait`** (blocking-pool queue wait, the cold-read pressure signal); alongside append fsync/lock-wait/total duration, read duration by mode, tail-cache hit ratio, and a request counter. All labels are bounded (engine, live, cache, outcome, …).

## Conformance

```bash
# start the server with a short long-poll timeout to match the suite, then:
RUST_SERVER_URL=http://localhost:4562 pnpm exec vitest run \
  --config packages/durable-streams-rust/conformance/vitest.config.ts
```

The core protocol suite passes.

## Releasing

> **npm publishing is currently disabled.** A release publishes the crate
> (crates.io) and the Docker image, but **not** the npm packages — the `npm-publish`
> job in `server_rust_publish.yml` is gated off (search `DISABLED:`). Re-enable it
> when ready to ship the npm packages. (The merge-time canary Docker build is also
> off; the release image still publishes.)

Released via Changesets, like the rest of the monorepo. The version lives in this
package's `package.json` (the `@electric-ax/durable-streams-server-rust` anchor,
`private: true` — Changesets bumps it but does not publish it; CI publishes the
real binary packages). To cut a release: add a changeset for this package and
merge the "Version Packages" PR. On the version bump, `changesets_release.yml`
fans out to publish all three channels at that version:

- **crates.io** — the `durable-streams` crate (`cargo install durable-streams`),
  via `server_rust_publish.yml`. `Cargo.toml`'s version is synced from
  `package.json` at publish time (`scripts/sync-cargo-version.mjs`).
- **npm** — `@electric-ax/durable-streams-server-rust` plus its four platform
  packages (built per target, assembled by `npm/assemble.mjs`).
- **Docker Hub** — `electricax/durable-streams-server-rust` (multi-arch), via
  `server_rust_dockerhub_image.yml`.

Both registries authenticate via OIDC trusted publishing, so CI stores no registry
tokens. The `durable-streams` crate is reserved and its crates.io Trusted Publishing
is configured. The npm trusted publishers still need configuring before npm
publishing is re-enabled.

---

## Benchmarks

Numbers from **[ds-bench](https://github.com/electric-sql/ds-bench)**, a reproducible single-node harness. All figures below are the default **`wal` mode** (group-commit fsync, resident tail cache off). One server node (`c4d-standard-16-lssd`) pinned to **4 CPUs**, a Kubernetes client fleet driving 256-byte binary appends. Throughput is the saturation ceiling; latency is fleet-wide p50 / p99; memory is the pod cgroup working set (anon + active page cache), peak / p50.

**Writes** — peaks at **860,000 append/s** at 4 CPUs, scales cleanly to **100k streams**, with median append latency staying sub-ms → ~1.5 ms. Memory tracks **stream count, not bytes** (each stream is a lean record plus its open file; data lives on disk / in the page cache, never resident), so it stays in tens–hundreds of MiB even at 100k streams, with p50 ≪ peak.
