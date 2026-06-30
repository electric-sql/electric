//! Per-shard WAL telemetry — **records-per-`fdatasync` as a distribution** plus
//! the per-shard durability gauges, and a 1 Hz `WAL_STATS` emitter (design spec
//! §11).
//!
//! # The headline signal
//!
//! The batch size = the number of records made durable by **one** `fdatasync`
//! (the count by which `durable_lsn` advanced in that commit). It is the live
//! proof the group-commit committers are healthy and the dial for the deferred
//! io_uring / rebalancing follow-ups:
//!
//! * small batch under load ⇒ committers starved or skewed,
//! * large batch that's fsync-amortized but throughput-capped ⇒ per-op syscall
//!   overhead (io_uring follow-up),
//! * `size_bytes` growing with a flat `checkpoint_lsn` ⇒ checkpoint not keeping
//!   up.
//!
//! # Cost on the hot commit path
//!
//! [`ShardStats::record_batch`] is called once per successful committer
//! `fdatasync` (NOT per append — many appends amortize into one commit). It does
//! a handful of relaxed atomic adds plus one bucketed `fetch_add` — no lock, no
//! allocation, no syscall, no `read_dir`. With the `telemetry` feature OFF the
//! struct is still updated (the atomics are unconditional and tiny) but the 1 Hz
//! emitter task is never spawned, so nothing is read or printed: the cost is the
//! few atomics, which are negligible next to the `fdatasync` they accompany.
//!
//! # Distribution representation
//!
//! A fixed set of **bucketed atomic counters** (boundaries `[1,2,4,8,16,32,64,
//! 128]`, matching the OTel `BATCH_BUCKETS` view in `src/telemetry.rs`), plus
//! `last_batch`, `records_committed`, and `fsync_count`. `avg =
//! records_committed / fsync_count`; `p50` / `p99` / `max` are derived from the
//! cumulative buckets **in the 1 Hz emitter** (off the hot path). A full HdR
//! histogram is overkill here — batch size is a small, bounded count and the
//! coarse power-of-two buckets are exactly what the OTel export already uses.
//!
//! # `size_bytes` / `segments`
//!
//! These come from `read_dir`-ing the shard directory **only in the 1 Hz
//! emitter** (`Shard::wal_size_bytes` / `Shard::wal_segments`), never on the hot
//! commit path (CQ-2). At N shards × 1 Hz this is N `read_dir`s/sec — acceptable
//! and off the append/commit path.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// Upper-inclusive batch-size bucket boundaries (records-per-commit). The last
/// (overflow) bucket catches everything `> 128`. Mirrors the OTel
/// `BATCH_BUCKETS` view so the printed and exported distributions agree.
pub const BATCH_BUCKETS: &[u64] = &[1, 2, 4, 8, 16, 32, 64, 128];

// ===========================================================================
// Runtime contention-stats gate (`--wal-stats`, OFF by default).
// ===========================================================================
//
// The contention counters below (lock-wait nanos, wakeup fan-out) need a clock
// read around each lock acquisition. Reading `Instant::now()` on the per-append
// hot path is NOT free, so the timing is gated behind a runtime flag: when off,
// the hot path pays a single relaxed atomic load and skips the clock entirely;
// when on (`--wal-stats <secs>`), it times every contended acquisition and a
// plain stderr emitter prints per-shard contention lines every `<secs>`.
//
// This is deliberately INDEPENDENT of the heavy `telemetry` (OTLP) feature: the
// whole point is an always-available, zero-dependency way to *observe the lock
// contention* the saturation findings attribute the write ceiling to — no
// collector, no feature rebuild.

/// Whether `--wal-stats` armed the contention timing + emitter.
static STATS_ENABLED: AtomicBool = AtomicBool::new(false);

/// Arm (or disarm) the contention-stats timing on the hot path. Called once at
/// startup from `--wal-stats`; the emitter is spawned separately in `main`.
pub fn set_stats_enabled(on: bool) {
    STATS_ENABLED.store(on, Ordering::Relaxed);
}

/// True when `--wal-stats` armed the contention timing. One relaxed load; the
/// hot path reads this before any `Instant::now()` so a default run pays nothing
/// beyond the load.
#[inline]
pub fn stats_enabled() -> bool {
    STATS_ENABLED.load(Ordering::Relaxed)
}

