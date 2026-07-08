# The cardinality cliff — fix & measurements

**Audience:** whoever picks up the write-cardinality-cliff work. **Date:**
2026-07-08. **Status:** memory-mode fix implemented, validated, and low-risk;
wal-mode gate implemented, crash-sim-correct, but a modest local win. **Companion
docs:** [`CARDINALITY_CLIFF_CAUSES.md`](CARDINALITY_CLIFF_CAUSES.md) (the ranked
hypotheses this acts on — the fix targets **#1**),
[`WRITE_BOTTLENECKS_1M.md`](WRITE_BOTTLENECKS_1M.md).

## What was done

Hypothesis **#1** (per-stream `.meta` sidecar flush work stops amortizing) was
confirmed and fixed. The core change is one predicate in the append path
(`handlers.rs`):

```rust
// A plain append to a non-TTL stream changes only durable_tail/last_access.
// The durable tail is carried elsewhere (memory: re-derived from the data-file
// length on restart; wal: the checkpoint's per-shard `tails` map), and
// last_access only gates TTL — so a plain non-TTL append needs NO sidecar flush.
let meta_persist_needed =
    producer.is_some() || seq_header.is_some() || st.config.ttl_seconds.is_some();
```

- **Memory mode:** only `store.mark_meta_dirty(&st)` when `meta_persist_needed`.
  Previously *every* memory-mode append queued a sidecar rewrite for the 1 s
  sweeper; at high cardinality the dedup stopped working and the sweep wrote up to
  ~N sidecars/s on one blocking thread, all contending the shared `streams/`
  directory inode.
- **Wal mode:** only `st.meta_dirty.store(true)` when `meta_persist_needed` (or the
  `--wal-meta-gate off` A/B toggle is set). The `~3 s` checkpoint then skips
  `write_meta_sync` for plain-append streams. Their `durable_tail` is still fsync'd
  and recorded in the per-shard `tails` map (`persist_durable_tails`, independent of
  this flag) — the authoritative durable-tail proof recovery reconciles against.

### Why it is safe

- **Memory recovery reads neither field.** `boot_meta_durable_tail` /
  `meta.durable_tail` is consumed only by `wal/recovery.rs`; memory-mode
  `Store::new_with_tier` derives the tail from `file.metadata().len()`. The
  pre-existing e2e test `memory_mode_data_survives_restart_via_sidecar` appends 10
  bytes, never flushes the sidecar, reopens, and recovers `tail == 10` — it already
  proved this.
- **Wal recovery uses the `tails` map, not the sidecar `durable_tail`.** The map is
  persisted every checkpoint regardless of the meta-dirty flag; the sidecar's
  `durable_tail` is redundant with it. The randomized crash-recovery simulation
  (`crash_recovery_randomized_simulation`, which uses **plain** acked appends) and
  `e2e_recycled_first_segment_acked_records_survive_crash` pass unchanged.
- **Compaction / seal / tier / close / delete are unaffected** — they call
  `write_meta_sync(.., durable=true)` directly, never via the deferred `meta_dirty`
  flag. `last_access` for TTL streams still flushes (the predicate keeps them).

New test `memory_plain_append_skips_sidecar_flush` locks in the behavior. Full
suite: **104 passed** (0 failed).

## Measurements (local kind, 2 vCPU, plain 256 B appends, `ds-bench`)

Normalized to each config's own 1k-stream throughput (the cliff is the *decline*).

### Memory mode — cliff essentially eliminated

| streams | baseline | **fixed** | throughput Δ | knee p50 |
|---|---|---|---|---|
| 1k | 123.5k (100%) | 120.8k (100%) | — | 0.5 → 0.4 ms |
| 10k | 86.9k (70%) | 127.6k (106%) | **+47%** | 0.5 → 0.5 ms |
| 50k | 54.6k (44%) | 111.6k (**92%**) | **+104%** | 2.1 → 2.2 ms |

At 50k streams throughput more than **doubles** (54.6k → 111.6k) and the cliff
flattens from 44% to 92% of the 1k rate. The fixed default build lands on the
`--meta-sweep-disable` neuter ceiling (102k), confirming the fix captures the full
available win. The residual 8% decline is #3 working-set physics (registry / cache
/ page-cache), which this fix does not address.

