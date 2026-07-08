//! A single WAL shard — append staging, a group-commit committer, and the
//! **contiguous-written watermark** that gates durability (design spec §6).
//!
//! # The durability invariant (the whole point of this module)
//!
//! Appenders run in two phases:
//!
//! 1. **Reserve** (under a short lock): assign the next in-shard `lsn` and a
//!    byte range in the active segment, bump `next_lsn` / `write_pos`. The lock
//!    is held only for this bookkeeping.
//! 2. **Stage** (off-lock): encode the framed record and `write_at` its reserved
//!    range, then mark the `lsn` *written*.
//!
//! Because phase 2 runs off-lock, **completion order may differ from lsn order**:
//! lsn `k+1` can finish its bytes before lsn `k`. The committer therefore never
//! advances `durable_lsn` to the highest *assigned* lsn — only to the highest
//! lsn whose **entire prefix** (itself and every prior in-shard record) is on
//! disk and `fdatasync`'d. A record acks durable only when that holds for it.
//!
//! ## Watermark data structure
//!
//! [`ShardInner`] tracks the contiguous-written watermark as a cursor
//! (`written_high`) plus a [`BTreeSet`] of lsns that completed *out of order*
//! above the cursor. On each completion we insert the lsn, then collapse the
//! cursor forward across every contiguous lsn present in the set. A reserved-
//! but-never-written lsn (a *gap*, e.g. an appender that crashed between reserve
//! and stage, or the `#[cfg(test)] reserve_only` hook) is never inserted, so the
//! cursor can never advance past it even if every later lsn is written — exactly
//! the invariant the committer relies on. `lsn`s start at 1; `written_high == 0`
//! means "nothing contiguous yet".

use std::cmp::Ordering as CmpOrdering;
use std::collections::{BTreeSet, BinaryHeap, HashMap};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};

use tokio::sync::oneshot;

use super::codec::{encode_into, Record, RecordKind};
use super::segment::{seg_path, FileSegment, SegmentWriter, SEGMENT_BYTES};
use super::telemetry::{ShardStats, StatsSnapshot};
use crate::store::StreamState;

/// Mutable, lock-guarded shard state.
///
/// **No-panic-under-lock invariant:** every critical section holding `inner`
/// (and `dirty`) must be panic-free — fallible operations use `?`, and the only
/// `.unwrap()`s are on lock acquisition itself. This is load-bearing: a panic
/// while holding `inner` would poison the std `Mutex`, and the committer's
/// `snapshot_watermark`/`collect_fsync_targets`/`publish_durable` would then
/// panic on every poll, freezing `durable_lsn` and hanging all `wait_durable`
/// waiters (acks) for this shard forever. Keep allocation and indexing out of
/// these sections, or guard them, when editing.
struct ShardInner {
    /// The active (current) segment all new records are written into. Held as an
    /// `Arc` so an appender can clone the handle under the short lock and run its
    /// positioned `write_at` off-lock; the committer's `fdatasync` clones it the
    /// same way. **Segment roll** swaps this `Arc` for a fresh full-size segment.
    active: Arc<FileSegment>,
    /// The lsn of the first record this active segment holds (its file name).
    seg_start_lsn: u64,
    /// Next free byte offset within the active segment.
    write_pos: u64,
    /// **Sealed segments that may still hold un-durable records.** A roll seals the
    /// old active segment and pushes `(end_lsn, segment)` here, where `end_lsn` is
    /// the highest lsn that lives in it. The committer `fdatasync`s every pending
    /// sealed segment (not just the active one) before advancing `durable_lsn`, and
    /// drops entries whose `end_lsn <= durable` once durable catches up.
    ///
    /// # Why this is required (the no-window argument)
    ///
    /// An appender reserves its byte range under the lock but runs its `write_at`
    /// *off-lock*. So a record `P` can be reserved in the old segment, then a
    /// concurrent appender's roll seals that segment, and only *afterwards* does
    /// `P`'s off-lock `write_at` land in the (now-sealed) old segment and `P` get
    /// `mark_written`. The seal's own fsync (at roll time) happened BEFORE `P`'s
    /// bytes, so it does not cover them. If the committer fsync'd only the *active*
    /// segment, it could advance `durable_lsn` past `P` while `P`'s bytes in the
    /// sealed segment were never fsync'd — acked-record loss. Fsyncing every
    /// pending sealed segment closes that window: a record is only crossed by the
    /// watermark once `mark_written`, and the committer fsyncs the exact segment it
    /// lives in (active or pending-sealed) before publishing past it.
    sealed_pending: Vec<(u64, Arc<FileSegment>)>,
    /// Next lsn to assign (monotonic within the shard; first record is lsn 1).
    next_lsn: u64,
    /// Highest lsn `w` such that every lsn in `1..=w` has been written. `0` ⇒
    /// none yet. This is the contiguous-written watermark.
    written_high: u64,
    /// lsns that completed *above* `written_high` while an earlier lsn was still
    /// pending (out-of-order completion). Collapsed into `written_high` as the
    /// gap below them fills.
    written_ahead: BTreeSet<u64>,
}

impl ShardInner {
    /// Mark `lsn` written and collapse the contiguous-written cursor forward.
    /// Safe under out-of-order completion: a lsn is only crossed once it is in
    /// `written_ahead`, so a never-written gap blocks the cursor permanently.
    fn mark_written(&mut self, lsn: u64) {
        self.written_ahead.insert(lsn);
        while self.written_ahead.remove(&(self.written_high + 1)) {
            self.written_high += 1;
        }
    }
}

/// A single parked `wait_durable(lsn)` caller: its target `lsn`, a monotonic
/// `seq` (tie-break so equal-lsn waiters have a total order — `BinaryHeap`
/// requires `Ord`), and the `oneshot` whose fire un-parks it.
///
/// Ordered as a **min-heap by `lsn`** (then `seq`): we reverse the natural
/// comparison so [`BinaryHeap`] (a max-heap) yields the *smallest* lsn at the
/// top. That lets [`Shard::publish_durable`] pop exactly the prefix of waiters
/// with `lsn <= watermark` and stop — the coalesced wakeup — instead of the old
/// `watch` broadcast that woke every parked subscriber.
struct DurableWaiter {
    lsn: u64,
    seq: u64,
    tx: oneshot::Sender<()>,
}

impl PartialEq for DurableWaiter {
    fn eq(&self, other: &Self) -> bool {
        self.lsn == other.lsn && self.seq == other.seq
    }
}
impl Eq for DurableWaiter {}
impl PartialOrd for DurableWaiter {
    fn partial_cmp(&self, other: &Self) -> Option<CmpOrdering> {
        Some(self.cmp(other))
    }
}
impl Ord for DurableWaiter {
    fn cmp(&self, other: &Self) -> CmpOrdering {
        // Reverse `(lsn, seq)` so the max-heap pops the LOWEST lsn first.
        other
            .lsn
            .cmp(&self.lsn)
            .then_with(|| other.seq.cmp(&self.seq))
    }
}

/// Per-shard min-ordered registry of parked durability waiters (the coalesced
/// replacement for the `watch` broadcast). Guarded by a short `Mutex` held only
/// to push one waiter (`wait_durable`) or drain the satisfied prefix
/// (`publish_durable`).
struct WaiterReg {
    heap: BinaryHeap<DurableWaiter>,
    /// Monotonic id handed to each waiter for the heap tie-break.
    next_seq: u64,
}

/// Stage→committer signalling for the **dedicated-OS-thread committer** (Tier-2a).
///
/// The committer no longer lives on the shared async runtime, so the wakeup can
/// no longer be an async `tokio::sync::Notify`. This is a plain
/// `Mutex<flags> + Condvar` the sync appender (`reserve_and_stage`) signals and
/// the committer thread blocks on.
///
/// **Lost-wakeup safety (the load-bearing invariant):** `work_pending` is set
/// **under the same mutex** the committer checks before parking, and the
/// committer always *re-snapshots the watermark off-lock after waking* — so a
/// stage that races the committer's park is never lost. Two cases: if the stage
/// takes the mutex *after* the committer parks, the condvar wakes the committer
/// (standard predicate-under-lock pattern), which then re-snapshots and commits;
/// if the stage takes the mutex *before* the committer parks, the committer sees
/// `work_pending == true` and does not park, looping to re-snapshot.
///
/// Because the watermark is always read fresh after the park (never carried
/// across), cross-mutex ordering between `inner` (watermark) and this mutex
/// cannot drop a staged record. This is the same guarantee the old
/// `Notify`-registration-before-snapshot gave.
struct CommitSignal {
    state: Mutex<CommitState>,
    cv: Condvar,
}

#[derive(Default)]
struct CommitState {
    /// A stage happened since the committer last cleared this — there may be new
    /// contiguous-written work to fsync. Set under `state`, cleared by the
    /// committer under `state` before it re-snapshots the watermark.
    work_pending: bool,
    /// Shutdown requested: the committer must do a final drain and exit.
    stop: bool,
}

impl CommitSignal {
    fn new() -> Self {
        CommitSignal {
            state: Mutex::new(CommitState::default()),
            cv: Condvar::new(),
        }
    }

    /// Appender → committer (hot path): mark work pending and wake the committer.
    /// The flag is set under `state` so it can never be lost against the
    /// committer's park (see type docs).
    fn signal_work(&self) {
        {
            let mut g = self.state.lock().unwrap();
            g.work_pending = true;
        }
        // Notify after releasing the lock so a woken committer doesn't immediately
        // re-block on the mutex we still hold.
        self.cv.notify_one();
    }

    /// Shutdown → committer: request a clean stop (committer drains then exits).
    fn signal_stop(&self) {
        {
            let mut g = self.state.lock().unwrap();
            g.stop = true;
        }
        self.cv.notify_one();
    }

    /// Block until a stage signals work or stop is requested; clear the
    /// `work_pending` flag and return whether `stop` was requested. Called by the
    /// committer when it has caught up (nothing left to commit).
    fn wait_for_work(&self) -> bool {
        let mut g = self.state.lock().unwrap();
        while !g.work_pending && !g.stop {
            g = self.cv.wait(g).unwrap();
        }
        g.work_pending = false;
        g.stop
    }

    /// Error-backoff wait: park up to `timeout`, returning early if stop is
    /// requested. Returns whether `stop` was requested. Does **not** clear
    /// `work_pending` — we want to retry the same un-acked watermark, and a
    /// pending stage should still drive the next wake. Using the condvar (rather
    /// than `thread::sleep`) lets shutdown interrupt a long backoff.
    fn backoff_wait(&self, timeout: std::time::Duration) -> bool {
        let g = self.state.lock().unwrap();
        if g.stop {
            return true;
        }
        let (g, _timed_out) = self.cv.wait_timeout(g, timeout).unwrap();
        g.stop
    }
}

/// Handle to a shard's dedicated committer OS thread. Signalling stop + joining
/// happens on `stop()` (or on `Drop`, so a handle dropped without an explicit
/// stop still shuts the thread down cleanly rather than detaching it).
pub struct CommitterHandle {
    shard: Arc<Shard>,
    join: Option<std::thread::JoinHandle<()>>,
}

impl CommitterHandle {
    /// Signal the committer to stop (non-blocking; does not join). Idempotent.
    pub fn signal_stop(&self) {
        self.shard.commit_signal.signal_stop();
    }

    /// Join the committer thread (call after `signal_stop`). Consumes the handle.
    pub fn join(mut self) {
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }

    /// Signal stop and join — the common single-handle path (the WalSet shutdown
    /// path instead `signal_stop`s all shards then `join`s all, for a parallel
    /// drain). Used by the test harnesses; allowed dead in the production binary.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn stop(self) {
        self.signal_stop();
        self.join();
    }
}

