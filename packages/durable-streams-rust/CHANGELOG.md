# @electric-ax/durable-streams-server-rust

## 0.1.5

### Patch Changes

- 9acd04f: Memory-mode CPU fix: batch meta sidecar flushes into a periodic sweep (#4691).

  `--durability memory` appends no longer schedule a per-stream debounced sidecar flush (a timer task + full sidecar rewrite per stream per 100 ms — ~5x wal-mode CPU at high stream cardinality under low per-stream rates). Appends and TTL read touches now only mark the stream dirty in a store-level set; a single 1 s sweeper flushes all dirty sidecars in one pass, mirroring the batched checkpoint treatment wal mode got in the write-path overhaul. The sidecar's producer/access state remains a non-durable lagging flush; its lag bound moves from 100 ms to the 1 s sweep cadence. Durable flush-on-close/delete paths are unchanged, and a pending flush can no longer resurrect the sidecar of a hard-deleted stream.

- 012dc4a: Recovery hardening: durability barriers (committer fdatasync, checkpoint syncfs, segment seal) are fail-stop instead of retryable-in-place (a retried fsync can falsely succeed on Linux and ack/recycle lost bytes); failed checkpoints re-register their dirty set (previously a transient error + restart truncated acked bytes); torn sidecars are quarantined instead of deleting the stream's data file; missing stream-lane mounts refuse to boot instead of letting the WAL reset destroy the lane's records; append stage failures roll back the data write and producer state (500'd bytes no longer resurrect; retries no longer swallowed as duplicates); sealing cuts at the durable frontier; unreadable sealed chunks fail the read instead of serving a response with missing interior bytes; dir fsyncs added across the WAL metadata lifecycle.
- db4977d: Eliminate the WAL write cardinality cliff (10.4k → 383k appends/s @100k streams; 212k @1M).
  - Checkpoint durability now uses one `syncfs` barrier per stream lane on Linux (was O(touched-streams) per-file `fdatasync` — the barrier storm that collapsed throughput at high stream counts).
  - New `--wal-checkpoint-interval-ms` (per-shard time trigger, default 3000) and `--wal-checkpoint-wal-bytes` (retained-WAL size budget, 0 = off): checkpoint cadence is an explicit crash-replay budget and shards self-stagger instead of storming together.
  - New `--stream-lanes N` (default 1 = unchanged layout): hash stream data files across `streams/<0..N>/` dirs, one per device, spreading checkpoint writeback over N devices with N parallel barriers. The lane count is persisted and validated on open.
  - New `--server-stats N` telemetry (`SRV_STATS`: cpu / inflight / service / lock / durability-wait per interval) — the dependency-free bottleneck diagnostics used to find all of the above. Memory-mode plain appends no longer queue redundant sidecar flushes.
  - Removed dead/diagnostic flags: `--wal-fsync-parallel`, `--wal-meta-gate`, `--mem-meta-gate`, `--meta-sweep-disable`, `--meta-sweep-stats`, `--tier local` / `--tier-local-dir` (tier is `off|s3`). `--durability memory` combined with `--tier` is now rejected at startup. WAL records without `PAYLOAD_CHECKSUMMED` decode as torn (no released writer ever emitted them).

  Deployment guidance (device layout, CPU pinning, checkpoint budgets): `WAL_TUNING.md`.

## 0.1.4

### Patch Changes

- 640509c: Write-path performance overhaul plus three crash-recovery correctness fixes.

  Performance: removed the WAL group-commit coordination ceiling (+55–60% saturated write throughput, p99 41→12 ms), fixed the 200k–1M stream-cardinality write cliff (1M streams now sustains 1.11M ops/s on 16 vCPU), and made `--durability memory` the buffered append path (4× faster, no longer Linux-only). New flags: `--wal-stats <secs>` and `--worker-threads <n>`.

  Fixes (found by the new seeded crash/fault simulation): multi-segment WAL recovery no longer drops acked records after the first segment; a torn, never-acked tail on a quiet stream is truncated instead of becoming reader-visible; an acked DELETE is now durable before the 204.

## 0.1.3

### Patch Changes

- 3c6e2ce: Cut SSE fan-out per-subscriber memory by ~60%. Each live subscriber used to spawn a producer task and an mpsc channel and keep the whole connection state machine resident while parked. SSE is now produced inline (new pull-based `Body::Sse`) and the connection is handed to a small dedicated streaming task, so an idle subscriber's resident footprint collapses to roughly a cursor over the shared stream tail.

  Live-tail SSE subscribers are then served from a fixed pool of epoll reactor threads instead of a parked connection task per subscriber. Each subscriber becomes a compact slab entry, so per-subscriber resident memory drops from ~7 KiB to ~0.6 KiB and stops scaling with the number of active connections. Linux only; other platforms keep the existing path.

## 0.1.2

### Patch Changes

- d1db07a: Rename the package folder to `packages/durable-streams-rust`. Drop the Intel
  macOS (`macos-13`) build from the release matrix. Correct the README throughput
  figure.

## 0.1.1

### Patch Changes

- af30a62: Import the high-performance Rust Durable Streams server as
  `@electric-ax/durable-streams-server-rust`. Released via Changesets (the anchor is
  `private`, so Changesets bumps the version and CI publishes the binary packages):
  npm (main + four platform packages), the `durable-streams` crate on crates.io, and
  a multi-arch `electricax/durable-streams-server-rust` Docker image. Adds a Rust
  build/test/clippy + conformance-matrix CI workflow and a distroless Dockerfile.
