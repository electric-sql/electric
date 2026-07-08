# The cardinality cliff — code-level cause research

**Audience:** an engineer/agent picking up the write-cardinality-cliff work with no
prior context. **Date:** 2026-07-08. **Status:** code research only — ranked
hypotheses with file:line evidence and cheap confirmation experiments; no fixes
applied or measured yet. **Companion docs:**
[`CARDINALITY_CLIFF_REPRO.md`](CARDINALITY_CLIFF_REPRO.md) (how to reproduce
locally in ~15-min cycles), [`WRITE_BOTTLENECKS_1M.md`](WRITE_BOTTLENECKS_1M.md)
(background; bottleneck #2 is this cliff).

## The symptom being explained

At fixed offered load, append throughput falls steeply and *per-request* latency
(measured below the knee — not queueing) rises as the number of distinct streams
grows. Local kind repro (2-vCPU server):

| streams | wal thr (rel) | memory thr (rel) |
|---|---|---|
| 1k | 55.4k (100 %) | 112.5k (100 %) |
| 10k | 48.2k (87 %) | 63.7k (57 %) |
| 50k | 27.8k (50 %) | 22.7k (20 %) |

Two discriminating facts any explanation must fit:

1. **The cliff exists in BOTH wal and memory mode** → the dominant mechanism is
   in the shared append path or shared background machinery, not fsync/WAL
   coordination.
2. **Memory mode degrades HARDER than wal locally, ending below it in absolute
   terms at 50k** (22.7k vs 27.8k) → whatever memory mode does *instead of* the
   WAL checkpoint must be more expensive per distinct stream, not less.

The WAL contention counters (`--wal-stats`) stay flat across cardinality, ruling
out lock/wakeup coordination — consistent with everything below.

---

## Ranked causes

### #1 — Per-stream sidecar flush work stops amortizing (both modes; strongest cliff-shaped suspect)

Every append marks its stream's `.meta` JSON sidecar dirty; a periodic task then
rewrites one sidecar per dirty stream. A rewrite is `Meta::capture` (clones path,
content-type, producers map, manifest) + `serde_json::to_vec` + `File::create(tmp)`
+ `write_all` + `rename` — all into the **single shared `streams/` directory**
(`write_meta_sync`, `store.rs:1122`). The `meta_dirty` CAS dedup only helps while
a stream is appended **more than once per flush interval**. So:

```
sidecar writes/sec ≈ min(append rate, N_streams / interval)
```

- At 1k streams / 100k ops/s: ≤1k writes/s — <1 % overhead, invisible.
- Once `N_streams > ops/s × interval`: **every append pays a full sidecar
  rewrite** — the server's filesystem-metadata work roughly doubles per append,
  keyed purely to stream cardinality at fixed load. That is a cliff with exactly
  the observed onset shape.

Mode-specific plumbing (this asymmetry explains why memory ends up *worse*):

- **Memory mode:** `handle_append_inner` → `store.mark_meta_dirty`
  (`handlers.rs:1174` → `store.rs:1170`). The **1 s** sweeper
  (`META_SWEEP_INTERVAL`, `main.rs:455`; loop `main.rs:461-476`) drains the queue
  and writes *all* dirty sidecars **serially inside one `spawn_blocking` task**
  (`store.rs:1184` `sweep_meta_once`). At 50k streams that is up to ~50k
  create+rename pairs per second on one blocking thread of a 2-vCPU server, all
  contending the `streams/` directory inode rwsem (the pre-batching design's
  per-append version of this was measured at ~40 % of server CPU — see the
  comment at `handlers.rs:1160-1168`). On top of that, `mark_meta_dirty` takes a
  **global** `StdMutex<Vec<Arc<StreamState>>>` (`Store.meta_sweep`,
  `store.rs:389`) on every first-touch-per-cycle — and at high cardinality the
  first-touch fraction approaches 100 % of appends, so a global hot-path lock
  reappears that wal mode avoids with a plain atomic store (`handlers.rs:1168`).
- **wal mode:** the **3 s** shard checkpoint owns the flush — O(touched streams)
  `write_meta_sync` calls (`wal/shard.rs:877-883`) **plus** one `barrier_fsync`
  per touched per-stream data file (`wal/shard.rs:837-839`): ~16k fdatasyncs/s
  at 50k streams touched per interval. Sharded + concurrent (JoinSet,
  `main.rs:437-446`) + 3 s cadence, vs memory's serial global 1 s sweep — hence
  the milder wal curve.

### #2 — wal-only: `persist_durable_tails` is O(total streams ever touched), every checkpoint

Each checkpoint also rewrites the shard's `tails` file from a **cumulative**
resident map of every stream ever touched on that shard (`tails_cache`,
`wal/shard.rs:354`): collect the whole map → `sort_unstable` → serialize every
entry → write → `sync_all` → rename (`wal/shard.rs:922-957`). Cost is
**O(total distinct streams per shard) regardless of how many were touched this
tick**, grows monotonically (idle streams never leave), and runs on a blocking
thread every 3 s. The field doc estimates ~20 ms/tick at 400k streams. A strong
contributor to the wal curve's steepening and a direct competitor for the
blocking pool / disk bandwidth the committer needs.

### #3 — Shared per-append working-set physics (both modes; explains the below-knee latency rise)

- **Registry lookup:** `Store.streams` is `DashMap<String, Arc<StreamState>>`
  with the **default SipHash hasher and no capacity hint** (`store.rs:369`,
  `:423`); one lookup per append (`store.rs:667`, called at `handlers.rs:899`).
  Fixed instruction cost, but at 50k–1M entries the map plus its `Arc` targets
  outgrow L2/L3, so each lookup pays several main-memory misses. (The code
  already knows: see the comment at `handlers.rs:889-891` about avoiding a
  second lookup.)
- **Per-stream cacheline spray:** each append touches the stream's `appender`
  AsyncMutex, the `shared` RwLock **six-to-eight separate times** (lookup check;
  soft-delete check `handlers.rs:909`; closed check `handlers.rs:958`;
  `write_wire`'s write `handlers.rs:741`; the producer/seq write at
  `handlers.rs:1087` — taken even when there are no producer headers;
  `wal_stream_offset`'s read `handlers.rs:679`; `publish_durable_tail`'s write
  `handlers.rs:762`; the final `tail()` read `handlers.rs:1180`), plus the
  `last_chunk` RwLock and the `tail_tx` watch. On a hot stream these lines are
  cache-resident; at high cardinality every one is a miss. Per-request latency
  therefore rises with N with no queueing involved — matching the knee-p50 trend
  in both modes, local and remote.
- **Kernel-side one-file-per-stream:** at fixed byte volume, N distinct streams
  dirty N distinct inodes per writeback interval — inode writeback, ext4 journal
  handles, dentry/page-cache pressure all scale with distinct files touched,
  plus ~1 persistent fd per stream (`Shared.file`, `store.rs:72`).

### #4 — wal-only, secondary: `register_dirty` first-touch transitions

The hot path is lock-free (`dirty_epoch` compare, `wal/shard.rs:722-726`), but
the first touch per stream per checkpoint interval CASes the epoch, takes the
shard `dirty` mutex and pushes an `Arc` clone (`wal/shard.rs:737-749`). At fixed
load, growing cardinality raises the first-touch fraction toward 100 % of
appends — the same "dedup stops working" arithmetic as #1, but sharded and much
cheaper per event. Real, but secondary.

---

## Ruled out (checked, with evidence)

- **SSE reactor:** `wake_stream` early-returns when a stream has no subscribers
  (`sse_reactor.rs:144-146`); no reactor thread is even spawned without a
  `register`. O(1) per append in a write-only benchmark.
- **Telemetry:** default build compiles the recorders to no-ops
  (`telemetry.rs:353-398`); with the feature on, label sets are bounded/static —
  never keyed per stream. `wal/telemetry.rs` is per-shard, not per-stream.
- **Tiering/blobstore:** fully inert without `--tier` (`maybe_seal_bg` gate,
  `handlers.rs:663`; `enabled()` gates inside tier.rs).
- **WAL group commit & durability wakeups:** per-commit work is O(batch) +
  O(satisfied waiters) (`wal/shard.rs:1263-1305`, `:1322-1336`); the waiter
  registry is one oneshot per in-flight request keyed by LSN — scales with
  offered load, not stream count. Matches the flat `*_wait_load` counters.
- **WAL record encoding:** records carry an interned `stream_id: u64`
  (`wal/codec.rs:78-84`), never the path string; frame is a fixed 38-byte header
  + payload.
- **Full-registry scans:** none exist. `Store.streams` is only ever
  point-accessed (get/insert/remove); no background loop iterates it.
- **Segment recycling:** `read_dir` costs scale with byte throughput / segment
  count, not stream count.
- **HTTP layer (`engine_raw.rs` / `http1.rs` / `api.rs`):** no per-stream state,
  no stream-keyed maps; header access is O(request headers).

---

## Cheap confirmation experiments (in suspect order)

1. **Memory mode / #1:** temporarily neuter the sweeper's sidecar write (or just
   log `sweep_meta_once`'s returned count + wall time per tick, call site
   `main.rs:473`). If the 1k→50k memory curve flattens dramatically with writes
   disabled, #1 is confirmed for memory mode. (The producer-dedup lag this
   introduces is already a documented non-durable window — fine for a bench.)