/// Time `f` (a lock acquisition) and return its result, recording the wait via
/// `record` ONLY when stats are armed. When off this is just `f()` plus one
/// relaxed atomic load — no clock read. Keeps the timing boilerplate out of the
/// shard hot path while guaranteeing the clock is never touched in a default run.
#[inline]
pub fn timed_lock<T>(record: impl FnOnce(u64), f: impl FnOnce() -> T) -> T {
    if stats_enabled() {
        let t0 = std::time::Instant::now();
        let out = f();
        record(t0.elapsed().as_nanos() as u64);
        out
    } else {
        f()
    }
}

/// Per-shard durability + batch-size counters. Cheap to update on the commit
/// path (relaxed atomics only); read off-path by the 1 Hz emitter.
#[derive(Debug)]
pub struct ShardStats {
    /// Total records made durable across all commits (Σ batch sizes). With
    /// `fsync_count`, gives `avg = records_committed / fsync_count`.
    records_committed: AtomicU64,
    /// Number of successful committer `fdatasync`s (each = one batch).
    fsync_count: AtomicU64,
    /// The size of the most recent commit's batch (records that one `fdatasync`
    /// made durable).
    last_batch: AtomicU64,
    /// The largest single-commit batch seen.
    max_batch: AtomicU64,
    /// Bucketed batch-size histogram: `buckets[i]` counts commits whose batch
    /// size is `<= BATCH_BUCKETS[i]` and `> BATCH_BUCKETS[i-1]`; the final extra
    /// slot counts batches `> 128`.
    buckets: [AtomicU64; BATCH_BUCKETS.len() + 1],

    // ---- contention counters (`--wal-stats`; see the gate above) ----
    /// Σ nanoseconds spent acquiring the shard `inner` Mutex on the APPEND path
    /// (phase-1 reserve + phase-2 mark_written), and the number of such
    /// acquisitions. `avg_inner_wait = nanos / acquires`. This is the headline
    /// contention signal: all of a shard's streams funnel through `inner`, so a
    /// rising average here is the per-shard write-serialization the saturation
    /// findings attribute the ceiling to.
    inner_lock_wait_nanos: AtomicU64,
    inner_lock_acquires: AtomicU64,
    /// Σ nanoseconds spent acquiring the shard `dirty` Mutex (one acquisition +
    /// HashMap insert PER append), and the count. Isolates the per-append global
    /// dirty-set lock (Tier-1 target: make it lock-free) from `inner`.
    dirty_lock_wait_nanos: AtomicU64,
    dirty_lock_acquires: AtomicU64,
    /// Number of records staged into this shard (one per `reserve_and_stage`).
    /// The append throughput per shard; pairs with `fsync_count` to show the
    /// real coalescing ratio (`staged / fsync_count`).
    staged: AtomicU64,
    /// Σ durability waiters woken across all commits (the `watch` receiver count
    /// at each `publish_durable`). `avg_wakeups = woken / fsync_count` is the
    /// thundering-herd fan-out: how many parked appenders each commit wakes
    /// (most of which re-check their LSN and immediately re-park).
    waiters_woken: AtomicU64,
}

impl Default for ShardStats {
    fn default() -> Self {
        ShardStats {
            records_committed: AtomicU64::new(0),
            fsync_count: AtomicU64::new(0),
            last_batch: AtomicU64::new(0),
            max_batch: AtomicU64::new(0),
            buckets: Default::default(),
            inner_lock_wait_nanos: AtomicU64::new(0),
            inner_lock_acquires: AtomicU64::new(0),
            dirty_lock_wait_nanos: AtomicU64::new(0),
            dirty_lock_acquires: AtomicU64::new(0),
            staged: AtomicU64::new(0),
            waiters_woken: AtomicU64::new(0),
        }
    }
}