impl Drop for CommitterHandle {
    fn drop(&mut self) {
        // Ensure the thread is asked to stop and reaped even if the handle is
        // dropped without an explicit `stop()` (e.g. a test guard going out of
        // scope, or the WalSet being torn down).
        self.shard.commit_signal.signal_stop();
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

/// One WAL shard: a segmented append-only log with its own committer.
pub struct Shard {
    inner: Mutex<ShardInner>,
    /// The highest lsn made durable + acked. Read cheaply (one relaxed-ish
    /// atomic load) by `wait_durable`'s fast path, `checkpoint`, the committer,
    /// and stats; advanced only by `publish_durable`. Replaces the `watch`
    /// channel's value role — the WAKE role lives in `waiters` below. Storing an
    /// atomic + firing oneshots both work from the dedicated committer thread
    /// (Tier-2a), with no tokio runtime handle, so async `wait_durable` futures
    /// are still woken across the thread boundary.
    durable_lsn: AtomicU64,
    /// Min-ordered (by lsn) registry of parked `wait_durable` waiters. A commit
    /// drains only the waiters whose lsn the new watermark satisfies, instead of
    /// broadcasting to every parked subscriber (the Tier-1c thundering-herd fix).
    waiters: Mutex<WaiterReg>,
    /// Wakes the dedicated committer thread whenever a record is staged (and
    /// carries the shutdown signal). See [`CommitSignal`].
    commit_signal: CommitSignal,
    /// `<data-dir>/wal/<shard>/` — where this shard's segments live.
    dir: PathBuf,
    /// The size each segment is `fallocate`'d to and the roll threshold. Defaults
    /// to [`SEGMENT_BYTES`] (128 MiB); a `#[cfg(test)]`/constructor override lets a
    /// test force rolls with a tiny (e.g. 4 KiB) segment without writing 128 MiB.
    /// Immutable for the shard's lifetime, so a plain field (no lock) is enough.
    segment_size: u64,
    /// **Dirty set** (spec §7): the per-stream `StreamState`s this shard has
    /// *touched* since its last checkpoint. The append path (`maybe_sync_on_ack`)
    /// registers the touched stream's `Arc<StreamState>` here via
    /// `register_dirty`. `checkpoint()` drains this collection, reads each stream's
    /// current logical `Shared.tail` and live `Shared.file`, `fdatasync`s exactly
    /// these files — no double-fsync of untouched streams — *before* recycling the
    /// WAL, and records each stream's durable tail (the tail at the moment its file
    /// is fsync'd) into the persisted per-shard tail map (spec §7, task 11b).
    /// Holding the `StreamState` (rather than a bare `Arc<File>`) lets checkpoint
    /// read the logical tail it must record alongside the file it fsyncs. This
    /// stays decoupled from `reserve_and_stage`, which never needs the
    /// `StreamState`.
    ///
    /// **Lock-free hot path (Tier-1a):** dedup is no longer done by a per-append
    /// `HashMap` insert under this lock. Instead each stream carries a
    /// `StreamState.dirty_epoch`; `register_dirty` only takes this lock to `push`
    /// on the winning 0→current-epoch CAS transition (at most once per stream per
    /// checkpoint interval, ~3 s). The already-dirty hot path never touches this
    /// lock — it is a `Vec` (not a map) because the epoch CAS already guarantees
    /// each stream is pushed at most once per interval, so no in-collection dedup
    /// is needed (a stale-epoch race can at worst push a stream twice, costing one
    /// redundant — harmless — fdatasync, never a lost stream).
    dirty: Mutex<Vec<Arc<StreamState>>>,
    /// **Current checkpoint epoch** (Tier-1a), starts at `1` (StreamStates start at
    /// `dirty_epoch == 0`, so the first append always registers). `checkpoint()`
    /// `fetch_add(1)`s this and drains `dirty` in the same step. A stream's
    /// `register_dirty` compares the stream's `dirty_epoch` to this: equal ⇒
    /// already registered this interval (pure relaxed-load hot path, no lock);
    /// otherwise CAS the stream to this epoch and, on the winning transition, push
    /// it into `dirty`. Bumping BEFORE/with the drain is load-bearing: an append
    /// racing the drain sees a stale stream epoch and re-registers into the next
    /// interval's collection — no touched stream is ever dropped.
    dirty_epoch: AtomicU64,
    /// Resident copy of the CUMULATIVE per-stream durable-tail map persisted at
    /// `<shard_dir>/tails` (task 11b). `None` until the first checkpoint needs it
    /// (then seeded from disk once); afterwards `persist_durable_tails` merges and
    /// serializes from memory instead of re-reading + re-parsing the whole file
    /// every ~3 s (O(total streams per shard) — ~20 ms/tick at 400k streams).
    /// Only the (serialized, per-shard) checkpoint path locks it.
    tails_cache: Mutex<Option<HashMap<u64, u64>>>,
    /// Per-shard batch-size + durability counters (spec §11). Updated once per
    /// successful committer `fdatasync` (`record_batch`) — cheap relaxed atomics,
    /// no lock/alloc/syscall on the commit path. Read off-path by the 1 Hz
    /// `WAL_STATS` emitter.
    stats: ShardStats,
    /// Test-only seam: invoked at the very start of `reserve_and_stage`, before
    /// any lsn is reserved/staged (i.e. before this record's lsn can ever become
    /// durable). Lets a test assert the per-stream file was ALREADY registered
    /// into the dirty set by the time staging begins — proving `register_dirty`
    /// precedes `reserve_and_stage` (CQ-1 ordering invariant, spec §7).
    #[cfg(test)]
    #[allow(clippy::type_complexity)]
    on_stage: Mutex<Option<Box<dyn Fn(u64) + Send + Sync>>>,
    /// Test-only fault injection: when set, the NEXT `reserve_and_stage`'s
    /// `write_at` is simulated as failing (returns an `io::Error` instead of
    /// writing). Lets a test prove a transient WAL write error FAILS the ack
    /// (propagates a `Result::Err`) rather than panicking the process.
    #[cfg(test)]
    fail_next_write: std::sync::atomic::AtomicBool,
}

/// Name of the per-shard checkpoint-lsn file: `<shard_dir>/checkpoint` (plain
/// decimal text). A value of `N` means every record with lsn ≤ `N` has had its
/// per-stream-file bytes `fdatasync`'d, so WAL segments fully below `N` are
/// recyclable.
const CHECKPOINT_FILE: &str = "checkpoint";

/// Concurrency for the checkpoint's per-stream `fdatasync` phase (cardinality-cliff
/// H4). At high stream cardinality that phase dominates the checkpoint (~99% of its
/// wall time), and a serial loop pays `latency × N_touched` while the storage
/// device's queue depth (NVMe: many in flight) sits idle. Fanning the syncs across
/// this many OS threads lets the device absorb them concurrently; all still
/// complete before `persist_durable_tails`/recycle, preserving the
/// durability-before-recycle ordering. `1` (the DEFAULT) = serial, i.e. a no-op
/// change unless `--wal-fsync-parallel N` opts in.
///
/// Default is serial because a fixed high fan-out REGRESSES on a CPU-constrained
/// server or storage that does not do concurrent fsync: measured on a 2-vCPU Linux
/// container (Docker, virtiofs) fan-out=16 was −19% vs serial — the 16 sync threads
/// per shard stole CPU from the runtime, slowing the committer until checkpoints
/// fell behind. The win requires real NVMe (deep device queue) AND spare cores;
/// validate there before raising the default.
static FSYNC_FANOUT: AtomicU64 = AtomicU64::new(1);
pub fn set_fsync_fanout(n: u64) {
    FSYNC_FANOUT.store(n.max(1), Ordering::Relaxed);
}
fn fsync_fanout() -> usize {
    FSYNC_FANOUT.load(Ordering::Relaxed) as usize
}

/// Name of the per-shard durable-tail map: `<shard_dir>/tails` (task 11b). A
/// CUMULATIVE `stream_id durable_tail` line map (plain decimal text, one stream
/// per line). At checkpoint, each touched stream's current logical `Shared.tail`
/// (the file is durable up to it after the checkpoint `fdatasync`) is merged in
/// and the whole map is written `tmp`+rename + fsync'd **before** segments are
/// recycled — so recovery can truncate a stream's torn per-stream-file tail even
/// when every WAL record for that stream has been recycled (its durable boundary
/// is gone from the WAL). Cumulative: a stream touched in an earlier checkpoint
/// but not this one keeps its last recorded durable tail.
const TAILS_FILE: &str = "tails";

impl Shard {
    /// Open (creating if needed) the shard rooted at `dir`, opening the active
    /// segment at lsn 1 and resetting the **in-memory** cursor (`write_pos == 0`,
    /// `next_lsn == 1`).
    ///
    /// **Non-destructive on disk:** the existing `<start>.wal` segment is opened
    /// `truncate(false)`, so its pre-crash bytes survive for [`recovery`] to read
    /// and replay. Because the in-memory cursor is reset to the start while the
    /// on-disk segment still holds the old records, [`Shard::reset_after_recovery`]
    /// MUST run after recovery and before any new append — it wipes the stale
    /// on-disk segments so fresh appends can't leave a mis-decodable stale suffix
    /// behind them (see that method's docs for the full crash-correctness argument).
    ///
    /// [`recovery`]: super::recovery
    ///
    /// Convenience default-size entry (`SEGMENT_BYTES`). Production opens shards via
    /// [`WalSet::open`]→[`Shard::open_with_segment_size`]; this default-size form is
    /// the unit-test constructor.
    ///
    /// [`WalSet::open`]: super::walset::WalSet::open
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn open(dir: PathBuf) -> io::Result<std::sync::Arc<Shard>> {
        Shard::open_with_segment_size(dir, SEGMENT_BYTES)
    }

    /// Like [`Shard::open`] but with an explicit `segment_size` (the `fallocate`
    /// size and the segment-roll threshold). Production threads
    /// [`SEGMENT_BYTES`] (or `--wal-segment-bytes`) through here from
    /// [`WalSet::open_with_segment_size`]; tests pass a small size to force rolls
    /// cheaply.
    ///
    /// [`WalSet::open_with_segment_size`]: super::walset::WalSet::open_with_segment_size
    pub fn open_with_segment_size(dir: PathBuf, segment_size: u64) -> io::Result<std::sync::Arc<Shard>> {
        std::fs::create_dir_all(&dir)?;
        // Boot must be NON-DESTRUCTIVE (spec §9: recover-before-clobber): the
        // on-disk segments are the durable log recovery is about to replay.
        //
        //  - A SEALED segment was truncated to its exactly-packed length at the
        //    roll; that exact length is how replay walks across the segment seam.
        //    Re-`fallocate`ing it to full size grafts a zero tail onto it, which
        //    replay reads as `Incomplete` = end of the durable log — silently
        //    dropping every later segment's acked records (and recovery then
        //    truncates the per-stream files back to that stale frontier).
        //  - A RECYCLED `1.wal` no longer exists; creating a fresh zero-filled
        //    one makes replay (which walks in start-lsn order) decode zero
        //    records and stop before the real oldest retained segment.
        //
        // So: if any segment exists, open the highest-start one as a read-only
        // placeholder handle and leave the disk untouched. The in-memory cursor
        // (`write_pos`/`next_lsn`) is a placeholder too — `reset_after_recovery`
        // MUST rebuild both (fresh `1.wal`, cursor to 0/1) before any append,
        // which is the documented boot order (`open` → `recover` → `reset`).
        // Only a genuinely fresh shard dir creates + preallocates `1.wal` here.
        let mut existing: Vec<(u64, PathBuf)> = Vec::new();
        for entry in std::fs::read_dir(&dir)? {
            let path = entry?.path();
            let Some(stem) = path
                .file_name()
                .and_then(|s| s.to_str())
                .and_then(|n| n.strip_suffix(".wal"))
            else {
                continue;
            };
            if let Ok(start) = stem.parse::<u64>() {
                existing.push((start, path));
            }
        }
        existing.sort_by_key(|(s, _)| *s);
        let (seg_start_lsn, active) = match existing.pop() {
            Some((start, path)) => (start, Arc::new(FileSegment::open_existing(path)?)),
            None => (
                1,
                Arc::new(FileSegment::create(seg_path(&dir, 1), segment_size)?),
            ),
        };
        Ok(std::sync::Arc::new(Shard {
            inner: Mutex::new(ShardInner {
                active,
                seg_start_lsn,
                write_pos: 0,
                sealed_pending: Vec::new(),
                next_lsn: seg_start_lsn,
                written_high: 0,
                written_ahead: BTreeSet::new(),
            }),
            durable_lsn: AtomicU64::new(0),
            waiters: Mutex::new(WaiterReg {
                heap: BinaryHeap::new(),
                next_seq: 0,
            }),
            commit_signal: CommitSignal::new(),
            dir,
            segment_size,
            dirty: Mutex::new(Vec::new()),
            // Epoch starts at 1; StreamStates start at dirty_epoch 0, so the first
            // append on every stream registers it (0 != 1).
            dirty_epoch: AtomicU64::new(1),
            tails_cache: Mutex::new(None),
            stats: ShardStats::default(),
            #[cfg(test)]
            on_stage: Mutex::new(None),
            #[cfg(test)]
            fail_next_write: std::sync::atomic::AtomicBool::new(false),
        }))
    }

    /// **Reset this shard's on-disk WAL to a fresh, empty state** after recovery
    /// has replayed every durable record into the per-stream files (design spec §9
    /// recover-before-clobber resolution).
    ///
    /// # Why this is required for crash-correctness
    ///
    /// `Shard::open` is **non-destructive**: it opens the existing `<start>.wal`
    /// segment (`O_RDWR|O_CREAT`, `truncate(false)`) so its pre-crash bytes survive
    /// for recovery to read — but it resets the **in-memory** cursor to
    /// `write_pos == 0`, `next_lsn == 1`. So after `open` + recovery, the live
    /// committer/appenders would begin writing at offset 0 / lsn 1 **into a segment
    /// that still holds the old, whole, framed pre-crash records**. A new (shorter)
    /// record at offset 0 can leave a *stale suffix* of old whole records behind it;
    /// on a *second* crash, recovery would decode those stale records as valid and
    /// mis-replay them — a correctness hole.
    ///
    /// The fix: once recovery has made every durable record durable in the
    /// per-stream files (`wal::recovery::recover` fsyncs them), the **old WAL is
    /// redundant**. We delete every `*.wal` segment in this shard and re-create a
    /// single fresh, zero-filled active segment at lsn 1 — matching the clean
    /// in-memory state `open` already set. New appends then land in a zeroed
    /// segment; the decoder hits the `fallocate` zeros immediately after the last
    /// live record (clean end-of-log), so no stale record is ever re-applied. The
    /// `checkpoint` file is removed too (a fresh WAL has no checkpoint).
    ///
    /// **Must run AFTER `recover` and BEFORE `spawn_committers`/any append**, while
    /// the shard is single-threaded at boot.
    pub fn reset_after_recovery(&self) -> io::Result<()> {
        // Unlink every on-disk segment (and the stale checkpoint marker): recovery
        // has already made their records durable in the per-stream files.
        for entry in std::fs::read_dir(&self.dir)? {
            let path = entry?.path();
            match path.extension().and_then(|s| s.to_str()) {
                Some("wal") => std::fs::remove_file(&path)?,
                _ => {
                    // Drop the stale checkpoint marker AND the durable-tail map
                    // (task 11b): recovery has already truncated/extended every
                    // per-stream file to its durable frontier and fsync'd it, so a
                    // fresh WAL must start with neither a checkpoint_lsn nor a tail
                    // map (else a future recovery would seed a stale tail).
                    if matches!(
                        path.file_name().and_then(|s| s.to_str()),
                        Some(CHECKPOINT_FILE) | Some(TAILS_FILE)
                    ) {
                        std::fs::remove_file(&path)?;
                    }
                }
            }
        }
        // Re-create a fresh, zero-filled active segment at lsn 1 and reset the
        // in-memory cursor to match (open already set lsn 1 / pos 0, but the active
        // FileSegment handle still points at the now-unlinked old inode).
        let seg_start_lsn = 1;
        let active = Arc::new(FileSegment::create(
            seg_path(&self.dir, seg_start_lsn),
            self.segment_size,
        )?);
        let mut g = self.inner.lock().unwrap();
        g.active = active;
        g.seg_start_lsn = seg_start_lsn;
        g.write_pos = 0;
        g.sealed_pending.clear();
        g.next_lsn = seg_start_lsn;
        g.written_high = 0;
        g.written_ahead.clear();
        Ok(())
    }

    /// Reserve an lsn + segment range, stage the framed record's bytes off-lock,
    /// mark it written, and wake the committer. Returns the assigned lsn.
    ///
    /// The encode + `write_at` happen **after** releasing the assign lock, so
    /// concurrent appenders write disjoint reserved ranges without serializing
    /// on the lock (spec §5/§6). The committer is notified on every stage.
    ///
    /// # Errors
    ///
    /// A failed segment `write_at` returns the `io::Error` (the lsn was reserved
    /// but never marked written, so it stays a permanent gap that blocks the
    /// contiguous-written watermark — `durable_lsn` never advances past it). The
    /// caller MUST fail the ack rather than treat the record as durable. We do
    /// NOT panic the process on a transient write error — matching the
    /// committer's fail-loud-don't-ack discipline.
    pub fn reserve_and_stage(
        &self,
        kind: RecordKind,
        stream_id: u64,
        stream_offset: u64,
        payload: &[u8],
    ) -> io::Result<u64> {
        // Test-only ordering seam (CQ-1): fires before any lsn is reserved, i.e.
        // before this record can ever become durable. A test uses it to assert the
        // stream was already registered dirty by the caller (register-before-stage).
        #[cfg(test)]
        {
            if let Some(cb) = self.on_stage.lock().unwrap().as_ref() {
                cb(stream_id);
            }
        }

        // Framed length = fixed header + payload; we reserve exactly this range.
        let total = (super::codec::HEADER_LEN + payload.len()) as u64;

        // A single record can never exceed a whole segment — it would overflow the
        // `fallocate`'d region no matter how we roll. Reject it rather than corrupt
        // the log. (The bench payloads are far smaller than `segment_size`.)
        if total > self.segment_size {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "WAL record framed size {total} exceeds segment_size {} — cannot fit in a segment",
                    self.segment_size
                ),
            ));
        }

