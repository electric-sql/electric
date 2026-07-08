# Write bottlenecks at 1M streams — findings brief

**Audience:** an engineer/agent picking up WAL write-path performance work with no prior
context. **Scope:** single-node write throughput + tail latency of the Rust
`durable-streams` server (`packages/durable-streams-rust`) at high stream cardinality
(200k–1M streams). **Date:** 2026-07-02. **Server under test:** `perf/combined-t1a-t1c-t2a`
(PR: electric-sql/electric#4675), vs the 2026-06-30 baseline `durable-streams:dev`.

---

## TL;DR

1. **The write ceiling is coordination, not compute or fsync.** Under write saturation the
   server plateaus at **~80% CPU** and then *declines* under more load. The cost is the
   **group-commit committer scheduling + a durability-wakeup thundering herd**, not lock
   contention (at shards ≈ cores) and not fsync.
2. **Fixed the coordination** (`combined` stack): dedicated committer thread (T2a),
   coalesced wakeups (T1c), lock-free dirty registration (T1a). Measured **−21× wakeups
   per commit**, **~10× more committer activity**, **+60% throughput @ 32 vCPU**, and at
   16 vCPU / 1M streams **p99 80 ms → 32 ms**.
3. **Stream cardinality (200k→1M) adds a second, independent cost** that is *not*
   coordination: per-op memory/working-set physics (registry + per-stream state + page
   cache + checkpoint fsync fan-out + ~1 fd/stream). This is present in every build and is
   the next frontier.
4. **All results are write-only.** The read path (tail-cache, sendfile/splice, live
   tailing) is unmeasured. A read+write mix is the recommended next experiment.

---

## Test setup (how to reproduce)

- **Bench harness:** `ds-bench` (sibling repo). Remote target = GKE; `scripts/bench
  suites/<suite>.json run`. Golden rule: **always tear clusters down** (`bench` self-tears
  on clean completion; arm `scripts/teardown-watchdog.sh`).
- **Server node:** `c4d-standard-16-lssd`, pinned to N vCPU via `SERVER_CPUS=N` (sets
  cgroup `cpu.max`; the server reads it through `available_parallelism()`).
- **Server flags:** `--wal-shards N --worker-threads N` (shards = workers = cores).
- **Client:** pool model, `n2d-standard-32` fleet, `CONNS_PER_POD=256`, batch 1, 256 B
  payload. **Load knob = total connections = pods × 256.** This is a *fixed-concurrency*
  workload, so `throughput ≈ connections ÷ latency` (Little's law) — remember this when
  reading the numbers.
- **Telemetry:** `--wal-stats <secs>` makes the server emit a `WAL_CONT` line per interval:
  `staged/s`, `fsync/s`, `batch_avg`, `inner_wait_load`, `dirty_wait_load`,
  `waiters_woken_avg`. `*_wait_load` = fraction of a core-second spent *parking* on that
  lock. Off by default (one relaxed atomic load); do **not** enable it during a latency run
  (the hot-path clock reads perturb the tail).

---

## Bottleneck #1 — the coordination ceiling (FIXED by `combined`)

### Mechanism (per append, in `src/wal/`)

Every append touches per-shard shared state on the shard its `stream_id` hashes to:

- `shard.inner` `Mutex` — twice per append (reserve LSN/write-pos, then mark-written).
- `shard.dirty` `Mutex<HashMap>` — a HashMap **insert on every append** (`register_dirty`).
- `durable_tx` `watch` — on each commit, `publish_durable` wakes **every** waiter parked on
  the shard (durability barrier), not just the ones whose LSN is now durable.

Plus the committer itself hopped through the shared Tokio runtime via `spawn_blocking`
per commit — a scheduling round-trip that capped commit *cadence*.

### Direct evidence (4 vCPU / 4 shards, `--wal-stats`, instrumented baseline vs combined)

| counter | baseline | combined | note |
|---|---|---|---|
| `waiters_woken` / commit | 340–378 | **16–18** | **~21× fewer** — the herd (T1c) |
| `fsync/s` (commit cadence) | 83–192 | **1021–1178** | **~10× more** — committer freed (T2a) |
| `batch_avg` | 168–189 | 16–18 | baseline commits rarely in huge batches |
| `inner_wait_load` | ~0.000 | ~0.002 | **locks are NOT the gate here** |
| `dirty_wait_load` | ≤0.018 | ~0.000 | ditto |

**Key insight:** at shards ≈ cores there is ≈1 worker per shard, so the per-shard *locks
barely contend* (`*_wait_load ≈ 0`). The ceiling is the **committer round-trip + wakeup
broadcast**. That is what `combined` removes:

- **T2a** — dedicated committer OS thread, drop per-commit `spawn_blocking`. *Biggest single
  win.* Direct proof: `fsync/s` ~doubles/10×'s — the committer was blocked on runtime
  round-trips, not fsync.
- **T1c** — coalesced wakeups (wake only satisfied waiters). Kills the O(waiters) run-queue
  storm. At 32 cores the un-coalesced herd is ~415 waiters/commit (≈13.3k in-flight ÷ 32
  shards); T2a's faster committer makes the un-coalesced herd *worse*, so T1c is needed
  precisely because T2a helps.
- **T1a** — epoch-gated lock-free `register_dirty` (no per-append `Mutex<HashMap>` insert).

### Throughput/latency impact

Pool saturation ladder vs 2026-06-30 baseline:

| scale | baseline | combined |
|---|---|---|
| 32 vCPU, 200k | 1.48M @ 52 pods, p99 41 ms | **2.37M @ 40 pods (+60%), p99 12 ms** |
| 32 vCPU, 500k | 1.15M @ 52 pods | **≥1.78M (+55%, unsaturated)** |

Lock-free/committer changes scale with core count: **+11% @ 6 cores → +60% @ 32 cores**,
because the herd and lock pressure only dominate at high core counts.

---

## Bottleneck #2 — stream cardinality (200k → 1M) — NOT yet solved

This is a **separate axis** from coordination and is present in *every* build. At the same
offered load, more distinct streams cost more per op:

- **Registry lookups.** `Store.streams: DashMap<String, Arc<StreamState>>` (`store.rs:365`),
  hot-path `get(path)` per append (`store.rs:~654`). At 1M entries the map + values exceed
  L2/L3 → more cache/TLB misses per append.
- **Per-stream working set.** Each stream is a `StreamState` (`store.rs:164`): an
  `AsyncMutex<Appender>`, a `RwLock<Shared>`, a `watch::Sender<Tail>`, a `last_chunk`
  cache, and an `Arc<File>`. 1M of these is a large resident set (measured server RSS ~1.16
  GB at 1M — modest, but the *cache-miss* cost is the real tax, not RSS).
- **Page-cache locality.** One data file per stream ⇒ 1M distinct hot tails ⇒ worse
  locality, more page-cache churn.
- **Checkpoint fsync fan-out.** The per-shard checkpoint `fdatasync`s *every touched stream
  file* before recycling the WAL ⇒ fsync count scales with distinct streams touched per
  interval.
- **File descriptors.** ~1 open fd per stream. The server raises `RLIMIT_NOFILE` to the
  hard limit on startup (`main.rs:89` `raise_nofile_limit`). On GKE that hard limit is
  typically **1,048,576**, so **1M streams sits ~38k below the fd ceiling** once you add
  ~8k client sockets + WAL segment/epoll fds. **This is a hard wall just above 1M** — going
  materially past 1M streams per node needs a raised limit or fewer fds/stream (e.g.
  open-on-demand instead of a persistent `Arc<File>` per stream).

**Caveat on how cardinality shows up in the metrics:** the WAL contention counters do *not*
attribute the 200k→1M degradation to a lock/wakeup source (they stay flat/low). So this
cost is the memory/IO physics above, not coordination — a different class of fix
(sharded registry, open-on-demand fds, working-set reduction, checkpoint batching).

---

## 1M-stream write scaling (combined, fixed load = 32 pods = 8,192 connections)

Single fixed rung, 60 s measure, no ladder:

| server | throughput | p50 | p90 | p99 | p99.9 | max | server CPU |
|---|---|---|---|---|---|---|---|
| **8 vCPU** | 454k ops/s | 2.9 ms | 68 ms | **80 ms** | 94 ms | 3348 ms | **86% of 8** |
| **16 vCPU** | **862k ops/s** | 3.3 ms | 25 ms | **32 ms** | 88 ms | **405 ms** | **77% of 16** |

Reading it:
- **8 vCPU was capacity-bound at this load.** Doubling cores nearly **doubled throughput
  (454k→862k)** at the *same* 8,192 connections — the signature of fixed-concurrency: the
  server clears each write faster, so every connection completes more ops/s. (Little's law
  checks both ways: ≈8,190 in-flight.)
- **The tail was the story, and it collapsed.** p99 80→32 ms, and the multi-second
  outliers vanished (max 3348→405 ms). At 8 vCPU an 86%-CPU redline meant a real slice of
  writes queued behind group-commit; 16 vCPU (77%) has slack, so far fewer wait.
- **Median was never the problem** (2.9→3.3 ms). The win is entirely tail + headroom.

**Implication:** at 1M streams, ~8,000 concurrent writers want **~12–16 vCPU** to keep p99
in the tens-of-ms range with headroom. 8 vCPU is under-provisioned for that concurrency.

---

## What's fixed vs open

**Fixed (in `combined`, PR #4675):** the coordination ceiling — dedicated committer (T2a),
coalesced wakeups (T1c), lock-free dirty (T1a), plus `--wal-stats` telemetry and
`--worker-threads`.

**Deferred, with reasons:**
- **T1b (atomic WAL reserve):** `inner_wait_load ≈ 0` at 4–16 vCPU (shards ≈ cores) ⇒
  lock-restructuring risk for ~no gain at our operating points. Revisit only at
  high-core/low-shard configs where the inner lock genuinely contends.
- **T3 (shared-nothing / thread-per-core):** design-only; confirmed to pay off only at
  ≥16–32 cores and not needed to capture the current win. The pool client touching all
  shards per connection forces a cross-core SPSC handoff that is otherwise net-negative.

**Open (recommended next work, in priority order):**
1. **Read + write mixed workload.** Everything above is write-only. Reads exercise
   tail-cache, sendfile/splice, the `RwLock<Shared>` read path, and live tailing — none
   stressed here. Combined only touches the WAL commit/wakeup path, so read-regression risk
   is low and T1c may *help* live tailers (durability wakeups also wake subscribers) — but
   verify before calling the write win "done."
2. **Cardinality cost reduction (bottleneck #2).** Sharded/segmented registry, checkpoint
   `fdatasync` batching, and reducing per-stream fixed cost (esp. fds — open-on-demand vs
   persistent `Arc<File>`) to get past the ~1M fd wall.
3. **Find 16 vCPU's own redline.** These 1M numbers are one fixed rung (77% CPU). A heavier
   rung (e.g. 64 pods) pins where 16 vCPU saturates and its p99 there.

---

## Provenance

- Full investigation + telemetry design: `CONTENTION_INVESTIGATION.md` (same directory).
- Baseline that motivated this: `ds-bench/results/run-durable-pool2/FINDINGS.md`.
- 4-vCPU counter A/B: `ds-bench/suites/run-durable-cpu4-stats-{base,combined}.json`.
- 1M p99 runs: `ds-bench/suites/run-durable-cpu{8,16}-1m-p99-combined.json`.
- Code anchors: `src/wal/shard.rs` (register_dirty / reserve_and_stage / publish_durable),
  `src/wal/telemetry.rs` (WAL_CONT), `src/store.rs:164,365` (StreamState / registry),
  `src/main.rs:89` (raise_nofile_limit).