impl ShardStats {
    /// Record one commit's batch = `batch` records made durable by one
    /// `fdatasync`. Called once per successful committer fsync. Hot-path safe:
    /// a few relaxed atomics + one bucket increment, no lock / alloc / syscall.
    ///
    /// A `batch == 0` (the committer never calls this with 0, but be defensive)
    /// is ignored — a zero-record fsync is not a commit.
    pub fn record_batch(&self, batch: u64) {
        if batch == 0 {
            return;
        }
        self.records_committed.fetch_add(batch, Ordering::Relaxed);
        self.fsync_count.fetch_add(1, Ordering::Relaxed);
        self.last_batch.store(batch, Ordering::Relaxed);
        self.max_batch.fetch_max(batch, Ordering::Relaxed);
        let idx = Self::bucket_index(batch);
        self.buckets[idx].fetch_add(1, Ordering::Relaxed);
    }

    /// Record one append-path `inner` Mutex acquisition that waited `nanos`.
    /// Called twice per append (reserve + mark_written) only when stats armed.
    pub fn record_inner_lock_wait(&self, nanos: u64) {
        self.inner_lock_wait_nanos.fetch_add(nanos, Ordering::Relaxed);
        self.inner_lock_acquires.fetch_add(1, Ordering::Relaxed);
    }

    /// Record one `dirty` Mutex acquisition that waited `nanos` (once per append).
    pub fn record_dirty_lock_wait(&self, nanos: u64) {
        self.dirty_lock_wait_nanos.fetch_add(nanos, Ordering::Relaxed);
        self.dirty_lock_acquires.fetch_add(1, Ordering::Relaxed);
    }

    /// Record one record staged into this shard (one per `reserve_and_stage`).
    pub fn record_staged(&self) {
        self.staged.fetch_add(1, Ordering::Relaxed);
    }

    /// Record the durability waiters woken by one commit (`watch` receiver count
    /// at `publish_durable`). Called once per successful commit.
    pub fn record_waiters_woken(&self, n: u64) {
        self.waiters_woken.fetch_add(n, Ordering::Relaxed);
    }

    /// The bucket index for a batch size (the first boundary it does not exceed,
    /// else the overflow slot).
    fn bucket_index(batch: u64) -> usize {
        BATCH_BUCKETS
            .iter()
            .position(|&b| batch <= b)
            .unwrap_or(BATCH_BUCKETS.len())
    }

    /// Snapshot the current counters into a plain (non-atomic) [`StatsSnapshot`]
    /// for the emitter to format. Cheap relaxed loads.
    ///
    /// Telemetry/test-only: consumed by the `telemetry`-feature emitter and the
    /// stats tests; unused in a default build, hence the targeted dead-code allow.
    #[cfg_attr(not(any(feature = "telemetry", test)), allow(dead_code))]
    pub fn snapshot(&self) -> StatsSnapshot {
        let mut buckets = [0u64; BATCH_BUCKETS.len() + 1];
        for (dst, src) in buckets.iter_mut().zip(self.buckets.iter()) {
            *dst = src.load(Ordering::Relaxed);
        }
        StatsSnapshot {
            records_committed: self.records_committed.load(Ordering::Relaxed),
            fsync_count: self.fsync_count.load(Ordering::Relaxed),
            last_batch: self.last_batch.load(Ordering::Relaxed),
            max_batch: self.max_batch.load(Ordering::Relaxed),
            buckets,
            inner_lock_wait_nanos: self.inner_lock_wait_nanos.load(Ordering::Relaxed),
            inner_lock_acquires: self.inner_lock_acquires.load(Ordering::Relaxed),
            dirty_lock_wait_nanos: self.dirty_lock_wait_nanos.load(Ordering::Relaxed),
            dirty_lock_acquires: self.dirty_lock_acquires.load(Ordering::Relaxed),
            staged: self.staged.load(Ordering::Relaxed),
            waiters_woken: self.waiters_woken.load(Ordering::Relaxed),
        }
    }
}