        // --- Phase 1: (maybe roll, then) reserve under the short lock. ---
        let (lsn, off, seg) = {
            // Time the contended `inner` acquisition (--wal-stats only). This is
            // the headline per-shard write-serialization signal: every stream on
            // this shard funnels through this one lock.
            let mut g = super::telemetry::timed_lock(
                |ns| self.stats.record_inner_lock_wait(ns),
                || self.inner.lock().unwrap(),
            );

            // Segment roll (spec §4): if this record would overflow the active
            // segment's `fallocate`'d region, SEAL the current segment (truncate to
            // its exact `write_pos` so it is EXACTLY packed — no zero tail — and
            // fsync so the size+data are durable) and OPEN a fresh full-size segment
            // at the next lsn BEFORE reserving. The seal's synchronous fsync makes
            // the truncated size crash-durable, but because phase-2 `write_at` runs
            // off-lock a record reserved in the old segment can land its bytes AFTER
            // the seal fsync — so the seal fsync does NOT cover it. Durability for
            // those records is carried by the `sealed_pending` re-fsync the committer
            // performs (see `sealed_pending` field docs and `collect_fsync_targets`).
            if g.write_pos + total > self.segment_size {
                // Seal the current active segment to its packed size + fsync (so the
                // truncated size is itself crash-durable → recovery walks the exact
                // packed seam). The committer additionally fsyncs this sealed
                // segment via `sealed_pending` to cover any record still being
                // written into it off-lock (see `sealed_pending` docs).
                g.active.seal_to(g.write_pos)?;
                let next_lsn = g.next_lsn;
                // The highest lsn already reserved in the old segment is
                // `next_lsn - 1` (the rolling record itself, `next_lsn`, lands in
                // the NEW segment). Track the sealed segment until durable_lsn
                // passes that end lsn.
                let sealed = Arc::clone(&g.active);
                g.sealed_pending.push((next_lsn - 1, sealed));
                // Open a fresh full-size segment named for the rolling record's lsn.
                let new_seg = Arc::new(FileSegment::create(
                    seg_path(&self.dir, next_lsn),
                    self.segment_size,
                )?);
                g.active = new_seg;
                g.seg_start_lsn = next_lsn;
                g.write_pos = 0;
            }

            let lsn = g.next_lsn;
            g.next_lsn += 1;
            let off = g.write_pos;
            g.write_pos += total;
            // Clone the segment handle so the write runs off-lock; concurrent
            // appenders write disjoint, just-reserved ranges with no lock held.
            let seg = Arc::clone(&g.active);
            (lsn, off, seg)
        };

        // --- Phase 2: encode and write the framed record inline (off-lock). ---
        let mut buf = Vec::with_capacity(total as usize);
        encode_into(
            &mut buf,
            &Record { lsn, kind, stream_id, stream_offset, payload },
        );

        // Test-only fault injection: simulate a write_at failure.
        #[cfg(test)]
        if self.fail_next_write.swap(false, std::sync::atomic::Ordering::SeqCst) {
            return Err(io::Error::other("injected WAL segment write_at failure"));
        }