### Wal mode — correct, reduces checkpoint work, modest throughput win

Same-binary A/B (`--wal-meta-gate on|off`, `repeats: 2`, so no cross-image drift):

| streams | baseline | **gated** | throughput Δ | knee p50 |
|---|---|---|---|---|
| 1k | 54.6k | 66.9k | +23% | 1.7 → 2.4 ms |
| 10k | 57.1k | 54.7k | −4% (noise) | 2.5 → 2.8 ms |
| 50k | 34.1k | 38.0k | **+11%** | 4.0 → **2.5 ms** |

The wal cliff is fsync-lane bound: the checkpoint's meta write is one of *three*
costs, and the per-stream `fdatasync`s + the O(cumulative) `tails`-map rewrite (#2)
dominate — this gate doesn't touch them. The clean signal is **knee p50 at 50k
dropping 4.0 → 2.5 ms** (the checkpoint does less work); throughput barely moves
because it is disk-bound. The gate is worth keeping — it's free, correct, cuts
write amplification, and may matter more on real NVMe — but **it is not the wal
cliff fix**. The real wal lever is **#2: incremental/delta `tails` persistence**
instead of the full-map rewrite per checkpoint.

## Dev/bench toggles added (all default-off / gate default-on)

- `--meta-sweep-stats` — log a `META_SWEEP queued=/wrote=/elapsed_us=` line per tick.
- `--meta-sweep-disable` — drain the sweep queue but skip the sidecar write (the #1
  confirmation neuter; makes the sidecar permanently stale — bench only).
- `--wal-meta-gate on|off` — toggle the wal-mode gate for a same-binary A/B.
- `--mem-meta-gate on|off` — memory counterpart, to A/B the #1 fix on one binary.
- `--wal-fsync-parallel N` — checkpoint fdatasync fan-out (H4; default 1 = serial).
- `--server-stats N` — periodic `SRV_STATS` line (both modes) for bottleneck
  analysis: `cpu_cores` (process CPU utilization; ≈ cgroup quota ⇒ CPU-bound),
  `inflight` (append queue depth), `svc_us` (handler service time), `applock_us`
  (appender-lock wait), `durwait_us` (WAL fsync wait). Linux only for `cpu_cores`.

Reproduce: `ds-bench` suites `write-cliff-confirm` (memory neuter A/B),
`write-cliff-validate` (fixed default vs wal baseline), `write-cliff-wal-ab`
(same-binary wal gate A/B).

## Bottleneck analysis — is it CPU-bound or fsync-bound? (measured)

Added `--server-stats` and profiled both modes in a Linux Docker container (4 CPU,
50k streams, 512 connections, container-to-container networking to avoid the
Docker Desktop port-forward proxy) — plus a real-NVMe cross-check on
`c4d-standard-16-lssd`.

**Memory mode = CPU-bound.** `SRV_STATS cpu_cores≈3.0–3.5` (of 4), `inflight≈0`,
`svc_us≈8–15`, `durwait=0`, `applock=0`. The server saturates cores with no
queueing; throughput scales with cores (documented 315k@4→526k@8 vCPU). The #1
sidecar fix helps here precisely because it removes per-append CPU work — measured
**+16% @ 100k, +14% @ 500k on real NVMe** (memory-nogate vs memory-gated:
318k→370k, 237k→270k).

**WAL mode = fsync/durability-bound, NOT CPU-bound.** `SRV_STATS cpu_cores≈0.9–1.5`
(of 4 — 3 cores idle!), `inflight≈260–500` (deep queue), `svc_us≈8–13ms` of which
`durwait_us` is **~99%**. Hundreds of appends pile up in `wait_durable_lsn` while
the CPU sits idle — the WAL group-commit fsync is the wall. Real-NVMe baseline:
66k @ 100k, 48k @ 500k (4 vCPU / 4 shards).

**Implications for "should we allocate more CPU?"**
- **Memory: yes** — it is CPU-bound and scales with cores.
- **WAL: no** — it is fsync-bound with 3 of 4 cores idle. More vCPU is wasted spend.
  The wal lever is fsync throughput = **parallel fsync lanes = more `--wal-shards`**
  (each shard commits/fsyncs independently), NOT CPU and NOT `--wal-fsync-parallel`
  (which fans the CHECKPOINT fsync — regressed −11% on NVMe: fsync16 59k vs fsync1
  66k @ 100k, same CPU-oversubscription failure as local).

Caveat on local harness: Docker Desktop virtiofs serializes fsync (so wal
shard-scaling is invisible locally) and a single client container caps memory at
~150k (so memory CPU-scaling is invisible locally). The STRUCTURE (which resource
saturates) is valid locally; the SCALING numbers require real NVMe + a client fleet.

## H2 / H4 investigation — wal checkpoint breakdown (measured, mostly negative)

Followed up on the two wal-checkpoint hypotheses by capturing the `WAL_CKPT`
phase breakdown under 50k-stream load (`--wal-stats`). **Iterate on a Linux
container, not bare macOS:** macOS `fsync` is `F_FULLFSYNC` (a true drive barrier,
~7 ms, globally serialized), so bare-metal wal throughput is a ~30× artifact.
`DS_BENCH_FAST_FSYNC=1` swaps in plain `fsync` for a faster loop, but the
representative signal comes from running the server in Docker (Linux `fdatasync`).
Local loop: `target/release/durable-streams-server … --wal-stats 1` driven by
`ds-bench multi-stream --api-style durable --streams 50000`.

Checkpoint phase split at 50k streams (per checkpoint, Linux container):

```
touched=21274  fsync_us≈2,000,000 (≈99%)  tails_us≈10,000 (0.5%)  meta_us≈300 (~0%)
```

- **H2 (incremental `tails` persistence): NOT WORTH DOING.** The cumulative
  `tails`-map rewrite is **~0.5%** of checkpoint time even as it grows — optimizing
  it is optimizing noise. (`meta_us≈0` also confirms the #1 wal gate zeroed the
  sidecar phase: `meta=0` on every line.)
- **H4 (checkpoint `fdatasync`): dominant *within* the checkpoint, but NOT the wal
  throughput ceiling on Linux.** The commit path batches healthily
  (`WAL_CONT batch_avg≈12`, staged/s 8–18k) and the checkpoint runs on separate
  threads, so `fdatasync` overlaps commits instead of blocking them. The real
  ceiling is the **commit-path group-commit fsync rate** (~1000 fsync/s × batch
  ≈ throughput), not the checkpoint. (Bare macOS mis-attributed this to the
  checkpoint because `F_FULLFSYNC` serializes *all* fsyncs globally.)
- **Parallelizing the checkpoint `fdatasync` REGRESSES on constrained hardware.**
  Added `--wal-fsync-parallel N` (fan the per-stream syncs across N OS threads; all
  complete before recycle, crash-ordering preserved, crash-sim green). Measured on
  a 2-vCPU Linux container, 50k streams:

  | fanout | ops/s | vs serial |
  |---|---|---|
  | 1 (serial) | 16.4k | — |
  | 2 | 15.8k | −4% |
  | 4 | 13.8k | −16% |
  | 16 | 10.9k | −19% |

  More fan-out steals CPU from the runtime (slowing the committer until checkpoints
  fall behind) and virtiofs doesn't do concurrent fsync. **Default is therefore
  serial (`fanout=1`, a no-op);** the parallel path is opt-in, pending validation on
  real NVMe (deep device queue + spare cores) where it may pay off. On current
  evidence, do not enable it.

**Net:** neither H2 nor H4 is a wal throughput win on Linux. The next wal lever is
the **commit-path group commit** (raise batch / fsync efficiency), not the
checkpoint — a separate investigation.

## NVMe shard + fanout sweep — optimal wal config (measured, definitive)

Controlled sweeps on real Titanium NVMe (`c4d-standard-16-lssd`, **8 vCPU pin**,
200k streams, 256 conns/pod, 256 B; ds-bench `wal-shard-sweep` + `wal-fanout-sweep`).
Both suites are barrier-aligned, per-cell resumable, and ran to completion.

**`--wal-shards` sweep — flat within 5 %:**

| shards | 1 | 4 | 8 | 16 | 24 |
|---|---|---|---|---|---|
| peak ops/s | 72k | **75k** | 73k | 73k | 71k |

**`--wal-fsync-parallel` sweep (at s4) — flat then regresses:**

| fanout | 1 | 2 | 4 | 8 |
|---|---|---|---|---|
| peak ops/s | 75k | 73k | 75k | **67k** |

Live telemetry at *every* shard count: SRV_STATS `cpu_cores≈1.1–1.8/8` (idle),
`durwait_us ≈ 97–99 % of svc_us`; WAL_CONT `fsync/s≈900–1000`, `batch_avg` 53→88;
WAL_CKPT `touched≈580`, `fsync_us≈1.4 s` (the per-stream fdatasync storm).

**Conclusions:**
- **Neither shards nor fsync-parallel is a throughput lever.** wal is bounded by the
  disk's `fdatasync`/s rate (~1000), a single shared resource — not per-shard lanes.
  This **overturns the old "shards is the knob / s16 ≈ 380k"** number (does not
  reproduce). More shards *hurt* at low load (s24 @1 pod = 34k vs s4 = 49k: thinner
  per-shard group-commit batches). `--wal-fsync-parallel ≥ 8` regresses (it just adds
  concurrent checkpoint fsyncs that steal device budget from commits).
- **Answers the earlier open NVMe question** (follow-up #3 below): no, `--wal-fsync-parallel > 1`
  does **not** help on real NVMe either — the deep device queue doesn't rescue it.
- **Optimal wal config:** `--wal-shards 4` (or `min(cores,4)`), `--wal-fsync-parallel 1`
  (default), `server_cpus` 4–8 (CPU is idle — don't overspend). **The real throughput
  knob is `connections`** (offered load → bigger `batch_avg`), traded against latency
  (36 ms p50 at 3072 in-flight). Server default `shards = core count` is too high on
  many-core boxes; it should be a small fixed value.

## Recommended follow-ups (not done)

Ranked by evidence after the NVMe sweeps above:

1. **Collapse the checkpoint per-stream durability barrier from O(N_touched) syscalls
   to O(1)** — the real cardinality lever. `checkpoint()` (`wal/shard.rs:797`, step 2)
   does one `fdatasync` per touched stream (~580/shard/interval → `fsync_us≈1.4 s`),
   which steals device flush budget from the commit fsyncs and *is* the cliff.
   A single `syncfs()` (or `sync_file_range` batch + one barrier) at checkpoint would
   flush all touched files in one shot. No `syncfs` in the tree today; the per-stream
   loop is hardcoded (no checkpoint-interval flag). This is the highest-value change.
2. **Wal commit-path group commit** (the throughput ceiling): throughput ≈
   `fsync/s × batch_avg`. `fsync/s` is hardware; lift `batch_avg` without needing
   more in-flight (e.g. a small commit-coalescing delay) to raise throughput at lower
   latency. NOT the checkpoint. Supersedes the old "#2 tails" idea (disproved: ~0.5%).
3. **#3 — per-append working-set physics** (residual in both modes): interned stream
   ids + ahash + capacity hint on `Store.streams`; pack hot `StreamState` fields into
   one cacheline. Likely the memory-mode ~8% residual after #1.
4. ~~Validate on remote NVMe / does `--wal-fsync-parallel > 1` help there?~~ —
   **done, answered: no** (see the NVMe sweep above; f8 regresses to 67k).
5. ~~#2 incremental `tails` persistence~~ — **dropped.** ~0.5% of checkpoint time.