/// A point-in-time copy of a shard's batch counters, with the distribution
/// derivations (avg / p50 / p99 / max). Also aggregatable across shards via
/// [`StatsSnapshot::merge`] for the aggregate `WAL_STATS` line.
///
/// Telemetry/test-only: only the `telemetry`-feature emitter and the stats tests
/// construct/derive from this, so it carries a targeted dead-code allow for the
/// default build.
#[cfg_attr(not(any(feature = "telemetry", test)), allow(dead_code))]
#[derive(Debug, Clone, Default)]
pub struct StatsSnapshot {
    pub records_committed: u64,
    pub fsync_count: u64,
    pub last_batch: u64,
    pub max_batch: u64,
    pub buckets: [u64; BATCH_BUCKETS.len() + 1],
    pub inner_lock_wait_nanos: u64,
    pub inner_lock_acquires: u64,
    pub dirty_lock_wait_nanos: u64,
    pub dirty_lock_acquires: u64,
    pub staged: u64,
    pub waiters_woken: u64,
}

/// All derivations are telemetry/test-only (emitter + stats tests); targeted
/// dead-code allow keeps the default build warning-clean without deleting the
/// WAL_STATS surface.
#[cfg_attr(not(any(feature = "telemetry", test)), allow(dead_code))]
impl StatsSnapshot {
    /// `avg = records_committed / fsync_count` (records-per-commit), `0` when no
    /// commit has happened.
    pub fn avg(&self) -> f64 {
        if self.fsync_count == 0 {
            0.0
        } else {
            self.records_committed as f64 / self.fsync_count as f64
        }
    }

    /// `max` single-commit batch.
    pub fn max(&self) -> u64 {
        self.max_batch
    }

    /// Mean nanoseconds an append waited to acquire the shard `inner` Mutex.
    /// `0` when no acquisition was timed. The headline per-shard write-
    /// serialization signal — near-zero when uncontended, climbs under load.
    pub fn avg_inner_wait_ns(&self) -> f64 {
        if self.inner_lock_acquires == 0 {
            0.0
        } else {
            self.inner_lock_wait_nanos as f64 / self.inner_lock_acquires as f64
        }
    }

    /// Mean nanoseconds an append waited to acquire the per-append `dirty` Mutex.
    pub fn avg_dirty_wait_ns(&self) -> f64 {
        if self.dirty_lock_acquires == 0 {
            0.0
        } else {
            self.dirty_lock_wait_nanos as f64 / self.dirty_lock_acquires as f64
        }
    }

    /// Mean durability waiters woken per commit (`waiters_woken / fsync_count`).
    /// The thundering-herd fan-out: how many parked appenders each commit wakes.
    pub fn avg_waiters_woken(&self) -> f64 {
        if self.fsync_count == 0 {
            0.0
        } else {
            self.waiters_woken as f64 / self.fsync_count as f64
        }
    }

    /// The `q`-quantile (0.0..=1.0) batch size, read off the cumulative buckets.
    /// Returns the **upper boundary** of the bucket the quantile falls in (the
    /// conservative, OTel-explicit-bucket convention); the overflow bucket
    /// reports `max_batch` (its true upper bound). `0` when no commits yet.
    pub fn quantile(&self, q: f64) -> u64 {
        let total = self.fsync_count;
        if total == 0 {
            return 0;
        }
        // rank = ceil(q * total), clamped to >= 1.
        let rank = ((q * total as f64).ceil() as u64).max(1);
        let mut cum = 0u64;
        for (i, &count) in self.buckets.iter().enumerate() {
            cum += count;
            if cum >= rank {
                return match BATCH_BUCKETS.get(i) {
                    Some(&b) => b,
                    // Overflow bucket: its upper bound is the observed max.
                    None => self.max_batch,
                };
            }
        }
        self.max_batch
    }

    pub fn p50(&self) -> u64 {
        self.quantile(0.50)
    }

    pub fn p99(&self) -> u64 {
        self.quantile(0.99)
    }

    /// Fold another shard's snapshot into this one (for the aggregate line).
    pub fn merge(&mut self, other: &StatsSnapshot) {
        self.records_committed += other.records_committed;
        self.fsync_count += other.fsync_count;
        // last_batch across shards: take the most-recent-looking one (largest
        // last_batch is a fine aggregate proxy; the per-shard lines carry the
        // exact per-shard value).
        self.last_batch = self.last_batch.max(other.last_batch);
        self.max_batch = self.max_batch.max(other.max_batch);
        for (a, b) in self.buckets.iter_mut().zip(other.buckets.iter()) {
            *a += *b;
        }
        self.inner_lock_wait_nanos += other.inner_lock_wait_nanos;
        self.inner_lock_acquires += other.inner_lock_acquires;
        self.dirty_lock_wait_nanos += other.dirty_lock_wait_nanos;
        self.dirty_lock_acquires += other.dirty_lock_acquires;
        self.staged += other.staged;
        self.waiters_woken += other.waiters_woken;
    }
}