        seg.write_at(off, &buf)?;
        {
            let mut g = super::telemetry::timed_lock(
                |ns| self.stats.record_inner_lock_wait(ns),
                || self.inner.lock().unwrap(),
            );
            g.mark_written(lsn);
        }
        self.stats.record_staged();
        // Wake the dedicated committer thread. `work_pending` is set under the
        // signal mutex (after `mark_written` above), so this can never be lost
        // against the committer's park (see `CommitSignal` docs).
        self.commit_signal.signal_work();
        Ok(lsn)
    }

    /// Register a touched stream's `Arc<StreamState>` into this shard's dirty set
    /// (spec §7). Called from the append path (`maybe_sync_on_ack`) BEFORE staging
    /// the WAL record (register-before-stage, CQ-1), since that is where the
    /// stream's `Arc<StreamState>` is in hand.
    ///
    /// **Lock-free hot path (Tier-1a).** Dedup is by epoch, not by a per-append
    /// map insert under the shard's `dirty` lock:
    ///
    /// - **Hot path (already dirty this interval):** one relaxed load of the shard
    ///   epoch + one relaxed load of the stream's `dirty_epoch`; if equal, return
    ///   immediately. No lock, no push, no clock read, no allocation — this is the
    ///   per-append common case (a stream is appended to many times between two
    ///   ~3 s checkpoints).
    /// - **Transition (first touch this interval):** CAS the stream's `dirty_epoch`
    ///   to the current shard epoch. The unique winner of the 0/stale→epoch
    ///   transition pushes the `Arc<StreamState>` into the shard's `dirty` Vec.
    ///   Because that happens at most once per stream per checkpoint interval, the
    ///   Vec's `Mutex` is off the hot path — taken only on the transition.
    ///
    /// The contention stat (`record_dirty_lock_wait`) is still wired, but only
    /// around the rare transition lock, so `dirty_wait_load` collapses toward ~0
    /// (the hot path records nothing). `reserve_and_stage` stays ignorant of
    /// `StreamState`; the `StreamState` is needed solely by `checkpoint`.
    pub fn register_dirty(&self, _stream_id: u64, st: Arc<StreamState>) {
        let epoch = self.dirty_epoch.load(Ordering::Relaxed);
        // Hot path: already registered for the current checkpoint interval. Pure
        // relaxed loads + a branch — never touches the `dirty` lock.
        if st.dirty_epoch.load(Ordering::Relaxed) == epoch {
            return;
        }
        // Transition: claim this stream for the current epoch. Only the thread that
        // wins the CAS (0/stale → epoch) pushes; a concurrent racer that lost (or
        // already advanced the stream to `epoch`) does nothing. AcqRel so the push
        // below is ordered after the claim is published. `compare_exchange` (not
        // `_weak`) — we must not spuriously fail and double-push.
        let cur = st.dirty_epoch.load(Ordering::Relaxed);
        if cur == epoch {
            return;
        }
        if st
            .dirty_epoch
            .compare_exchange(cur, epoch, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
        {
            // Off-hot-path: time the (now rare) dirty-set lock so `dirty_wait_load`
            // still reports the residual transition-only contention (≈0).
            let mut g = super::telemetry::timed_lock(
                |ns| self.stats.record_dirty_lock_wait(ns),
                || self.dirty.lock().unwrap(),
            );
            g.push(st);
        }
    }

    /// **Checkpoint** (spec §7), per shard, non-blocking w.r.t. acks:
    ///
    /// 1. Snapshot `checkpoint_lsn` = the committer's current `durable_lsn` (every
    ///    record ≤ it is on disk in the WAL and acked).
    /// 2. **Drain** the dirty set and `fdatasync` each touched per-stream file —
    ///    this makes those streams' page-cache bytes durable in their own files.
    /// 3. Persist `checkpoint_lsn` to `<shard_dir>/checkpoint`.
    /// 4. **Recycle**: unlink every WAL segment whose *entire* lsn range is below
    ///    `checkpoint_lsn` — never the active segment.
    ///
    /// **Hard ordering (the whole point):** step 2 (`fdatasync` the per-stream
    /// files) happens *strictly before* step 4 (recycle the WAL). Until a
    /// stream's bytes are fsync'd into its own file, the WAL is the only durable
    /// copy, so the WAL segment carrying them must not be unlinked first.
    ///
    /// **Non-blocking:** acks gate on the committer's `durable_lsn` (`wait_durable`),
    /// never on this method. A stalled/slow/never-run checkpoint only delays WAL
    /// recycling (the WAL grows on disk) — it cannot block `reserve_and_stage` or
    /// `wait_durable`. The dirty set is drained atomically so a concurrent append
    /// re-registering a stream is never lost (it lands in the *next* checkpoint).
    ///
    /// Returns the `checkpoint_lsn` persisted.
    pub async fn checkpoint(self: &Arc<Self>) -> io::Result<u64> {
        // 1. Snapshot the recycle floor = the highest durably-acked lsn.
        let checkpoint_lsn = self.durable_lsn.load(Ordering::Acquire);

        // 2. Drain the dirty set atomically, then fdatasync each touched file.
        //    Draining first means a concurrent append re-registers into a fresh
        //    map for the next checkpoint — no touched stream is silently dropped.
        //    For each touched stream we capture its current logical `Shared.tail`
        //    (the durable end the upcoming fdatasync will make durable on disk)
        //    and its live `Shared.file` (the handle to fsync). The tail is read
        //    BEFORE the fsync; the fdatasync flushes every page already in the
        //    file's cache, so the file is durable up to AT LEAST this tail
        //    afterwards (a later concurrent append only extends past it and lands
        //    in the next checkpoint). Recording this tail is conservative-safe.
        //    LOAD-BEARING ORDERING (Tier-1a): bump the checkpoint epoch and drain
        //    the dirty Vec in the SAME `dirty`-lock critical section that
        //    `register_dirty`'s push also takes. This serialization is what makes
        //    the lock-free hot path safe: a stream registered for the OLD epoch is
        //    in the Vec we take (and keeps its old `dirty_epoch`, so its next append
        //    re-registers into the new interval); a stream whose `register_dirty`
        //    observes the bumped epoch necessarily pushes AFTER we release this
        //    lock, landing in the fresh post-take Vec for the next checkpoint. So no
        //    touched stream is ever both drained here AND silently skipped next time.
        //    The critical section is O(1) — take the Vec and bump the epoch, nothing
        //    else. The per-stream tail/file capture below runs AFTER the lock is
        //    released: at high stream cardinality nearly every append is its
        //    stream's first touch of the interval (the transition path), so any
        //    O(touched) work under this lock stalls every appender on the shard
        //    for the whole drain (measured 25–140 ms per tick at 400k streams).
        let drained: Vec<Arc<StreamState>> = {
            let mut g = self.dirty.lock().unwrap();
            self.dirty_epoch.fetch_add(1, Ordering::AcqRel);
            std::mem::take(&mut *g)
        };

        // Everything below is file IO + O(touched)/O(total-streams) CPU — run it
        // in ONE blocking task so none of it ever stalls an async worker thread
        // (at 400k streams the capture+fsync+tails phases are tens of ms per tick
        // each; on a real disk the fsync fan-out can be far worse). Ordering
        // inside the closure is exactly the required hard ordering: capture tails
        // → fdatasync per-stream files → persist tails map → persist
        // checkpoint_lsn → recycle. Acks never gate on any of this.
        let this = Arc::clone(self);
        tokio::task::spawn_blocking(move || -> io::Result<u64> {
            // Phase timing for the `WAL_CKPT` line (`--wal-stats`). One clock
            // read per phase, once per ~3 s per shard — nowhere near the hot path.
            let t_start = std::time::Instant::now();
            // Capture each touched stream's current logical tail and live file.
            // The tail is read BEFORE the fsync; the fdatasync flushes every page
            // already in the file's cache, so the file is durable up to AT LEAST
            // this tail afterwards (a later concurrent append only extends past
            // it and lands in the next checkpoint). Conservative-safe.
            let touched: Vec<(u64, u64, Arc<std::fs::File>)> = drained
                .iter()
                .map(|st| {
                    let s = st.shared.read().unwrap();
                    (st.id, s.tail, Arc::clone(&s.file))
                })
                .collect();
            let n_touched = touched.len();
            let t_capture = t_start.elapsed();

            // 2. fdatasync each touched per-stream file. Fan out across a bounded
            //    pool of OS threads (H4): the device's queue depth absorbs the
            //    syncs concurrently instead of paying latency × N_touched serially
            //    — the checkpoint's dominant cost at high cardinality. ALL syncs
            //    complete here, before persist_durable_tails/recycle below, so the
            //    durability-before-recycle ordering is unchanged. `fanout == 1`
            //    (or a single file) keeps the plain serial loop.
            let fanout = fsync_fanout().min(n_touched.max(1));
            if fanout <= 1 {
                for (_, _, f) in &touched {
                    crate::store::barrier_fsync(f)?;
                }
            } else {
                let next = AtomicU64::new(0);
                let first_err: Mutex<Option<io::Error>> = Mutex::new(None);
                std::thread::scope(|scope| {
                    for _ in 0..fanout {
                        scope.spawn(|| loop {
                            let i = next.fetch_add(1, Ordering::Relaxed) as usize;
                            let Some((_, _, f)) = touched.get(i) else { break };
                            if let Err(e) = crate::store::barrier_fsync(f) {
                                let mut slot = first_err.lock().unwrap();
                                if slot.is_none() {
                                    *slot = Some(e);
                                }
                            }
                        });
                    }
                });
                if let Some(e) = first_err.into_inner().unwrap() {
                    return Err(e);
                }
            }
            let t_fsync = t_start.elapsed();

            // 3a. Persist the CUMULATIVE per-stream durable-tail map (task 11b)
            //     AFTER the per-stream files are fsync'd, and BEFORE recycle —
            //     same hard ordering as `checkpoint_lsn`. Merge this checkpoint's
            //     touched tails into the resident map so a stream touched in an
            //     earlier checkpoint (but not this one) keeps its last durable
            //     tail. `tmp` + rename + fsync makes the map itself crash-durable,
            //     so when recycle deletes the WAL records below the floor,
            //     recovery can still truncate a recycled stream's torn
            //     per-stream-file tail to its durable tail.
            let tails: Vec<(u64, u64)> =
                touched.iter().map(|(id, tail, _)| (*id, *tail)).collect();
            let n_tails = this.persist_durable_tails(&tails)?;
            let t_tails = t_start.elapsed();

            // 3b. Persist checkpoint_lsn (durably) AFTER the per-stream files are
            //     fsync'd, so the recorded floor only ever covers bytes already on
            //     disk in their own files.
            let ckpt_path = this.dir.join(CHECKPOINT_FILE);
            let tmp = this.dir.join(format!("{CHECKPOINT_FILE}.tmp"));
            std::fs::write(&tmp, checkpoint_lsn.to_string())?;
            std::fs::rename(&tmp, &ckpt_path)?;

            // 4. Recycle: unlink WAL segments fully below checkpoint_lsn. This is
            //    the LAST step — strictly after the per-stream fsyncs AND the
            //    durable-tail map persist above.
            this.recycle_below(checkpoint_lsn)?;
            let t_rest = t_start.elapsed();

            // 5. Flush the meta sidecar of every touched stream whose append
            //    path marked it dirty (WAL mode defers the per-append debounced
            //    flush to here — see handle_append_inner). Strictly AFTER the
            //    WAL-critical sequence above: sidecar producer/access state is
            //    non-durable by contract and plays no part in WAL replay, so it
            //    must never delay the recycle floor. Errors are ignored exactly
            //    like the debounced flush ignored them.
            let mut n_meta = 0u64;
            for st in &drained {
                if st.meta_dirty.swap(false, Ordering::AcqRel) {
                    let _ = crate::store::write_meta_sync(st, false);
                    n_meta += 1;
                }
            }

            if super::telemetry::stats_enabled() {
                let t_total = t_start.elapsed();
                eprintln!(
                    "WAL_CKPT shard={} touched={} tails_entries={} meta={} capture_us={} fsync_us={} tails_us={} rest_us={} meta_us={} total_us={}",
                    this.dir.file_name().and_then(|s| s.to_str()).unwrap_or("?"),
                    n_touched,
                    n_tails,
                    n_meta,
                    t_capture.as_micros(),
                    (t_fsync - t_capture).as_micros(),
                    (t_tails - t_fsync).as_micros(),
                    (t_rest - t_tails).as_micros(),
                    (t_total - t_rest).as_micros(),
                    t_total.as_micros(),
                );
            }

            Ok(checkpoint_lsn)
        })
        .await
        .expect("checkpoint task panicked")
    }

    /// Merge `touched` `(stream_id, durable_tail)` pairs into the persisted
    /// CUMULATIVE per-shard durable-tail map (`<shard_dir>/tails`) and rewrite it
    /// durably (`tmp` + rename + fsync the dir-synced file). Called from
    /// `checkpoint` AFTER the touched per-stream files are fdatasync'd and BEFORE
    /// the WAL is recycled, so a torn per-stream-file tail can always be truncated
    /// to its durable tail even after its WAL records are gone (task 11b).
    ///
    /// Cumulative-merge: merge into the RESIDENT map (`tails_cache`, seeded from
    /// disk once on first use), overwrite each touched stream's entry with its
    /// newest durable tail (`max`, so a re-checkpointed earlier tail can never
    /// regress the recorded value), keep every untouched stream's last recorded
    /// tail. Serializing from memory avoids re-reading + re-parsing the whole
    /// file every checkpoint (O(total streams per shard) each ~3 s).
    /// Returns the number of entries in the persisted map (for `WAL_CKPT`).
    fn persist_durable_tails(&self, touched: &[(u64, u64)]) -> io::Result<usize> {
        if touched.is_empty() && !self.dir.join(TAILS_FILE).exists() {
            // Nothing touched and no prior map: nothing to persist.
            return Ok(0);
        }
        let mut cache = self.tails_cache.lock().unwrap();
        let map = cache.get_or_insert_with(|| Self::read_durable_tails_at(&self.dir));
        for &(id, tail) in touched {
            let slot = map.entry(id).or_insert(0);
            *slot = (*slot).max(tail);
        }
        // Serialize as `stream_id durable_tail` lines (sorted for a deterministic,
        // diff-friendly file). Plain decimal text, matching the `checkpoint` file.
        let mut entries: Vec<(u64, u64)> = map.iter().map(|(&k, &v)| (k, v)).collect();
        entries.sort_unstable();
        let n = entries.len();
        let mut body = String::with_capacity(entries.len() * 16);
        {
            use std::fmt::Write as _;
            for (id, tail) in entries {
                let _ = writeln!(body, "{id} {tail}");
            }
        }
        // The resident map is fully merged and serialized; release it before the
        // file IO below (nothing else contends today, but don't hold a lock over
        // a write+fsync+rename gratuitously).
        drop(cache);
        let path = self.dir.join(TAILS_FILE);
        let tmp = self.dir.join(format!("{TAILS_FILE}.tmp"));
        std::fs::write(&tmp, &body)?;
        // fsync the tmp file's bytes before the rename so the durable-tail map is
        // crash-durable BEFORE recycle (the whole point of 11b).
        std::fs::File::open(&tmp)?.sync_all()?;
        std::fs::rename(&tmp, &path)?;
        Ok(n)
    }

    /// Read the persisted per-shard durable-tail map from `<dir>/tails`. Returns
    /// an empty map when the file is absent (no checkpoint recorded tails yet).
    /// Malformed lines are skipped (defensive; the file is only written by
    /// `persist_durable_tails`).
    fn read_durable_tails_at(dir: &Path) -> HashMap<u64, u64> {
        let mut map = HashMap::new();
        if let Ok(s) = std::fs::read_to_string(dir.join(TAILS_FILE)) {
            for line in s.lines() {
                let mut it = line.split_whitespace();
                if let (Some(a), Some(b)) = (it.next(), it.next()) {
                    if let (Ok(id), Ok(tail)) = (a.parse::<u64>(), b.parse::<u64>()) {
                        map.insert(id, tail);
                    }
                }
            }
        }
        map
    }

    /// Public reader for recovery: the persisted per-stream durable-tail map for
    /// this shard (task 11b). Empty when no checkpoint has recorded tails. Recovery
    /// seeds each stream's frontier from this map so a stream whose WAL records were
    /// all recycled still has its torn per-stream-file tail truncated.
    pub fn read_durable_tails(&self) -> HashMap<u64, u64> {
        Self::read_durable_tails_at(&self.dir)
    }

    /// Unlink every WAL segment file whose entire lsn range is `< floor`, never
    /// the active segment. A segment named `<start>.wal` is fully below `floor`
    /// iff the *next* segment's start lsn ≤ `floor` (i.e. all of this segment's
    /// records have lsn < that next start ≤ `floor`). The active segment (the one
    /// new records are still appended into) is always retained.
    fn recycle_below(&self, floor: u64) -> io::Result<()> {
        let active_start = self.inner.lock().unwrap().seg_start_lsn;

        // Collect (start_lsn, path) of every on-disk segment.
        let mut segs: Vec<(u64, PathBuf)> = Vec::new();
        for entry in std::fs::read_dir(&self.dir)? {
            let entry = entry?;
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            let Some(stem) = name.strip_suffix(".wal") else {
                continue;
            };
            if let Ok(start) = stem.parse::<u64>() {
                segs.push((start, path));
            }
        }
        segs.sort_by_key(|(s, _)| *s);

        // A segment is fully below `floor` iff the next segment's start ≤ floor.
        for i in 0..segs.len() {
            let (start, ref path) = segs[i];
            // Never recycle the active segment.
            if start == active_start {
                continue;
            }
            let next_start = segs.get(i + 1).map(|(s, _)| *s);
            let fully_below = match next_start {
                Some(ns) => ns <= floor,
                // No following segment on disk: its range extends to the live
                // tail, so it is not fully below the floor — keep it.
                None => false,
            };
            if fully_below {
                // Asymmetry note (CQ-3): the checkpoint floor was already
                // persisted (step 3) before we reach here. Propagating a failed
                // unlink via `?` therefore leaves a persisted floor with a
                // not-yet-recycled segment. That is SAFE — over-retention, never
                // data loss (the segment's bytes are already fdatasync'd into the
                // per-stream files), and the next checkpoint retries the unlink.
                std::fs::remove_file(path)?;
            }
        }
        Ok(())
    }

    /// This shard's directory (`<data-dir>/wal/<i>/`).
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Read the persisted `checkpoint_lsn` (`<shard_dir>/checkpoint`, plain
    /// decimal text). Returns `0` when the file is absent (no checkpoint yet) or
    /// unparsable — `0` means "replay from the very first segment", which is the
    /// safe default (re-applying already-checkpointed records is idempotent, and
    /// the frontier skip in recovery guards the compacted prefix).
    pub fn read_checkpoint_lsn(&self) -> u64 {
        match std::fs::read_to_string(self.dir.join(CHECKPOINT_FILE)) {
            Ok(s) => s.trim().parse::<u64>().unwrap_or(0),
            Err(_) => 0,
        }
    }

    /// Walk this shard's on-disk WAL segments in **lsn order** from
    /// `checkpoint_lsn` and invoke `f` for every complete record, stopping at the
    /// **first** `Torn`/`Incomplete` record (that ends the durable log — the
    /// un-acked tail is discarded; spec §9). Records whose lsn `< checkpoint_lsn`
    /// are skipped (already checkpoint-fsynced into the per-stream files).
    ///
    /// `f` receives `(kind, stream_id, stream_offset, payload)`. This keeps the
    /// segment ordering / decode loop here (where `seg_path` and the segment
    /// naming live) while leaving the file_base mapping + tail repair to
    /// `recovery.rs`.
    pub fn replay_from_checkpoint<F>(&self, checkpoint_lsn: u64, mut f: F) -> io::Result<()>
    where
        F: FnMut(RecordKind, u64, u64, &[u8]),
    {
        use super::codec::{decode_at, Decoded};

        // Collect (start_lsn, path) of every on-disk segment, sorted by start lsn
        // so we replay in total lsn order across segment boundaries.
        let mut segs: Vec<(u64, PathBuf)> = Vec::new();
        for entry in std::fs::read_dir(&self.dir)? {
            let entry = entry?;
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            let Some(stem) = name.strip_suffix(".wal") else {
                continue;
            };
            if let Ok(start) = stem.parse::<u64>() {
                segs.push((start, path));
            }
        }
        segs.sort_by_key(|(s, _)| *s);

        for (_start, path) in segs {
            let raw = std::fs::read(&path)?;
            let mut off = 0usize;
            // Decode records back-to-back. A segment that is exactly packed (off
            // reaches its decodable end with no torn record) falls through to the
            // next segment in lsn order; the FIRST torn/incomplete record ends the
            // durable log globally (spec §4/§9) — `return` from the whole walk.
            while let Decoded::Record {
                lsn,
                kind,
                stream_id,
                stream_offset,
                payload_off,
                len,
                total,
            } = decode_at(&raw, off)
            {
                // Records below the checkpoint floor are already durably fsync'd
                // into their per-stream files — skip, but keep advancing so we
                // reach the live (post-checkpoint) tail.
                if lsn >= checkpoint_lsn {
                    f(kind, stream_id, stream_offset, &raw[payload_off..payload_off + len]);
                }
                off += total;
                // A perfectly packed segment ends right at its decodable extent;
                // stop scanning this segment and continue with the next one.
                if off >= raw.len() {
                    break;
                }
            }
            // `decode_at` returned non-Record (torn/incomplete) before the end:
            // the durable log ends here. Only a segment consumed exactly to its
            // end (the `break` above) continues to the next segment.
            if off < raw.len() {
                return Ok(());
            }
        }
        Ok(())
    }

    /// Total bytes of this shard's on-disk WAL segments (the recyclable-growth
    /// signal: with checkpoint stalled, this grows as appends accumulate).
    ///
    /// Telemetry/test-only surface: consumed by the `telemetry`-feature emitter
    /// (`telemetry::spawn_emitter`) and the WAL e2e tests, never on any default
    /// build's hot path — hence the targeted dead-code allow there.
    #[cfg_attr(not(any(feature = "telemetry", test)), allow(dead_code))]
    pub fn wal_size_bytes(&self) -> u64 {
        let mut total = 0u64;
        if let Ok(rd) = std::fs::read_dir(&self.dir) {
            for entry in rd.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("wal") {
                    if let Ok(meta) = entry.metadata() {
                        total += meta.len();
                    }
                }
            }
        }
        total
    }

    /// Number of on-disk WAL segment files for this shard (the `segments` gauge,
    /// spec §11). Like [`Shard::wal_size_bytes`] this `read_dir`s the shard dir,
    /// so it is called **only from the 1 Hz emitter**, never the commit path
    /// (CQ-2). A growing `segments` with a flat `checkpoint_lsn` ⇒ checkpoint is
    /// not keeping up. Telemetry/test-only (see [`Shard::wal_size_bytes`]).
    #[cfg_attr(not(any(feature = "telemetry", test)), allow(dead_code))]
    pub fn wal_segments(&self) -> u64 {
        let mut n = 0u64;
        if let Ok(rd) = std::fs::read_dir(&self.dir) {
            for entry in rd.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("wal") {
                    n += 1;
                }
            }
        }
        n
    }

    /// Snapshot this shard's batch-size + commit counters for the emitter
    /// (off-path; relaxed loads). See [`super::telemetry::StatsSnapshot`].
    /// Telemetry/test-only (see [`Shard::wal_size_bytes`]).
    #[cfg_attr(not(any(feature = "telemetry", test)), allow(dead_code))]
    pub fn stats_snapshot(&self) -> StatsSnapshot {
        self.stats.snapshot()
    }

    /// Current `durable_lsn` — the highest lsn made durable + acked. Cheap (one
    /// atomic load), read by the emitter and by [`Shard::checkpoint`].
    /// Telemetry/test-only as a public accessor (see [`Shard::wal_size_bytes`]).
    #[cfg_attr(not(any(feature = "telemetry", test)), allow(dead_code))]
    pub fn durable_lsn_now(&self) -> u64 {
        self.durable_lsn.load(Ordering::Acquire)
    }

    /// The shard's `tail_lsn` — the highest lsn **assigned** so far (`next_lsn - 1`,
    /// `0` when empty). The gap `tail_lsn - durable_lsn` is the in-flight depth the
    /// committer is draining. Cheap (one short lock).
    /// Telemetry/test-only (see [`Shard::wal_size_bytes`]).
    #[cfg_attr(not(any(feature = "telemetry", test)), allow(dead_code))]
    pub fn tail_lsn(&self) -> u64 {
        self.inner.lock().unwrap().next_lsn.saturating_sub(1)
    }

    /// Await until this shard's `durable_lsn >= lsn`.
    ///
    /// Coalesced wakeup (Tier-1c): instead of subscribing to a broadcast that
    /// every commit wakes, we register a single `oneshot` keyed by `lsn` in the
    /// min-ordered [`WaiterReg`]. [`Shard::publish_durable`] fires only the
    /// waiters whose lsn the new watermark satisfies — so a parked waiter is
    /// woken at most once, exactly when its lsn becomes durable.
    ///
    /// **Cross-thread wakeup (Tier-2a):** `publish_durable` runs on the dedicated
    /// committer OS thread; `oneshot::Sender::send` fires the receiver's waker
    /// from any thread, so an async `wait_durable` future parked on the runtime is
    /// woken across the thread→async boundary with no tokio handle required.
    ///
    /// **Lost-wakeup safety (the register/publish race):** `publish_durable`
    /// stores `durable_lsn` (Release) *before* it locks the heap to drain; we
    /// push our waiter *before* re-loading `durable_lsn` (Acquire). The heap
    /// `Mutex` orders the two heap critical sections, so for any interleaving
    /// either (a) our push precedes the commit's drain — it fires our oneshot —
    /// or (b) the commit's drain precedes our push — but then its `durable_lsn`
    /// store happens-before our re-check load, which sees it and returns. No
    /// commit can land in the gap between the check and the registration and
    /// leave us parked forever.
    pub async fn wait_durable(&self, lsn: u64) {
        // Fast path: already durable — return without touching the registry.
        if self.durable_lsn.load(Ordering::Acquire) >= lsn {
            return;
        }
        let rx = {
            let mut reg = self.waiters.lock().unwrap();
            let (tx, rx) = oneshot::channel();
            let seq = reg.next_seq;
            reg.next_seq = reg.next_seq.wrapping_add(1);
            reg.heap.push(DurableWaiter { lsn, seq, tx });
            rx
        };
        // Re-check AFTER registering to close the race where a commit landed
        // between the fast-path load and the push (see the doc comment). If it is
        // now durable, return; our heap entry's receiver is dropped, so a later
        // drain firing it is a silent no-op.
        if self.durable_lsn.load(Ordering::Acquire) >= lsn {
            return;
        }
        // Park until our oneshot fires. A `RecvError` (sender dropped without
        // firing) only happens at shard teardown — treat as "return", matching
        // the old `watch::changed()`-errored behaviour.
        let _ = rx.await;
    }

    /// Current contiguous-written watermark (`written_high`). Snapshot this
    /// BEFORE submitting an fsync; publish exactly it afterwards.
    pub fn snapshot_watermark(&self) -> u64 {
        self.inner.lock().unwrap().written_high
    }

    /// The segments an fsync batch must cover: the active segment plus every
    /// pending-sealed segment that may still hold an un-durable record.
    pub fn collect_fsync_targets(&self) -> (Arc<FileSegment>, Vec<Arc<FileSegment>>) {
        let g = self.inner.lock().unwrap();
        (
            Arc::clone(&g.active),
            g.sealed_pending.iter().map(|(_, s)| Arc::clone(s)).collect(),
        )
    }

    /// Publish `watermark` as the new `durable_lsn` (no-op if not an advance):
    /// record the batch-size stat and retire fully-durable sealed segments. This
    /// is the committer's Ok-branch; callers MUST pass a watermark snapshotted
    /// BEFORE the covering fsync (never re-snapshot afterwards).
    pub fn publish_durable(&self, watermark: u64) {
        let durable = self.durable_lsn.load(Ordering::Acquire);
        if watermark <= durable {
            return;
        }
        self.stats.record_batch(watermark - durable);
        // Publish the new watermark (Release) BEFORE draining the waiter heap.
        // This ordering is load-bearing for lost-wakeup safety: a `wait_durable`
        // that registers concurrently re-checks `durable_lsn` after pushing, and
        // the heap `Mutex` guarantees it either observes this store or is drained
        // below (see `wait_durable`'s doc comment). Storing the atomic + firing the
        // oneshots below both work from the dedicated committer OS thread (Tier-2a)
        // with no tokio runtime handle.
        self.durable_lsn.store(watermark, Ordering::Release);
        // Coalesced wakeup (Tier-1c): under the short lock, pop ONLY the prefix of
        // waiters whose lsn <= the new watermark and fire their oneshots. The heap
        // is min-ordered by lsn, so the first entry above the watermark stops the
        // drain — every still-parked waiter has a strictly higher lsn. This
        // replaces the `watch` broadcast that woke every parked subscriber (most
        // of which re-checked and immediately re-parked — the thundering herd).
        let mut fired = 0u64;
        {
            let mut reg = self.waiters.lock().unwrap();
            while let Some(top) = reg.heap.peek() {
                if top.lsn > watermark {
                    break;
                }
                let w = reg.heap.pop().expect("peek just confirmed a top entry");
                // `send` fails silently if the receiver was dropped (a cancelled
                // wait_durable — timeout/connection drop); count only live waiters
                // actually woken, so `waiters_woken_avg` reflects real wakeups.
                if w.tx.send(()).is_ok() {
                    fired += 1;
                }
            }
        }
        // Record how many waiters this commit ACTUALLY woke — now just the few
        // satisfied by this watermark, not every parked subscriber. This is the
        // proof of the coalescing: `waiters_woken_avg` collapses toward ~1.
        self.stats.record_waiters_woken(fired);
        let mut g = self.inner.lock().unwrap();
        g.sealed_pending.retain(|(end_lsn, _)| *end_lsn > watermark);
    }

    /// One group-commit attempt: snapshot the contiguous-written watermark,
    /// `fdatasync` the segments that cover it (sealed-pending first, then active),
    /// then publish it as `durable_lsn`. Returns `Ok(Some(watermark))` when an
    /// advance was published, `Ok(None)` when already caught up (nothing to do),
    /// and `Err` when an fsync failed.
    ///
    /// **No-loss / watermark invariants (load-bearing):** the watermark is
    /// snapshotted **before** the covering fsync and published **exactly** (never
    /// re-snapshotted after the fsync — see [`Shard::publish_durable`]). On fsync
    /// error we return `Err` and do **not** publish, so `durable_lsn` never
    /// advances over un-fsync'd bytes (records stay un-acked). `sealed_pending`
    /// segments are fsync'd before `publish_durable` retires them.
    ///
    /// Runs the `fdatasync` **synchronously on the committer's own OS thread** —
    /// no `spawn_blocking` round-trip onto the shared runtime (the Tier-2a win).
    fn commit_once(&self) -> io::Result<Option<u64>> {
        let watermark = self.snapshot_watermark();
        let durable = self.durable_lsn.load(Ordering::Acquire);
        if watermark <= durable {
            return Ok(None);
        }
        let (seg, sealed) = self.collect_fsync_targets();
        for s in &sealed {
            s.fdatasync()?;
        }
        seg.fdatasync()?;
        // Snapshotted-before-fsync watermark, published exactly.
        self.publish_durable(watermark);
        Ok(Some(watermark))
    }

    /// The shard's group-commit committer, run on a **dedicated OS thread** (one
    /// per shard, spawned by [`Shard::spawn_committer`]) — off the shared async
    /// runtime, so committers don't time-share the network/reactor worker threads
    /// and pay no per-commit `spawn_blocking` hop (Tier-2a). It blocks on the
    /// [`CommitSignal`] condvar for staged work, `fdatasync`s synchronously, and
    /// advances/publishes `durable_lsn`. Firing the per-waiter `oneshot`s from
    /// `publish_durable` (driven from this thread) still wakes async
    /// `wait_durable` futures across the thread→async boundary.
    ///
    /// **Lost-wakeup safety:** when caught up we park in `wait_for_work`, which
    /// checks `work_pending` **under the same mutex** a stage sets it under, and
    /// we always re-snapshot the watermark off-lock after waking. A stage racing
    /// the park is therefore never lost (see [`CommitSignal`]).
    ///
    /// **fsync-error path:** on `fdatasync` failure we do **not** advance
    /// `durable_lsn` (no ack) and back off with bounded exponential delay
    /// (interruptible by shutdown), exactly as the no-loss invariant requires.
    ///
    /// **Shutdown:** on a stop signal the loop performs a **final drain**
    /// (commits everything already contiguous-written, so in-flight commits are
    /// not dropped) and then returns so the thread can be joined.
    pub fn run_committer(&self) {
        // Backoff state for the fsync-error path: a persistently failing disk
        // (ENOSPC/EIO/read-only volume) must not busy-spin a core, hammer the disk,
        // and flood stderr. The no-loss invariant holds throughout — `durable_lsn`
        // is never advanced on failure, so nothing is ever acked.
        const RETRY_BACKOFF_MIN: std::time::Duration = std::time::Duration::from_millis(5);
        const RETRY_BACKOFF_MAX: std::time::Duration = std::time::Duration::from_secs(1);
        const LOG_EVERY: u64 = 100;
        let mut backoff = RETRY_BACKOFF_MIN;
        let mut consecutive_errors: u64 = 0;
        loop {
            match self.commit_once() {
                Ok(Some(_)) => {
                    // Advanced — re-snapshot immediately; more may have arrived
                    // while we were fsyncing (group commit naturally batches them).
                    consecutive_errors = 0;
                    backoff = RETRY_BACKOFF_MIN;
                    continue;
                }
                Ok(None) => {
                    // Caught up — reset the error backoff and park for the next
                    // stage (or a stop signal).
                    consecutive_errors = 0;
                    backoff = RETRY_BACKOFF_MIN;
                    if self.commit_signal.wait_for_work() {
                        // Stop requested: drain any records that became
                        // contiguous-written before/at the stop, then exit. We do
                        // NOT retry fsync errors forever here — on error we log and
                        // give up (no-loss holds: durable_lsn is not advanced, so
                        // the un-drained tail simply stays un-acked, exactly as a
                        // crash would leave it).
                        loop {
                            match self.commit_once() {
                                Ok(Some(_)) => continue,
                                Ok(None) => break,
                                Err(e) => {
                                    eprintln!(
                                        "WAL committer final-drain fdatasync failed: {e}"
                                    );
                                    break;
                                }
                            }
                        }
                        return;
                    }
                }
                Err(e) => {
                    // Rate-limited log + bounded exponential backoff. The backoff
                    // parks on the condvar (not a raw sleep) so shutdown can
                    // interrupt it; a stream of concurrent stages cannot turn the
                    // retry into a hot loop (we do not clear `work_pending` here,
                    // so the same un-acked watermark is retried).
                    consecutive_errors += 1;
                    if consecutive_errors == 1 || consecutive_errors % LOG_EVERY == 0 {
                        eprintln!(
                            "WAL committer fdatasync failed (attempt {consecutive_errors}): {e}"
                        );
                    }
                    if self.commit_signal.backoff_wait(backoff) {
                        // Stop requested during backoff: exit without acking the
                        // failing watermark (no-loss preserved).
                        return;
                    }
                    backoff = (backoff * 2).min(RETRY_BACKOFF_MAX);
                }
            }
        }
    }

    /// Spawn this shard's committer on a dedicated OS thread and return a
    /// [`CommitterHandle`] for clean shutdown. The thread holds an `Arc<Shard>`
    /// clone so it stays alive until stopped + joined.
    pub fn spawn_committer(self: &Arc<Self>) -> CommitterHandle {
        let me = Arc::clone(self);
        let join = std::thread::Builder::new()
            .name("wal-committer".to_string())
            .spawn(move || me.run_committer())
            .expect("spawn WAL committer thread");
        CommitterHandle {
            shard: Arc::clone(self),
            join: Some(join),
        }
    }

    /// Test-only: current `durable_lsn`.
    #[cfg(test)]
    pub fn durable_lsn(&self) -> u64 {
        self.durable_lsn.load(Ordering::Acquire)
    }

    /// Test-only: number of currently-parked durability waiters in the registry.
    /// Lets the coalesced-wakeup tests assert that the fast path registers no
    /// waiter and that a commit drains exactly the satisfied prefix.
    #[cfg(test)]
    pub fn waiter_count(&self) -> usize {
        self.waiters.lock().unwrap().heap.len()
    }

    /// Test-only: whether `stream_id` is currently in the dirty set (i.e. its
    /// `Arc<StreamState>` is present in the shard's pending dirty collection). Used
    /// to prove the append path registers a stream BEFORE its lsn can become
    /// durable (the checkpoint recycle-before-fsync ordering invariant, spec §7).
    /// Updated for the Tier-1a representation: a scan of the dirty `Vec` (a stream
    /// is pushed at most once per checkpoint interval), not a `HashMap` lookup.
    #[cfg(test)]
    pub fn is_dirty(&self, stream_id: u64) -> bool {
        self.dirty
            .lock()
            .unwrap()
            .iter()
            .any(|st| st.id == stream_id)
    }

    /// Test-only: number of entries currently in the dirty collection. Because the
    /// Tier-1a epoch CAS pushes each stream at most once per checkpoint interval,
    /// this counts distinct touched streams (modulo a rare drain-race duplicate) —
    /// used to prove the already-dirty hot path does NOT re-push.
    #[cfg(test)]
    pub fn dirty_len(&self) -> usize {
        self.dirty.lock().unwrap().len()
    }

    /// Test-only: the shard's current checkpoint epoch (Tier-1a).
    #[cfg(test)]
    pub fn dirty_epoch_now(&self) -> u64 {
        self.dirty_epoch.load(Ordering::Relaxed)
    }

    /// Test-only: arm the next `reserve_and_stage` to simulate a `write_at`
    /// failure (see `fail_next_write`).
    #[cfg(test)]
    pub fn fail_next_write(&self) {
        self.fail_next_write
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    /// Test-only: install the `reserve_and_stage` ordering seam (see `on_stage`).
    #[cfg(test)]
    pub fn set_on_stage_hook(&self, cb: Box<dyn Fn(u64) + Send + Sync>) {
        *self.on_stage.lock().unwrap() = Some(cb);
    }

    /// Test-only: assign the next lsn + reserve its segment range, but write **no
    /// bytes** — deliberately leaving a gap so the watermark/gap test can prove
    /// the committer will not advance `durable_lsn` past an unwritten lsn.
    #[cfg(test)]
    pub fn reserve_only(&self) -> u64 {
        let mut g = self.inner.lock().unwrap();
        let lsn = g.next_lsn;
        g.next_lsn += 1;
        // Reserve a plausible range so a later real record lands after it; the
        // exact size is irrelevant since nothing reads the gap's bytes.
        g.write_pos += super::codec::HEADER_LEN as u64;
        lsn
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wal::codec::{decode_at, Decoded};
    use std::path::PathBuf;

    fn tmp(tag: &str) -> PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let p = std::env::temp_dir().join(format!(
            "ds-wal-shard-test-{tag}-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    /// Minimal stream config for the checkpoint dirty-set test.
    fn ckpt_test_cfg() -> crate::store::StreamConfig {
        crate::store::StreamConfig {
            content_type: "application/octet-stream".into(),
            ttl_seconds: None,
            expires_at: None,
            expires_at_raw: None,
            create_closed: false,
            forked_from: None,
            fork_offset_raw: None,
            fork_sub_offset: None,
        }
    }

    /// Collect every on-disk segment's `(start_lsn, path)` sorted by start lsn.
    fn segs_on_disk(dir: &Path) -> Vec<(u64, PathBuf)> {
        let mut v: Vec<(u64, PathBuf)> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .filter_map(|e| {
                let path = e.path();
                let name = path.file_name()?.to_str()?.to_string();
                let stem = name.strip_suffix(".wal")?;
                let start = stem.parse::<u64>().ok()?;
                Some((start, path))
            })
            .collect();
        v.sort_by_key(|(s, _)| *s);
        v
    }

    #[tokio::test]
    async fn appends_roll_to_multiple_segments() {
        // With a tiny segment_size, appending enough records must SEAL the current
        // segment and OPEN a fresh one — spanning ≥3 segments. Each sealed segment
        // is truncated to its exact write_pos (EXACTLY packed, no fallocate tail).
        const SEG: u64 = 4096;
        let dir = tmp("roll-multi");
        let sh = Shard::open_with_segment_size(dir.clone(), SEG).unwrap();
        let h = sh.spawn_committer();

        // ~200-byte records → ~20 per 4 KiB segment; 80 records ⇒ ≥3 segments.
        let payload = vec![b'x'; 200 - crate::wal::codec::HEADER_LEN];
        let mut last = 0;
        for i in 0..80u64 {
            last = sh.reserve_and_stage(RecordKind::Append, 1, i * 200, &payload).unwrap();
        }
        sh.wait_durable(last).await;
        h.stop();

        let segs = segs_on_disk(&dir);
        assert!(segs.len() >= 3, "rolled to ≥3 segments, got {}", segs.len());
        // Every SEALED (non-active) segment must be exactly packed (set_len to
        // write_pos): its size ≤ SEG and the next segment's first record decodes,
        // and there is NO fallocate zero gap at the seam (recovery's off==len → next).
        let active_start = segs.last().unwrap().0;
        for (start, path) in &segs {
            let meta = std::fs::metadata(path).unwrap().len();
            if *start == active_start {
                assert_eq!(meta, SEG, "active segment stays fallocate'd to full size");
            } else {
                assert!(meta <= SEG, "sealed segment truncated to its packed size");
                // Exactly packed: walking it consumes exactly to raw.len().
                let raw = std::fs::read(path).unwrap();
                let mut off = 0usize;
                while let Decoded::Record { total, .. } = decode_at(&raw, off) {
                    off += total;
                    if off >= raw.len() {
                        break;
                    }
                }
                assert_eq!(off, raw.len(), "sealed segment is EXACTLY packed (no zero tail)");
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn records_span_segments_and_are_all_durable() {
        // Every record across multiple rolled segments becomes durable (the
        // committer advances durable_lsn through sealed + active segments).
        const SEG: u64 = 4096;
        let dir = tmp("roll-durable");
        let sh = Shard::open_with_segment_size(dir.clone(), SEG).unwrap();
        let h = sh.spawn_committer();
        let payload = vec![b'y'; 150];
        let mut last = 0;
        for i in 0..100u64 {
            last = sh.reserve_and_stage(RecordKind::Append, 2, i, &payload).unwrap();
        }
        sh.wait_durable(last).await;
        assert_eq!(sh.durable_lsn(), last, "every record across rolls is durable");
        assert!(segs_on_disk(&dir).len() >= 3, "spanned ≥3 segments");
        h.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn recovery_replays_every_record_across_rolls() {
        // Replay across rolled segments (sealed exactly-packed + active w/ zero
        // tail) must reconstruct EVERY record, byte-identical, in lsn order.
        const SEG: u64 = 4096;
        let dir = tmp("roll-replay");
        let sh = Shard::open_with_segment_size(dir.clone(), SEG).unwrap();
        let h = sh.spawn_committer();
        let mut expect: Vec<(u64, u64, Vec<u8>)> = Vec::new();
        let mut last = 0;
        for i in 0..120u64 {
            // ~150-byte framed records ⇒ ~27 per 4 KiB segment ⇒ 120 ⇒ ≥4 segments.
            let p = format!("rec-{i:04}-{}", "p".repeat(120)).into_bytes();
            last = sh.reserve_and_stage(RecordKind::Append, 3, i * 7, &p).unwrap();
            expect.push((last, i * 7, p));
        }
        sh.wait_durable(last).await;
        h.stop();
        assert!(segs_on_disk(&dir).len() >= 3, "spanned ≥3 segments");

        // Replay in lsn order across segments; collect every record.
        let mut got: Vec<(u64, Vec<u8>)> = Vec::new();
        sh.replay_from_checkpoint(0, |kind, stream_id, stream_offset, payload| {
            assert_eq!(kind, RecordKind::Append);
            assert_eq!(stream_id, 3);
            got.push((stream_offset, payload.to_vec()));
        })
        .unwrap();
        assert_eq!(got.len(), expect.len(), "every record replayed across rolls");
        for (i, (off, p)) in got.iter().enumerate() {
            assert_eq!(*off, expect[i].1, "record {i} stream_offset");
            assert_eq!(p, &expect[i].2, "record {i} payload byte-identical");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn recycle_frees_sealed_segment_below_checkpoint_keeps_active() {
        // With rolls firing, recycle must delete a sealed segment fully below the
        // checkpoint floor while keeping the active segment.
        const SEG: u64 = 4096;
        let dir = tmp("roll-recycle");
        let sh = Shard::open_with_segment_size(dir.clone(), SEG).unwrap();
        let h = sh.spawn_committer();
        let payload = vec![b'z'; 180];
        let mut last = 0;
        for i in 0..120u64 {
            last = sh.reserve_and_stage(RecordKind::Append, 4, i, &payload).unwrap();
        }
        sh.wait_durable(last).await;

        let before = segs_on_disk(&dir);
        assert!(before.len() >= 3, "rolled to ≥3 segments before recycle");
        let active_start = before.last().unwrap().0;

        // Checkpoint floor = durable_lsn = last lsn ⇒ every sealed segment is fully
        // below it; recycle must delete them all and keep ONLY the active segment.
        let ckpt = sh.checkpoint().await.unwrap();
        assert_eq!(ckpt, last);

        let after = segs_on_disk(&dir);
        assert_eq!(after.len(), 1, "all sealed segments recycled below the floor");
        assert_eq!(after[0].0, active_start, "the active segment is retained");
        assert!(seg_path(&dir, active_start).exists(), "active segment file remains");
        h.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn roll_boundary_exact_fill_vs_overflow() {
        // A record that EXACTLY fills the remaining segment space does NOT roll
        // (it fits); the NEXT record then rolls. A record that would overflow rolls
        // BEFORE being written. Both land whole and decode.
        let dir = tmp("roll-boundary");
        // Choose a segment size that's an exact multiple of one framed record so a
        // record can exactly fill it. Framed size = HEADER_LEN + payload.
        let payload = vec![b'q'; 26]; // total = HEADER_LEN(38) + 26 = 64
        let total = (crate::wal::codec::HEADER_LEN + payload.len()) as u64;
        assert_eq!(total, 64);
        const SEG: u64 = 128; // exactly 2 records per segment
        let sh = Shard::open_with_segment_size(dir.clone(), SEG).unwrap();
        let h = sh.spawn_committer();
        // 5 records: r1,r2 fill seg0 exactly (write_pos 64 then 128 == SEG, no roll
        // on r2 since 64+64==128 is NOT > 128). r3 rolls (128+64 > 128). r4 fills
        // the new seg. r5 rolls again.
        let mut last = 0;
        for i in 0..5u64 {
            last = sh.reserve_and_stage(RecordKind::Append, 5, i, &payload).unwrap();
        }
        sh.wait_durable(last).await;
        h.stop();

        let segs = segs_on_disk(&dir);
        assert_eq!(segs.len(), 3, "r1r2 | r3r4 | r5 ⇒ 3 segments");
        // seg0 sealed at exactly 128 (2 records, exact fill — no premature roll).
        assert_eq!(std::fs::metadata(&segs[0].1).unwrap().len(), 128, "exact-fill seg packed at 128");
        assert_eq!(std::fs::metadata(&segs[1].1).unwrap().len(), 128, "second sealed seg packed at 128");

        // Replay reconstructs all 5 records.
        let mut got = 0usize;
        sh.replay_from_checkpoint(0, |_, _, off, payload| {
            assert_eq!(off, got as u64);
            assert_eq!(payload.len(), 26);
            got += 1;
        })
        .unwrap();
        assert_eq!(got, 5, "all 5 records across exact-fill+overflow boundaries replayed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn record_larger_than_segment_errors() {
        // A pathological record bigger than the whole segment cannot be staged
        // without corrupting the fallocate region — it must return an error.
        const SEG: u64 = 256;
        let dir = tmp("roll-toobig");
        let sh = Shard::open_with_segment_size(dir.clone(), SEG).unwrap();
        let huge = vec![b'!'; 512];
        let res = sh.reserve_and_stage(RecordKind::Append, 6, 0, &huge);
        assert!(res.is_err(), "a record larger than segment_size must error, not overflow");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn committer_does_not_advance_past_unwritten_gap() {
        // l1 staged (written), l2 RESERVED-BUT-UNWRITTEN (gap), l3 staged (written).
        // The committer must NOT advance durable_lsn past the gap, even though l3's bytes
        // are on disk — durable_lsn may reach l1 but MUST stay < l3 until l2 is written.
        let sh = Shard::open(tmp("shard")).unwrap();
        let l1 = sh.reserve_and_stage(RecordKind::Append, 1, 0, b"a").unwrap();
        let _l2 = sh.reserve_only(); // #[cfg(test)] hook: assigns lsn, no write
        let l3 = sh.reserve_and_stage(RecordKind::Append, 1, 2, b"c").unwrap();
        let h = sh.spawn_committer();
        sh.wait_durable(l1).await;
        // give the committer a beat to (incorrectly) over-advance if the watermark is broken
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(sh.durable_lsn() >= l1, "l1 (and its contiguous prefix) is durable");
        assert!(sh.durable_lsn() < l3, "MUST NOT advance past the unwritten l2 gap to l3");
        h.stop();
    }

    #[tokio::test]
    async fn write_error_fails_the_stage_without_panicking() {
        // A transient WAL `write_at` failure must surface as a `Result::Err`
        // (so the caller fails the ack) — NOT a process panic. The reserved lsn
        // stays a permanent gap, so a LATER good stage can never become durable
        // past it (the committer's contiguous watermark is blocked).
        let sh = Shard::open(tmp("write-err")).unwrap();

        sh.fail_next_write();
        let err = sh.reserve_and_stage(RecordKind::Append, 1, 0, b"boom");
        assert!(err.is_err(), "an injected write_at failure must return Err, not panic");

        // The failed lsn (1) was reserved but never written → permanent gap. A
        // subsequent good stage (lsn 2) is on disk, but the committer must NOT
        // advance durable_lsn past the gap at lsn 1.
        let l2 = sh.reserve_and_stage(RecordKind::Append, 1, 4, b"ok").unwrap();
        assert_eq!(l2, 2, "the failed stage still consumed lsn 1 (it stays a gap)");
        let h = sh.spawn_committer();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(
            sh.durable_lsn(),
            0,
            "durable_lsn cannot advance past the unwritten (failed) lsn-1 gap"
        );
        h.stop();
    }

    #[tokio::test]
    async fn reset_after_recovery_clears_stale_segments_so_new_appends_dont_collide() {
        // Simulate the recover-before-clobber window: an old `1.wal` holds whole,
        // framed pre-crash records (and a `checkpoint` marker). After recovery has
        // replayed them into the per-stream files, `reset_after_recovery` must wipe
        // the WAL to a fresh state so a NEW (shorter) append at lsn 1 / offset 0
        // does not leave a stale suffix of old records that a second recovery would
        // mis-replay.
        let dir = tmp("reset");
        let sh = Shard::open(dir.clone()).unwrap();

        // Lay down several whole old records, then drop & re-open (non-destructive
        // open keeps the bytes — exactly the production crash-restart situation).
        for i in 0..6u64 {
            sh.reserve_and_stage(RecordKind::Append, 1, i * 8, b"old-data").unwrap();
        }
        std::fs::write(dir.join("checkpoint"), "3").unwrap();
        let old_len_on_disk = {
            // The old segment holds the framed records (plus fallocate zeros).
            let raw = std::fs::read(seg_path(&dir, 1)).unwrap();
            // The first record decodes as a real record (proves stale data exists).
            assert!(matches!(decode_at(&raw, 0), Decoded::Record { .. }));
            raw.len()
        };
        assert!(seg_path(&dir, 1).exists());
        drop(sh);

        // Re-open (non-destructive) then reset, as the wiring does after recovery.
        let sh = Shard::open(dir.clone()).unwrap();
        sh.reset_after_recovery().unwrap();

        // The checkpoint marker is gone; the segment exists but is FULLY ZEROED
        // (fresh fallocate) — no stale record decodes at offset 0 anymore.
        assert!(!dir.join("checkpoint").exists(), "stale checkpoint removed");
        let raw = std::fs::read(seg_path(&dir, 1)).unwrap();
        assert_eq!(raw.len(), old_len_on_disk, "segment re-created at full size");
        assert!(
            raw.iter().all(|&b| b == 0),
            "segment is fully zeroed — no stale framed records survive the reset"
        );
        assert!(
            !matches!(decode_at(&raw, 0), Decoded::Record { .. }),
            "offset 0 no longer decodes as a (stale) record"
        );

        // A new append now lands at lsn 1 / offset 0 into the clean segment; the
        // committer makes it durable and nothing past it decodes as a record.
        let h = sh.spawn_committer();
        let lsn = sh.reserve_and_stage(RecordKind::Append, 1, 0, b"new").unwrap();
        assert_eq!(lsn, 1, "fresh WAL starts at lsn 1");
        sh.wait_durable(lsn).await;
        let raw = std::fs::read(seg_path(&dir, 1)).unwrap();
        match decode_at(&raw, 0) {
            Decoded::Record { lsn: l, total, payload_off, len, .. } => {
                assert_eq!(l, 1);
                assert_eq!(&raw[payload_off..payload_off + len], b"new");
                // Right after the only live record we hit fallocate zeros = clean
                // end-of-log; NO stale old record decodes there.
                assert!(
                    !matches!(decode_at(&raw, total), Decoded::Record { .. }),
                    "no stale record after the single fresh append"
                );
            }
            other => panic!("fresh record did not decode: {other:?}"),
        }
        h.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn checkpoint_fsyncs_touched_files_then_recycles_below_lsn() {
        let dir = tmp("ckpt");
        let sh = Shard::open(dir.clone()).unwrap();

        // Spawn the committer so staged records become durable (advances durable_lsn).
        let h = sh.spawn_committer();

        // Build a real stream via the store so the dirty set can hold its
        // `Arc<StreamState>` (checkpoint reads `Shared.tail` + `Shared.file`).
        let store = crate::store::Store::new_with_tier(
            dir.clone(),
            crate::tier::TierConfig::default(),
        )
        .unwrap();
        let st = match store.create("dirty-stream", ckpt_test_cfg(), None, 0).unwrap() {
            crate::store::CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };
        let sid = st.id;
        let stream_file_path = st.file_path.clone();

        // Stage a couple of records and write the per-stream bytes WITHOUT fsync,
        // then register the stream. checkpoint() must fdatasync its file (we assert
        // the bytes land) and record its durable tail.
        let l1 = sh.reserve_and_stage(RecordKind::Append, sid, 0, b"hello").unwrap();
        let l2 = sh.reserve_and_stage(RecordKind::Append, sid, 5, b"world").unwrap();
        {
            let f = Arc::clone(&st.shared.read().unwrap().file);
            use std::io::Write;
            (&*f).write_all(b"helloworld").unwrap();
            // Reflect the written bytes in the logical tail so checkpoint records it.
            st.shared.write().unwrap().tail = 10;
        }
        sh.register_dirty(sid, Arc::clone(&st));

        sh.wait_durable(l2).await;
        assert!(sh.durable_lsn() >= l2, "both records durable in the WAL");

        // Plant a STALE segment fully below the active segment (start lsn 1). Name
        // it with a start lsn of 1 would collide with active; instead simulate a
        // PRIOR segment by renaming: the active segment is `1.wal`. A segment that
        // is fully below the checkpoint floor needs a FOLLOWING segment whose start
        // ≤ floor. Create a stale `0.wal` (covers lsn range [0, 1)) — the next
        // segment (`1.wal`, the active one) starts at 1 ≤ floor, so `0.wal` is
        // fully below and must be recycled while `1.wal` (active) survives.
        let stale = seg_path(&dir, 0);
        std::fs::write(&stale, b"stale-segment-bytes").unwrap();
        assert!(stale.exists());

        // (a)+(b)+(c): checkpoint drains+fsyncs the dirty file, writes the
        // checkpoint file, recycles `0.wal`, keeps the active `1.wal`.
        let ckpt = sh.checkpoint().await.unwrap();
        assert_eq!(ckpt, l2, "checkpoint_lsn == committer durable_lsn (l2)");

        // (b) the checkpoint file holds checkpoint_lsn.
        let persisted = std::fs::read_to_string(dir.join("checkpoint")).unwrap();
        assert_eq!(persisted.trim().parse::<u64>().unwrap(), l2);

        // (a) the touched per-stream file's bytes are durably on disk (fsync'd).
        assert_eq!(std::fs::read(&stream_file_path).unwrap(), b"helloworld");
        // dirty set drained: a second checkpoint with nothing touched is a no-op
        // for fsync (we just assert it does not error and floor is unchanged).
        let _ = sh.checkpoint().await.unwrap();

        // (c) the stale segment fully below checkpoint_lsn is unlinked; the active
        // segment (`1.wal`) remains.
        assert!(!stale.exists(), "segment fully below checkpoint_lsn recycled");
        assert!(seg_path(&dir, 1).exists(), "active segment never recycled");

        let _ = l1;
        h.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn checkpoint_is_non_blocking_for_acks() {
        // With checkpoint NEVER run, reserve_and_stage + wait_durable must still
        // ack (gated only on the committer's durable_lsn), and the WAL size grows
        // as records accumulate (a lagging checkpoint only delays recycling).
        let dir = tmp("ckpt-nonblock");
        let sh = Shard::open(dir.clone()).unwrap();
        let h = sh.spawn_committer();

        let size_before = sh.wal_size_bytes();
        let mut last = 0;
        for i in 0..16u64 {
            last = sh.reserve_and_stage(RecordKind::Append, 7, i * 5, b"abcde").unwrap();
        }
        // Acks resolve with NO checkpoint having run.
        tokio::time::timeout(std::time::Duration::from_secs(5), sh.wait_durable(last))
            .await
            .expect("appends ack without any checkpoint (non-blocking)");
        assert!(sh.durable_lsn() >= last);
        // WAL bytes are present (fallocate'd active segment) and not recycled.
        assert!(
            sh.wal_size_bytes() >= size_before,
            "WAL size does not shrink without a checkpoint"
        );
        assert!(seg_path(&dir, 1).exists(), "WAL segment retained (not recycled)");

        h.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn committer_records_batch_size_per_fdatasync() {
        // Stage K records BEFORE the committer runs so a single fdatasync makes all
        // K durable in one commit. Assert last_batch == K and avg == records/fsync.
        const K: u64 = 6;
        let dir = tmp("batch-stats");
        let sh = Shard::open(dir.clone()).unwrap();

        // Stage K records while no committer is running → they accumulate as a
        // single not-yet-durable batch above durable_lsn (0).
        let mut last = 0;
        for i in 0..K {
            last = sh.reserve_and_stage(RecordKind::Append, 7, i * 4, b"data").unwrap();
        }
        assert_eq!(sh.durable_lsn_now(), 0, "nothing durable until the committer runs");

        // Now run the committer: one fdatasync should make all K durable at once.
        let h = sh.spawn_committer();
        sh.wait_durable(last).await;
        h.stop();

        let snap = sh.stats_snapshot();
        assert_eq!(snap.fsync_count, 1, "a single fdatasync committed the whole batch");
        assert_eq!(snap.last_batch, K, "last_batch == records made durable by that fsync");
        assert_eq!(snap.records_committed, K);
        assert_eq!(snap.avg(), K as f64, "avg == records_committed / fsync_count");
        assert_eq!(snap.max(), K);
        assert_eq!(sh.tail_lsn(), K, "tail_lsn == highest assigned lsn");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn commits_contiguous_prefix_and_bytes_decode() {
        // Stage K records, run the committer, wait for the last to be durable,
        // assert durable_lsn reached it, and that every record decodes from the
        // segment byte-for-byte.
        const K: u64 = 8;
        let dir = tmp("shard-pos");
        let sh = Shard::open(dir.clone()).unwrap();

        let h = sh.spawn_committer();

        let mut lsns = Vec::new();
        let mut payloads = Vec::new();
        for i in 0..K {
            let p = format!("payload-{i}").into_bytes();
            let lsn = sh.reserve_and_stage(RecordKind::Append, 7, i * 10, &p).unwrap();
            lsns.push(lsn);
            payloads.push(p);
        }
        let last = *lsns.last().unwrap();
        sh.wait_durable(last).await;
        assert!(sh.durable_lsn() >= last, "durable_lsn reached the last staged lsn");
        h.stop();

        // Every record's bytes are on disk and decode correctly, back-to-back.
        let raw = std::fs::read(seg_path(&dir, 1)).unwrap();
        let mut off = 0usize;
        for (idx, expect_payload) in payloads.iter().enumerate() {
            match decode_at(&raw, off) {
                Decoded::Record { lsn, stream_id, stream_offset, payload_off, len, total, .. } => {
                    assert_eq!(lsn, lsns[idx]);
                    assert_eq!(stream_id, 7);
                    assert_eq!(stream_offset, idx as u64 * 10);
                    assert_eq!(&raw[payload_off..payload_off + len], expect_payload.as_slice());
                    off += total;
                }
                other => panic!("record {idx} did not decode: {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn dedicated_thread_committer_makes_durable_and_stops_cleanly() {
        // The committer runs on its OWN dedicated OS thread (Tier-2a), NOT the
        // tokio runtime. It must (a) make staged records durable while running,
        // and (b) on a stop signal perform a FINAL DRAIN so even a batch staged
        // immediately before the stop becomes durable, then exit so the thread
        // joins cleanly (no detach, no hang).
        let dir = tmp("dedicated-thread");
        let sh = Shard::open(dir.clone()).unwrap();
        let h = sh.spawn_committer();

        // (a) Records made durable while the committer thread runs.
        let mut last = 0;
        for i in 0..10u64 {
            last = sh.reserve_and_stage(RecordKind::Append, 1, i, b"live").unwrap();
        }
        sh.wait_durable(last).await;
        assert!(sh.durable_lsn() >= last, "records durable while committer runs");

        // (b) Stage a final batch, then stop WITHOUT awaiting durability — the
        // committer's final drain must still make them durable before it exits.
        // `reserve_and_stage` returns only after `mark_written`, so by the time
        // this loop finishes every record is contiguous-written; the final drain
        // snapshots that watermark and fsyncs it.
        let mut last2 = last;
        for i in 0..5u64 {
            last2 = sh
                .reserve_and_stage(RecordKind::Append, 1, 100 + i, b"tail")
                .unwrap();
        }
        // `stop()` signals stop and JOINS the thread — blocks until it has drained
        // and exited.
        h.stop();
        assert_eq!(
            sh.durable_lsn(),
            last2,
            "final drain on shutdown made the just-staged batch durable before the thread exited"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// CQ-1 invariant: `register_dirty` must happen-before `reserve_and_stage`.
    ///
    /// At the moment `reserve_and_stage` begins (before any lsn is assigned),
    /// the stream must already be in the shard's dirty set so a concurrent
    /// checkpoint can never recycle the WAL segment carrying that lsn before
    /// the per-stream file has been `fdatasync`'d (spec §7, register-before-stage).
    ///
    /// The `set_on_stage_hook` seam fires at the very first instruction of
    /// `reserve_and_stage`, letting us snapshot `is_dirty(stream_id)` at the
    /// earliest possible moment the record's lsn could become durable.
    #[tokio::test]
    async fn wal_registers_dirty_before_lsn_can_become_durable() {
        use std::sync::atomic::{AtomicBool, Ordering};

        let dir = tmp("dirty-order");
        let sh = Shard::open(dir.clone()).unwrap();

        // Build a real stream via the store so register_dirty gets a proper
        // Arc<StreamState> (same as the production maybe_sync_on_ack path does).
        let store = crate::store::Store::new_with_tier(
            dir.clone(),
            crate::tier::TierConfig::default(),
        )
        .unwrap();
        let st = match store.create("order-stream", ckpt_test_cfg(), None, 0).unwrap() {
            crate::store::CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };
        let stream_id = st.id;

        // Precondition: stream is NOT yet dirty before any ack runs.
        assert!(
            !sh.is_dirty(stream_id),
            "precondition: stream not in dirty set before registration"
        );

        // Install the ordering seam: captures is_dirty(stream_id) at the very
        // start of reserve_and_stage (before this record's lsn is even assigned).
        let hook_fired = Arc::new(AtomicBool::new(false));
        let dirty_at_stage = Arc::new(AtomicBool::new(false));
        {
            let sh2 = Arc::clone(&sh);
            let fired = Arc::clone(&hook_fired);
            let dirty_seen = Arc::clone(&dirty_at_stage);
            sh.set_on_stage_hook(Box::new(move |sid| {
                if sid == stream_id {
                    dirty_seen.store(sh2.is_dirty(stream_id), Ordering::SeqCst);
                    fired.store(true, Ordering::SeqCst);
                }
            }));
        }

        // Mimic maybe_sync_on_ack: register_dirty BEFORE reserve_and_stage.
        // This is the exact production ordering the CQ-1 invariant mandates.
        sh.register_dirty(stream_id, Arc::clone(&st));
        sh.reserve_and_stage(RecordKind::Append, stream_id, 0, b"cq1-probe").unwrap();

        // THE INVARIANT: the hook must have fired and seen is_dirty == true.
        assert!(
            hook_fired.load(Ordering::SeqCst),
            "reserve_and_stage seam must fire (WAL arm executed)"
        );
        assert!(
            dirty_at_stage.load(Ordering::SeqCst),
            "stream must be registered dirty BEFORE reserve_and_stage begins \
             (register_dirty must precede staging — if this fails, a checkpoint \
              floor can advance past the lsn before the per-stream file is in \
              the dirty set, violating the recycle-before-fsync ordering, CQ-1)"
        );

        // The stream remains dirty after the stage (checkpoint hasn't run yet).
        assert!(sh.is_dirty(stream_id), "stream stays dirty until checkpoint drains it");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Tier-1a hot path: re-registering an ALREADY-dirty stream within the same
    /// checkpoint epoch must NOT re-push into the dirty collection. The first
    /// `register_dirty` wins the 0→epoch CAS and pushes once; every subsequent
    /// touch of that stream (the common per-append case) is a pure relaxed-load
    /// branch that returns without taking the `dirty` lock or growing the Vec.
    #[tokio::test]
    async fn register_dirty_is_idempotent_within_an_epoch() {
        let dir = tmp("dirty-idem");
        let sh = Shard::open(dir.clone()).unwrap();
        let store = crate::store::Store::new_with_tier(
            dir.clone(),
            crate::tier::TierConfig::default(),
        )
        .unwrap();
        let st = match store.create("idem-stream", ckpt_test_cfg(), None, 0).unwrap() {
            crate::store::CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };
        let sid = st.id;

        assert_eq!(sh.dirty_len(), 0, "precondition: empty dirty set");

        // First touch this epoch: wins the CAS, pushes exactly once.
        sh.register_dirty(sid, Arc::clone(&st));
        assert_eq!(sh.dirty_len(), 1, "first registration pushes once");
        assert!(sh.is_dirty(sid));

        // Many re-touches in the SAME epoch: every one is the hot path (no push).
        for _ in 0..1000 {
            sh.register_dirty(sid, Arc::clone(&st));
        }
        assert_eq!(
            sh.dirty_len(),
            1,
            "re-registering an already-dirty stream in the same epoch must NOT re-push"
        );

        // A DIFFERENT stream in the same epoch is a distinct first-touch → one push.
        let st2 = match store.create("idem-stream-2", ckpt_test_cfg(), None, 0).unwrap() {
            crate::store::CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };
        sh.register_dirty(st2.id, Arc::clone(&st2));
        assert_eq!(sh.dirty_len(), 2, "a distinct stream still registers once");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Tier-1a no-loss: a stream re-touched AFTER a checkpoint drains the dirty set
    /// must re-register (the checkpoint bumped the epoch, so the stream's stale
    /// `dirty_epoch` no longer matches) and therefore land in the NEXT checkpoint.
    /// This is the property that makes the lock-free hot path safe: draining never
    /// silently swallows a stream's subsequent appends.
    #[tokio::test]
    async fn touched_after_checkpoint_drain_lands_in_next_checkpoint() {
        let dir = tmp("dirty-next");
        let sh = Shard::open(dir.clone()).unwrap();
        let h = sh.spawn_committer();
        let store = crate::store::Store::new_with_tier(
            dir.clone(),
            crate::tier::TierConfig::default(),
        )
        .unwrap();
        let st = match store.create("next-stream", ckpt_test_cfg(), None, 0).unwrap() {
            crate::store::CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };
        let sid = st.id;

        let epoch0 = sh.dirty_epoch_now();

        // Interval 1: append + register, make the record durable so checkpoint has
        // a non-zero floor, then checkpoint (drains the stream, bumps the epoch).
        sh.register_dirty(sid, Arc::clone(&st));
        let l1 = sh.reserve_and_stage(RecordKind::Append, sid, 0, b"first").unwrap();
        // Reflect a logical tail so checkpoint records it (file already exists).
        st.shared.write().unwrap().tail = 5;
        sh.wait_durable(l1).await;
        assert!(sh.is_dirty(sid), "registered in interval 1");

        sh.checkpoint().await.unwrap();
        assert_eq!(
            sh.dirty_epoch_now(),
            epoch0 + 1,
            "checkpoint bumped the epoch"
        );
        assert!(!sh.is_dirty(sid), "checkpoint drained the dirty set");
        assert_eq!(sh.dirty_len(), 0, "dirty set empty after drain");

        // Interval 2: the SAME stream is touched again after the drain. Its
        // dirty_epoch is stale (== old epoch), so register_dirty must re-push it.
        sh.register_dirty(sid, Arc::clone(&st));
        assert!(
            sh.is_dirty(sid),
            "a stream touched after the drain re-registers (not lost)"
        );
        assert_eq!(sh.dirty_len(), 1, "re-registered into the next interval's set");

        // The next checkpoint drains it again — proving the post-drain append is
        // covered, never dropped.
        let l2 = sh.reserve_and_stage(RecordKind::Append, sid, 5, b"second").unwrap();
        st.shared.write().unwrap().tail = 11;
        sh.wait_durable(l2).await;
        sh.checkpoint().await.unwrap();
        assert!(!sh.is_dirty(sid), "second checkpoint drained the re-registration");
        assert_eq!(sh.dirty_epoch_now(), epoch0 + 2, "epoch bumped again");

        h.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Tier-1c (a): a waiter for lsn=K is woken EXACTLY when durable reaches >= K,
    /// and NEVER before. We drive `publish_durable` directly (no committer) to set
    /// the watermark precisely: a commit to K-1 must leave the waiter parked; the
    /// commit to K must wake it.
    #[tokio::test]
    async fn waiter_woken_only_when_durable_reaches_its_lsn() {
        use std::time::Duration;
        let sh = Shard::open(tmp("wd-exact")).unwrap();

        let waiter = tokio::spawn({
            let s = sh.clone();
            async move { s.wait_durable(10).await }
        });
        // Let it register and park.
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(sh.waiter_count(), 1, "waiter parked while durable (0) < lsn (10)");
        assert!(!waiter.is_finished(), "waiter must not be woken before its lsn");

        // Advance durable BELOW the waiter's lsn: must NOT wake it.
        sh.publish_durable(9);
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(!waiter.is_finished(), "durable=9 < lsn=10 ⇒ still parked");
        assert_eq!(sh.waiter_count(), 1, "waiter not drained below its lsn");

        // Reach the waiter's lsn: it must wake now.
        sh.publish_durable(10);
        tokio::time::timeout(Duration::from_millis(500), waiter)
            .await
            .expect("waiter woken when durable reaches its lsn")
            .unwrap();
        assert_eq!(sh.waiter_count(), 0, "the satisfied waiter was drained");
    }

    /// Tier-1c (b): committing watermark=K wakes EVERY waiter with lsn <= K in one
    /// pass but leaves every lsn > K parked — and `waiters_woken` counts only the
    /// satisfied ones (the coalescing proof: not a broadcast to all parked).
    #[tokio::test]
    async fn commit_wakes_only_satisfied_waiters_and_counts_them() {
        use std::time::Duration;
        let sh = Shard::open(tmp("wd-coalesce")).unwrap();

        let lo = tokio::spawn({
            let s = sh.clone();
            async move { s.wait_durable(3).await }
        });
        let mid = tokio::spawn({
            let s = sh.clone();
            async move { s.wait_durable(5).await }
        });
        let hi = tokio::spawn({
            let s = sh.clone();
            async move { s.wait_durable(8).await }
        });
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(sh.waiter_count(), 3, "all three waiters parked");

        // Commit watermark = 5: wakes lsn 3 and 5; lsn 8 stays parked.
        sh.publish_durable(5);
        tokio::time::timeout(Duration::from_millis(500), lo)
            .await
            .expect("lsn=3 woken (<= watermark 5)")
            .unwrap();
        tokio::time::timeout(Duration::from_millis(500), mid)
            .await
            .expect("lsn=5 woken (== watermark 5)")
            .unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(!hi.is_finished(), "lsn=8 stays parked above the watermark");
        assert_eq!(sh.waiter_count(), 1, "only the unsatisfied (lsn=8) waiter remains");

        // Coalescing proof: this commit woke exactly the 2 satisfied waiters, not
        // all 3 parked subscribers (the old broadcast would have recorded 3).
        assert_eq!(
            sh.stats_snapshot().waiters_woken,
            2,
            "waiters_woken counts only the satisfied prefix, not every parked waiter"
        );

        // Advancing to 8 finally wakes the last one.
        sh.publish_durable(8);
        tokio::time::timeout(Duration::from_millis(500), hi)
            .await
            .expect("lsn=8 woken once durable reaches it")
            .unwrap();
        assert_eq!(sh.waiter_count(), 0, "all waiters drained");
    }

    /// Tier-1c (c): a waiter whose lsn is ALREADY durable returns immediately via
    /// the fast path, WITHOUT registering in the heap (no park, no oneshot).
    #[tokio::test]
    async fn already_durable_waiter_returns_without_parking() {
        use std::time::Duration;
        let sh = Shard::open(tmp("wd-fast")).unwrap();

        // Make lsn 5 durable up front (no waiters registered yet → fires nothing).
        sh.publish_durable(5);
        assert_eq!(sh.waiter_count(), 0, "no waiters before the fast-path call");

        // A wait for an already-durable lsn must return immediately and register
        // nothing in the heap.
        tokio::time::timeout(Duration::from_millis(200), sh.wait_durable(3))
            .await
            .expect("already-durable (3 <= 5) waiter returns without parking");
        tokio::time::timeout(Duration::from_millis(200), sh.wait_durable(5))
            .await
            .expect("already-durable (5 == 5) waiter returns without parking");
        assert_eq!(
            sh.waiter_count(),
            0,
            "the fast path registers no waiter in the heap"
        );
    }
}
