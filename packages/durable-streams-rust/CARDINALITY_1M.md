# 1M-stream cardinality fixes — findings + results (2026-07-02)

Follow-up to the write-bottleneck and WAL-contention investigations
(bottleneck #2: stream cardinality). Server commit: `662b0c845` on
`perf/combined-t1a-t1c-t2a`. **Outcome: 1M streams reaches 1,114,644 ops/s on a
16 vCPU `c4d-standard-16-lssd` (ladder unsaturated), and the 500k→1M degradation at
equal load is −17% (was a cliff).**

## Root causes (evidence-first, local Linux repro at 20k→400k streams)

The key mechanism: **at high cardinality, ops/stream/checkpoint-interval drops below
1, so every "amortized once-per-stream-per-interval" cost becomes a per-op cost.**

| #   | cost                                                                                                                                                                                                                                  | evidence                                                                                                           | fix                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Checkpoint drain did O(touched) capture (`shared.read()` + Arc clone per stream) **while holding the shard `dirty` mutex** — the same mutex every append's epoch-transition takes; at 400k streams every append is a transition       | `WAL_CKPT drain_us` 25–140 ms/tick; `dirty_wait_load` 0.01→0.30 cores as streams 20k→400k; p99 ≈ max drain         | O(1) critical section: take Vec + bump epoch under the lock, capture after release                                                                                                                                                                   |
| 2   | Checkpoint capture / cumulative tails-file re-read+re-sort+rewrite / recycle ran **on async runtime threads**, serially across shards                                                                                                 | `WAL_CKPT` capture 31 ms + tails 24 ms per tick per shard on runtime threads                                       | whole checkpoint body in one `spawn_blocking`; tails map memory-resident; shards checkpoint concurrently (`JoinSet`)                                                                                                                                 |
| 3   | **Per-append meta sidecar flush**: with inter-append gap > the 100 ms debounce (always, at high cardinality) every producer append did JSON + `File::create(.meta.tmp)` + `rename` → all workers spin on the **data-dir inode rwsem** | perf: `osq_lock`+`rwsem_spin_on_owner` under `write_meta_sync` = **38–46% of ALL server CPU at every cardinality** | WAL-staged appends only mark `meta_dirty`; checkpoint writes sidecars for drained streams after recycle (memory-mode keeps the debounced flush). Producer/access staleness bound: 100 ms debounce → checkpoint cadence (contract already allows lag) |
| 4   | Two registry lookups per append (`handle_append` metric label + `_inner`) — 2× SipHash + cold DashMap walk at 1M keys                                                                                                                 | code inspection                                                                                                    | `_inner` returns `is_json`                                                                                                                                                                                                                           |

## Local A/B (Linux harness, 6 srv cores, conn=256, shards=6)

| streams | before        | after      | p99          |
| ------- | ------------- | ---------- | ------------ |
| 20k     | ~43–46k ops/s | **80.4k**  | 41 → 7.7 ms  |
| 200k    | 32.3k         | **50.6k**  | 53 → 17.9 ms |
| 400k    | 16.0k         | **36–44k** | 144 → ~28 ms |

Correctness: 95 crate tests + 326 conformance tests pass. New telemetry: `WAL_CKPT`
per-shard checkpoint phase line (`--wal-stats`), and the repro script grew
`--tmpfs` / `--wal-stats` knobs + WAL_CKPT summarizing.

## Remote validation (GKE, 16 vCPU, pool client, 256 B, batch 1)

Suite `ds-bench/suites/run-durable-cpu16-1m-card.json`, image
`durable-streams:combined-card@sha256:d74840bd…`; full detail + caveats in
`ds-bench/results/run-durable-cpu16-1m-card/FINDINGS.md`.

| streams | pods | ops/s         | p50 / p99 / max                                              |
| ------- | ---- | ------------- | ------------------------------------------------------------ |
| 1M      | 32   | 898,582       | 3.5 / 30.5 / **149.6 ms** (baseline 862k, 3.3 / 32 / 405 ms) |
| 1M      | 64   | **1,114,644** | 3.4 / 60.3 / 211 ms — still climbing (+21%/+16 pods)         |
| 500k    | 48   | 1,110,268     | 3.1 / 42.7 / 145 ms                                          |

## Open follow-ups

1. True 16 vCPU ceiling at 1M (ladder past 64 pods) and a 32 vCPU 1M run.
2. **Per-shard producer-state journal**: sidecar writes/s ≈ ops/s at full cardinality
   (off the hot path now, but it stretches checkpoint cadence — locally ~1.6 s/shard
   meta phase at 400k — and bounds producer-state staleness). One cumulative
   per-shard file per tick, recovery overlays producers by max(epoch, seq).
3. Read+write mix at 1M streams (everything here is write-only).
4. `--wal-stats` cell on NVMe (`run-durable-cpu16-1m-card-stats.json`, never ran) to
   confirm checkpoint fsync/meta phase behavior at 1M on real disks.