// ===========================================================================
// 1 Hz `WAL_STATS` emitter (feature `telemetry`).
// ===========================================================================
//
// Spawned once at boot (only under `--durability wal`). Each second it snapshots
// every shard (cheap relaxed loads + one `read_dir`/shard for size/segments —
// OFF the hot commit/append path, CQ-2) and prints one `WAL_STATS shard=<i> ...`
// line per shard plus an aggregate line. With the `telemetry` feature OFF this
// spawns nothing (the no-op below), so a default build pays only the few
// per-commit atomics in `record_batch`.

#[cfg(feature = "telemetry")]
mod emitter {
    use std::sync::Arc;

    use super::StatsSnapshot;
    use crate::wal::walset::WalSet;

    /// How often the emitter prints (spec §11: "1 Hz gauges").
    const EMIT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);

    /// Spawn the 1 Hz `WAL_STATS` emitter for this shard set.
    pub fn spawn_emitter(walset: Arc<WalSet>) {
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(EMIT_INTERVAL);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            ticker.tick().await; // skip the immediate boot tick (no data yet)
            loop {
                ticker.tick().await;
                emit_once(&walset);
            }
        });
    }

    /// Snapshot every shard and print the per-shard + aggregate `WAL_STATS` lines.
    fn emit_once(walset: &WalSet) {
        let mut agg = StatsSnapshot::default();
        let mut agg_size = 0u64;
        let mut agg_segments = 0u64;
        let mut agg_tail = 0u64;
        let mut agg_durable = 0u64;
        let mut agg_ckpt = 0u64;

        for (i, shard) in walset.shards().iter().enumerate() {
            let snap = shard.stats_snapshot();
            // size_bytes / segments: read_dir off the hot path (CQ-2).
            let size_bytes = shard.wal_size_bytes();
            let segments = shard.wal_segments();
            let tail = shard.tail_lsn();
            let durable = shard.durable_lsn_now();
            let ckpt = shard.read_checkpoint_lsn();

            println!(
                "WAL_STATS shard={i} batch_p50={} batch_p99={} batch_max={} \
                 batch_avg={:.2} last_batch={} fsync_count={} tail_lsn={} \
                 durable_lsn={} checkpoint_lsn={} size_bytes={} segments={}",
                snap.p50(),
                snap.p99(),
                snap.max(),
                snap.avg(),
                snap.last_batch,
                snap.fsync_count,
                tail,
                durable,
                ckpt,
                size_bytes,
                segments,
            );

            agg.merge(&snap);
            agg_size += size_bytes;
            agg_segments += segments;
            agg_tail += tail;
            agg_durable += durable;
            agg_ckpt += ckpt;
        }

        println!(
            "WAL_STATS shard=all batch_p50={} batch_p99={} batch_max={} \
             batch_avg={:.2} last_batch={} fsync_count={} tail_lsn={} \
             durable_lsn={} checkpoint_lsn={} size_bytes={} segments={}",
            agg.p50(),
            agg.p99(),
            agg.max(),
            agg.avg(),
            agg.last_batch,
            agg.fsync_count,
            agg_tail,
            agg_durable,
            agg_ckpt,
            agg_size,
            agg_segments,
        );
    }
}

#[cfg(feature = "telemetry")]
pub use emitter::spawn_emitter;

// ===========================================================================
// Always-on contention emitter (`--wal-stats <secs>`, dependency-free).
// ===========================================================================
//
// Unlike the `telemetry`-feature `WAL_STATS` emitter above (which needs the OTLP
// dep tree only to be COMPILED, and prints batch gauges to stdout), this one is
// ALWAYS compiled and prints DELTA-based contention rates to stderr each tick.
// It is the measurement vehicle for the lock-contention investigation: no
// collector, no feature flag — just `--wal-stats 1` and read the `WAL_CONT`
// lines. Spawned from `main` only when `--wal-stats` is passed (which also arms
// `set_stats_enabled(true)` so the hot path actually times the acquisitions).

