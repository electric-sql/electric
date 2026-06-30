# WAL write-saturation contention investigation

Tracking doc for the investigation into the write-throughput ceiling reported in
`ds-bench/results/run-durable-pool2/FINDINGS.md` (server plateaus at ~80% CPU and
then *declines* under more load — a ceiling set by the commit path, not compute).

## Hypothesis

Sharding, group-commit, and the network reactor are **not isolated**: they are
multiplexed over one shared work-stealing Tokio runtime, and each WAL shard is
guarded by cross-thread blocking `std::sync::Mutex`es. So a "shard" is a *lock*,
not a *core*. At saturation the cost is lock contention + committer scheduling +
a durability-wakeup thundering herd, not CPU.

Per-append contended state (all on the shard a stream hashes to):
- `shard.dirty` Mutex + HashMap insert — **every append** (`register_dirty`).
- `shard.inner` Mutex — **twice** per append (reserve + mark_written).
- `durable_tx` watch — `publish_durable` wakes **every** parked waiter on the shard.

## Phase 0 — telemetry (DONE)

Added always-on, dependency-free contention telemetry (independent of the heavy
`telemetry`/OTLP feature):

- `ShardStats` gained per-shard counters: `inner`/`dirty` lock-wait nanos +
  acquire counts, records `staged`, and durability `waiters_woken`
  (`src/wal/telemetry.rs`).
- Instrumented the hot path (`src/wal/shard.rs`): `register_dirty`,
  `reserve_and_stage` (both `inner` acquisitions), `publish_durable`.
- Runtime gate `--wal-stats <secs>`: arms the hot-path timing (one relaxed
  atomic load when off — no clock reads in a default run) and spawns a stderr
  emitter printing per-interval `WAL_CONT` lines:

  ```
  WAL_CONT staged/s=… fsync/s=… batch_avg=… inner_wait_us=… inner_wait_load=… \
           dirty_wait_us=… dirty_wait_load=… waiters_woken_avg=…
  ```

  `*_wait_load` = fraction of a core-second spent purely *waiting* on that lock
  (>1.0 ⇒ more than a whole core lost to parking on it).

## Phase 0 — local reproduction (DONE / caveated)

`scripts/contention-repro.sh` drives the server with the `ds-bench multi-stream`
pool client and prints throughput + CPU + steady-state `WAL_CONT`.

**macOS caveats (why a Linux harness is also needed):**
- `F_FULLFSYNC` is a true drive barrier (~tens of ms) and dominates the commit
  path, masking the lock. Added a **bench-only** `DS_BENCH_FAST_FSYNC` env
  (`src/store.rs`, `src/wal/segment.rs`) that uses plain `fsync` on macOS so a
  RAM-disk data dir gives cheap fsync (the Linux+NVMe regime). NOT durable; never
  set in production.
- The 10-core dev box co-locates client + server, so the *absolute* throughput
  ceiling is confounded (a flat ~1600 ops/s independent of shards/connections).
  The **contention telemetry signals are valid** on macOS (use them for relative
  before/after of a change); the **throughput-ceiling** comparison must run on
  Linux with a tmpfs data dir and CPU isolation (`contention-repro-linux.sh`).

Use a RAM disk for cheap fsync on macOS:
```
DEV=$(hdiutil attach -nomount ram://6291456 | awk '{print $1}')
diskutil erasevolume HFS+ dsram "$DEV"          # → /Volumes/dsram
TMPDIR=/Volumes/dsram scripts/contention-repro.sh --shards 1 --connections 256
```

## How to judge a candidate change

A change is good if it **lifts the Linux throughput ceiling** AND drives the
contention metric it targets toward zero:
- lock-free `register_dirty` → `dirty_wait_load` → ~0
- atomic reserve → `inner_wait_load` drops
- coalesced wakeups → `waiters_woken_avg` → ~1
- dedicated committer / io_uring → higher `fsync/s` without CPU saturation

## Candidate architectures (Phase 1, parallel worktrees)

- **T1a** lock-free `register_dirty` (atomic dirty bit + lock-free push on 0→1).
- **T1b** atomic reserve (packed `fetch_add` for lsn+write_pos; lock only on roll).
- **T1c** coalesced durability wakeups (wake only satisfied waiters, not broadcast).
- **T2a** dedicated committer thread(s) off the shared runtime / drop per-commit
  `spawn_blocking`.
- **T2b** io_uring WAL writes + fsync (Linux).
- **T3**  shared-nothing thread-per-core spike (shard→core, per-core epoll via
  `SO_REUSEPORT`, no cross-core lock; SPSC handoff for the pool client's
  all-shards-per-connection access pattern).