2. **wal mode / #1+#2:** run with `--wal-stats 1` and read the existing
   `WAL_CKPT` line (`wal/shard.rs:887-899`) — `touched=`, `meta_us=`, and the
   tails entry count should climb with cardinality while commit-path counters
   stay flat.
3. **Shared baseline / #3:** swap the registry hasher (ahash) or key by interned
   id, add a capacity hint, and re-measure — isolates the lookup-miss share of
   the residual cliff that would remain after #1/#2 are fixed.

## Fix directions

> **#1 is DONE and measured — see [`CARDINALITY_CLIFF_FIX.md`](CARDINALITY_CLIFF_FIX.md).**
> A plain non-TTL append no longer writes/queues a sidecar rewrite in either mode
> (the durable tail is carried by the data-file length in memory mode / the
> per-shard `tails` map in wal mode; `last_access` only gates TTL). Result: memory
> cliff essentially eliminated (50k streams **+104%**, 44%→92% of the 1k rate); wal
> a modest, correct win (50k **+11%** throughput, knee p50 4.0→2.5 ms) — the wal
> cliff is fsync/`tails`-bound (#2 below), not the meta write. The items below
> remain.

- Spread the meta sweep over the interval and shard its queue; make memory-mode
  dirty-tracking lock-free like wal's (atomic + per-shard queues). *(Largely moot
  now — the common case queues nothing; only producer/seq/TTL appends do.)*
- ~~Skip sidecar rewrites whose captured contents are unchanged (append-only
  streams with no producers churn only `durable_tail`/`last_access`).~~ **Done (#1).**
- Incremental/delta `tails` persistence instead of the full-map rewrite per
  checkpoint (#2).
- Batch/fan out the checkpoint fdatasyncs; consider syncing only files whose
  WAL records are about to be recycled.
- Interned stream ids + faster hasher + sharded registry; pack the per-append
  hot fields of `StreamState` into one cacheline (#3).