mod stats_emitter {
    use std::sync::Arc;
    use std::time::Duration;

    use super::StatsSnapshot;
    use crate::wal::walset::WalSet;

    /// Spawn the contention emitter, printing aggregate `WAL_CONT` lines every
    /// `interval`. Deltas are taken against the previous tick so the numbers
    /// reflect the live window, not a warmup-diluted cumulative average.
    pub fn spawn_stats_emitter(walset: Arc<WalSet>, interval: Duration) {
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            ticker.tick().await; // skip the immediate boot tick

            // Per-shard previous snapshots for delta computation.
            let n = walset.shards().len();
            let mut prev: Vec<StatsSnapshot> = vec![StatsSnapshot::default(); n];

            loop {
                ticker.tick().await;
                let dt = interval.as_secs_f64();
                let mut cur_agg = StatsSnapshot::default();
                let mut prev_agg = StatsSnapshot::default();
                for (i, shard) in walset.shards().iter().enumerate() {
                    let cur = shard.stats_snapshot();
                    cur_agg.merge(&cur);
                    prev_agg.merge(&prev[i]);
                    prev[i] = cur;
                }
                print_delta(&cur_agg, &prev_agg, dt);
            }
        });
    }

    /// Print one aggregate `WAL_CONT` line from the (cur − prev) delta over `dt`
    /// seconds. All `avg_*` fields are computed on the DELTA counts so they show
    /// the contention *in this window*.
    fn print_delta(cur: &StatsSnapshot, prev: &StatsSnapshot, dt: f64) {
        let d_staged = cur.staged.saturating_sub(prev.staged);
        let d_fsync = cur.fsync_count.saturating_sub(prev.fsync_count);
        let d_records = cur.records_committed.saturating_sub(prev.records_committed);
        let d_inner_ns = cur
            .inner_lock_wait_nanos
            .saturating_sub(prev.inner_lock_wait_nanos);
        let d_inner_acq = cur
            .inner_lock_acquires
            .saturating_sub(prev.inner_lock_acquires);
        let d_dirty_ns = cur
            .dirty_lock_wait_nanos
            .saturating_sub(prev.dirty_lock_wait_nanos);
        let d_dirty_acq = cur
            .dirty_lock_acquires
            .saturating_sub(prev.dirty_lock_acquires);
        let d_woken = cur.waiters_woken.saturating_sub(prev.waiters_woken);

        let staged_per_s = d_staged as f64 / dt;
        let fsync_per_s = d_fsync as f64 / dt;
        let batch_avg = if d_fsync == 0 { 0.0 } else { d_records as f64 / d_fsync as f64 };
        let inner_wait_us = if d_inner_acq == 0 { 0.0 } else { d_inner_ns as f64 / d_inner_acq as f64 / 1000.0 };
        let dirty_wait_us = if d_dirty_acq == 0 { 0.0 } else { d_dirty_ns as f64 / d_dirty_acq as f64 / 1000.0 };
        let woken_avg = if d_fsync == 0 { 0.0 } else { d_woken as f64 / d_fsync as f64 };
        // Lock-wait *load*: fraction of one core-second spent purely WAITING on
        // each lock in this window (Σ wait nanos / window nanos). >1.0 means more
        // than a whole core's worth of time was lost parking on that lock.
        let inner_wait_load = d_inner_ns as f64 / (dt * 1e9);
        let dirty_wait_load = d_dirty_ns as f64 / (dt * 1e9);

        eprintln!(
            "WAL_CONT staged/s={staged_per_s:.0} fsync/s={fsync_per_s:.0} batch_avg={batch_avg:.1} \
             inner_wait_us={inner_wait_us:.2} inner_wait_load={inner_wait_load:.2} \
             dirty_wait_us={dirty_wait_us:.2} dirty_wait_load={dirty_wait_load:.2} \
             waiters_woken_avg={woken_avg:.1}"
        );
    }
}

pub use stats_emitter::spawn_stats_emitter;

/// No-op `spawn_emitter` (feature off): spawns nothing, prints nothing. A default
/// build pays only the per-commit atomics in `record_batch`.
#[cfg(not(feature = "telemetry"))]
#[inline(always)]
pub fn spawn_emitter(_walset: std::sync::Arc<crate::wal::walset::WalSet>) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn avg_last_max_after_two_commits() {
        let s = ShardStats::default();
        s.record_batch(3);
        s.record_batch(5);
        let snap = s.snapshot();
        assert_eq!(snap.records_committed, 8);
        assert_eq!(snap.fsync_count, 2);
        assert_eq!(snap.last_batch, 5, "last_batch == the most recent commit");
        assert_eq!(snap.max(), 5, "max == max(3,5)");
        assert_eq!(snap.avg(), 4.0, "avg == records/fsync == 8/2");
    }

    #[test]
    fn quantiles_from_buckets() {
        let s = ShardStats::default();
        // 100 commits: 99 of size 4, 1 of size 200 (> 128 ⇒ overflow bucket).
        for _ in 0..99 {
            s.record_batch(4);
        }
        s.record_batch(200);
        let snap = s.snapshot();
        assert_eq!(snap.p50(), 4, "median bucket upper bound");
        assert_eq!(snap.p99(), 4, "99th still in the size-4 bucket");
        assert_eq!(snap.max(), 200);
        // The 200-batch is in the overflow (>128) slot; the top quantile reports
        // that slot's true upper bound = the observed max.
        assert_eq!(snap.quantile(1.0), 200, "top quantile reaches the overflow max");
    }

    #[test]
    fn contention_counters_average_and_merge() {
        let a = ShardStats::default();
        // Two inner acquisitions waiting 100ns and 300ns → avg 200ns.
        a.record_inner_lock_wait(100);
        a.record_inner_lock_wait(300);
        // One dirty acquisition waiting 50ns.
        a.record_dirty_lock_wait(50);
        a.record_staged();
        a.record_staged();
        // One commit woke 8 waiters.
        a.record_batch(2);
        a.record_waiters_woken(8);
        let sa = a.snapshot();
        assert_eq!(sa.inner_lock_acquires, 2);
        assert_eq!(sa.avg_inner_wait_ns(), 200.0);
        assert_eq!(sa.avg_dirty_wait_ns(), 50.0);
        assert_eq!(sa.staged, 2);
        assert_eq!(sa.avg_waiters_woken(), 8.0, "8 woken / 1 commit");

        // Merge a second shard and confirm the contention fields fold in.
        let b = ShardStats::default();
        b.record_inner_lock_wait(200);
        b.record_dirty_lock_wait(150);
        b.record_staged();
        b.record_batch(4);
        b.record_waiters_woken(4);
        let mut agg = sa.clone();
        agg.merge(&b.snapshot());
        assert_eq!(agg.inner_lock_acquires, 3);
        assert_eq!(agg.inner_lock_wait_nanos, 600);
        assert_eq!(agg.avg_inner_wait_ns(), 200.0, "600ns / 3 acquires");
        assert_eq!(agg.dirty_lock_wait_nanos, 200);
        assert_eq!(agg.staged, 3);
        assert_eq!(agg.waiters_woken, 12);
        assert_eq!(agg.avg_waiters_woken(), 6.0, "12 woken / 2 commits");
    }

    #[test]
    fn stats_gate_defaults_off_and_toggles() {
        // The gate defaults off so default runs read no clock; toggling it is what
        // `--wal-stats` does. (Process-global, so just prove the toggle works.)
        super::set_stats_enabled(true);
        assert!(super::stats_enabled());
        super::set_stats_enabled(false);
        assert!(!super::stats_enabled());
    }

    #[test]
    fn merge_aggregates() {
        let a = ShardStats::default();
        a.record_batch(2);
        a.record_batch(6);
        let b = ShardStats::default();
        b.record_batch(10);
        let mut agg = a.snapshot();
        agg.merge(&b.snapshot());
        assert_eq!(agg.records_committed, 18);
        assert_eq!(agg.fsync_count, 3);
        assert_eq!(agg.max(), 10);
        assert_eq!(agg.avg(), 6.0);
    }
}
