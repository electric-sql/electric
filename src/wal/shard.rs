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

use std::collections::{BTreeSet, HashMap};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tokio::sync::{watch, Notify};

use super::codec::{encode_into, Record, RecordKind};
use super::segment::{seg_path, FileSegment, SegmentWriter, SEGMENT_BYTES};
use super::telemetry::{ShardStats, StatsSnapshot};
use crate::store::StreamState;

/// Mutable, lock-guarded shard state.
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

/// One WAL shard: a segmented append-only log with its own committer.
pub struct Shard {
    inner: Mutex<ShardInner>,
    /// Publishes `durable_lsn` to `wait_durable` waiters.
    durable_tx: watch::Sender<u64>,
    /// Wakes the committer whenever a record is staged.
    notify: Notify,
    /// `<data-dir>/wal/<shard>/` — where this shard's segments live.
    dir: PathBuf,
    /// The size each segment is `fallocate`'d to and the roll threshold. Defaults
    /// to [`SEGMENT_BYTES`] (128 MiB); a `#[cfg(test)]`/constructor override lets a
    /// test force rolls with a tiny (e.g. 4 KiB) segment without writing 128 MiB.
    /// Immutable for the shard's lifetime, so a plain field (no lock) is enough.
    segment_size: u64,
    /// **Dirty set** (spec §7): the per-stream `StreamState`s this shard has
    /// *touched* since its last checkpoint, deduped by `stream_id`. The append
    /// path (`maybe_sync_on_ack`) registers the touched stream's `Arc<StreamState>`
    /// here. `checkpoint()` drains this set, reads each stream's current logical
    /// `Shared.tail` and live `Shared.file`, `fdatasync`s exactly these files — no
    /// double-fsync of untouched streams — *before* recycling the WAL, and records
    /// each stream's durable tail (the tail at the moment its file is fsync'd) into
    /// the persisted per-shard tail map (spec §7, task 11b). Holding the
    /// `StreamState` (rather than a bare `Arc<File>`) lets checkpoint read the
    /// logical tail it must record alongside the file it fsyncs. This stays
    /// decoupled from `reserve_and_stage`, which never needs the `StreamState`.
    dirty: Mutex<HashMap<u64, Arc<StreamState>>>,
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
        let seg_start_lsn = 1;
        let active = Arc::new(FileSegment::create(seg_path(&dir, seg_start_lsn), segment_size)?);
        let (durable_tx, _durable_rx) = watch::channel(0u64);
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
            durable_tx,
            notify: Notify::new(),
            dir,
            segment_size,
            dirty: Mutex::new(HashMap::new()),
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
            let mut g = self.inner.lock().unwrap();

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
            let mut g = self.inner.lock().unwrap();
            g.mark_written(lsn);
        }
        self.notify.notify_one();
        Ok(lsn)
    }

    /// Register a touched stream's `Arc<StreamState>` into this shard's dirty set
    /// (spec §7). Called from the append path (`maybe_sync_on_ack`) BEFORE staging
    /// the WAL record (register-before-stage, CQ-1), since that is where the
    /// stream's `Arc<StreamState>` is in hand. Deduped by `stream_id`: re-touching
    /// a stream just refreshes the handle, so `checkpoint()` reads each touched
    /// stream's current tail + `fdatasync`s its file exactly once.
    ///
    /// `reserve_and_stage` itself stays ignorant of `StreamState` (it only ever
    /// needs `stream_id`); the `StreamState` is needed solely by `checkpoint`, to
    /// read the durable tail it records and the file it fsyncs.
    pub fn register_dirty(&self, stream_id: u64, st: Arc<StreamState>) {
        self.dirty.lock().unwrap().insert(stream_id, st);
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
    pub async fn checkpoint(&self) -> io::Result<u64> {
        // 1. Snapshot the recycle floor = the highest durably-acked lsn.
        let checkpoint_lsn = *self.durable_tx.borrow();

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
        let touched: Vec<(u64, u64, Arc<std::fs::File>)> = {
            let mut g = self.dirty.lock().unwrap();
            std::mem::take(&mut *g)
                .into_iter()
                .map(|(id, st)| {
                    let s = st.shared.read().unwrap();
                    (id, s.tail, Arc::clone(&s.file))
                })
                .collect()
        };
        // Run the (potentially blocking) fdatasyncs off the async runtime so a
        // slow disk can't stall this task's executor thread. Ordering preserved:
        // we await all per-stream fsyncs before touching the WAL. We move only the
        // files into the blocking task; the (stream_id, durable_tail) pairs stay
        // here to merge into the persisted tail map after the fsyncs succeed.
        let tails: Vec<(u64, u64)> = touched.iter().map(|(id, tail, _)| (*id, *tail)).collect();
        let to_sync: Vec<Arc<std::fs::File>> =
            touched.into_iter().map(|(_, _, f)| f).collect();
        tokio::task::spawn_blocking(move || -> io::Result<()> {
            for f in &to_sync {
                crate::store::barrier_fsync(f)?;
            }
            Ok(())
        })
        .await
        .expect("checkpoint fdatasync task panicked")?;

        // 3a. Persist the CUMULATIVE per-stream durable-tail map (task 11b) AFTER
        //     the per-stream files are fsync'd, and BEFORE recycle — same hard
        //     ordering as `checkpoint_lsn`. Merge this checkpoint's touched tails
        //     into the previously-persisted map so a stream touched in an earlier
        //     checkpoint (but not this one) keeps its last durable tail. `tmp` +
        //     rename + fsync makes the map itself crash-durable, so when recycle
        //     deletes the WAL records below the floor, recovery can still truncate
        //     a recycled stream's torn per-stream-file tail to its durable tail.
        self.persist_durable_tails(&tails)?;

        // 3b. Persist checkpoint_lsn (durably) AFTER the per-stream files are
        //     fsync'd, so the recorded floor only ever covers bytes already on
        //     disk in their own files.
        let ckpt_path = self.dir.join(CHECKPOINT_FILE);
        let tmp = self.dir.join(format!("{CHECKPOINT_FILE}.tmp"));
        std::fs::write(&tmp, checkpoint_lsn.to_string())?;
        std::fs::rename(&tmp, &ckpt_path)?;

        // 4. Recycle: unlink WAL segments fully below checkpoint_lsn. This is the
        //    LAST step — strictly after the per-stream fsyncs AND the durable-tail
        //    map persist above.
        self.recycle_below(checkpoint_lsn)?;

        Ok(checkpoint_lsn)
    }

    /// Merge `touched` `(stream_id, durable_tail)` pairs into the persisted
    /// CUMULATIVE per-shard durable-tail map (`<shard_dir>/tails`) and rewrite it
    /// durably (`tmp` + rename + fsync the dir-synced file). Called from
    /// `checkpoint` AFTER the touched per-stream files are fdatasync'd and BEFORE
    /// the WAL is recycled, so a torn per-stream-file tail can always be truncated
    /// to its durable tail even after its WAL records are gone (task 11b).
    ///
    /// Cumulative-merge: read the existing map, overwrite each touched stream's
    /// entry with its newest durable tail (`max`, so a re-checkpointed earlier tail
    /// can never regress the recorded value), keep every untouched stream's last
    /// recorded tail.
    fn persist_durable_tails(&self, touched: &[(u64, u64)]) -> io::Result<()> {
        if touched.is_empty() && !self.dir.join(TAILS_FILE).exists() {
            // Nothing touched and no prior map: nothing to persist.
            return Ok(());
        }
        let mut map = Self::read_durable_tails_at(&self.dir);
        for &(id, tail) in touched {
            let slot = map.entry(id).or_insert(0);
            *slot = (*slot).max(tail);
        }
        // Serialize as `stream_id durable_tail` lines (sorted for a deterministic,
        // diff-friendly file). Plain decimal text, matching the `checkpoint` file.
        let mut entries: Vec<(u64, u64)> = map.into_iter().collect();
        entries.sort_unstable();
        let mut body = String::with_capacity(entries.len() * 16);
        for (id, tail) in entries {
            body.push_str(&format!("{id} {tail}\n"));
        }
        let path = self.dir.join(TAILS_FILE);
        let tmp = self.dir.join(format!("{TAILS_FILE}.tmp"));
        std::fs::write(&tmp, &body)?;
        // fsync the tmp file's bytes before the rename so the durable-tail map is
        // crash-durable BEFORE recycle (the whole point of 11b).
        std::fs::File::open(&tmp)?.sync_all()?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
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

    /// Current `durable_lsn` — the highest lsn made durable + acked. Cheap
    /// (`watch::borrow`), read by the emitter and by [`Shard::checkpoint`].
    /// Telemetry/test-only as a public accessor (see [`Shard::wal_size_bytes`]).
    #[cfg_attr(not(any(feature = "telemetry", test)), allow(dead_code))]
    pub fn durable_lsn_now(&self) -> u64 {
        *self.durable_tx.borrow()
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
    pub async fn wait_durable(&self, lsn: u64) {
        let mut rx = self.durable_tx.subscribe();
        if *rx.borrow_and_update() >= lsn {
            return;
        }
        loop {
            if rx.changed().await.is_err() {
                return;
            }
            if *rx.borrow_and_update() >= lsn {
                return;
            }
        }
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
        let durable = *self.durable_tx.borrow();
        if watermark <= durable {
            return;
        }
        self.stats.record_batch(watermark - durable);
        // Use send_replace (unconditional write) so the watermark is stored even
        // when no receivers exist yet — `durable_tx` sits at 0 receivers between
        // appends because the constructor drops `_durable_rx` and a waiter only
        // subscribes inside `wait_durable` AFTER `reserve_and_stage` returns.
        // `send()` silently no-ops when receiver_count == 0, which would drop the
        // durable watermark; a waiter that subscribes afterwards reads a stale
        // value and waits forever for an already-durable record.
        self.durable_tx.send_replace(watermark);
        let mut g = self.inner.lock().unwrap();
        g.sealed_pending.retain(|(end_lsn, _)| *end_lsn > watermark);
    }

    /// The shard's group-commit committer: wait for staged work, `fdatasync` the
    /// active segment, advance `durable_lsn` to the contiguous-written watermark,
    /// and publish it to waiters. Runs forever (the caller `abort`s it).
    ///
    /// **Lost-wakeup safety:** we register the `Notified` future *before*
    /// snapshotting the watermark. `Notify` stores one permit, so a `notify_one`
    /// racing between our snapshot and the `await` is captured by the already-
    /// registered future and returns immediately on the next iteration — no
    /// staged record can sit un-committed waiting for a wakeup that already fired.
    ///
    /// **fsync-error path:** if `fdatasync` fails we do **not** advance
    /// `durable_lsn` and do **not** publish — the staged records stay un-acked,
    /// exactly as the no-loss invariant requires (spec §6).
    pub async fn run_committer(self: std::sync::Arc<Self>) {
        loop {
            // Register interest BEFORE reading state (lost-wakeup safety).
            let notified = self.notify.notified();

            let watermark = self.snapshot_watermark();
            let durable = *self.durable_tx.borrow();

            if watermark > durable {
                let (seg, sealed) = self.collect_fsync_targets();
                let fsync_res: io::Result<()> = tokio::task::spawn_blocking(move || {
                    for s in &sealed {
                        s.fdatasync()?;
                    }
                    seg.fdatasync()?;
                    Ok(())
                })
                .await
                .unwrap_or_else(|e| Err(io::Error::other(format!("committer fsync task panicked: {e}"))));
                match fsync_res {
                    Ok(()) => {
                        self.publish_durable(watermark);
                        continue;
                    }
                    Err(e) => {
                        eprintln!("WAL committer fdatasync failed: {e}");
                        notified.await;
                        continue;
                    }
                }
            }

            // Nothing new to commit — wait for the next stage.
            notified.await;
        }
    }

    /// Test-only: current `durable_lsn`.
    #[cfg(test)]
    pub fn durable_lsn(&self) -> u64 {
        *self.durable_tx.borrow()
    }

    /// Test-only: whether `stream_id` is currently in the dirty set. Used to
    /// prove the append path registers a stream BEFORE its lsn can become
    /// durable (the checkpoint recycle-before-fsync ordering invariant, spec §7).
    #[cfg(test)]
    pub fn is_dirty(&self, stream_id: u64) -> bool {
        self.dirty.lock().unwrap().contains_key(&stream_id)
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
        let h = tokio::spawn({
            let s = sh.clone();
            async move { s.run_committer().await }
        });

        // ~200-byte records → ~20 per 4 KiB segment; 80 records ⇒ ≥3 segments.
        let payload = vec![b'x'; 200 - crate::wal::codec::HEADER_LEN];
        let mut last = 0;
        for i in 0..80u64 {
            last = sh.reserve_and_stage(RecordKind::Append, 1, i * 200, &payload).unwrap();
        }
        sh.wait_durable(last).await;
        h.abort();

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
        let h = tokio::spawn({
            let s = sh.clone();
            async move { s.run_committer().await }
        });
        let payload = vec![b'y'; 150];
        let mut last = 0;
        for i in 0..100u64 {
            last = sh.reserve_and_stage(RecordKind::Append, 2, i, &payload).unwrap();
        }
        sh.wait_durable(last).await;
        assert_eq!(sh.durable_lsn(), last, "every record across rolls is durable");
        assert!(segs_on_disk(&dir).len() >= 3, "spanned ≥3 segments");
        h.abort();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn recovery_replays_every_record_across_rolls() {
        // Replay across rolled segments (sealed exactly-packed + active w/ zero
        // tail) must reconstruct EVERY record, byte-identical, in lsn order.
        const SEG: u64 = 4096;
        let dir = tmp("roll-replay");
        let sh = Shard::open_with_segment_size(dir.clone(), SEG).unwrap();
        let h = tokio::spawn({
            let s = sh.clone();
            async move { s.run_committer().await }
        });
        let mut expect: Vec<(u64, u64, Vec<u8>)> = Vec::new();
        let mut last = 0;
        for i in 0..120u64 {
            // ~150-byte framed records ⇒ ~27 per 4 KiB segment ⇒ 120 ⇒ ≥4 segments.
            let p = format!("rec-{i:04}-{}", "p".repeat(120)).into_bytes();
            last = sh.reserve_and_stage(RecordKind::Append, 3, i * 7, &p).unwrap();
            expect.push((last, i * 7, p));
        }
        sh.wait_durable(last).await;
        h.abort();
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
        let h = tokio::spawn({
            let s = sh.clone();
            async move { s.run_committer().await }
        });
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
        h.abort();
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
        let payload = vec![b'q'; 31]; // total = 33 + 31 = 64
        let total = (crate::wal::codec::HEADER_LEN + payload.len()) as u64;
        assert_eq!(total, 64);
        const SEG: u64 = 128; // exactly 2 records per segment
        let sh = Shard::open_with_segment_size(dir.clone(), SEG).unwrap();
        let h = tokio::spawn({
            let s = sh.clone();
            async move { s.run_committer().await }
        });
        // 5 records: r1,r2 fill seg0 exactly (write_pos 64 then 128 == SEG, no roll
        // on r2 since 64+64==128 is NOT > 128). r3 rolls (128+64 > 128). r4 fills
        // the new seg. r5 rolls again.
        let mut last = 0;
        for i in 0..5u64 {
            last = sh.reserve_and_stage(RecordKind::Append, 5, i, &payload).unwrap();
        }
        sh.wait_durable(last).await;
        h.abort();

        let segs = segs_on_disk(&dir);
        assert_eq!(segs.len(), 3, "r1r2 | r3r4 | r5 ⇒ 3 segments");
        // seg0 sealed at exactly 128 (2 records, exact fill — no premature roll).
        assert_eq!(std::fs::metadata(&segs[0].1).unwrap().len(), 128, "exact-fill seg packed at 128");
        assert_eq!(std::fs::metadata(&segs[1].1).unwrap().len(), 128, "second sealed seg packed at 128");

        // Replay reconstructs all 5 records.
        let mut got = 0usize;
        sh.replay_from_checkpoint(0, |_, _, off, payload| {
            assert_eq!(off, got as u64);
            assert_eq!(payload.len(), 31);
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
        let h = tokio::spawn({
            let s = sh.clone();
            async move { s.run_committer().await }
        });
        sh.wait_durable(l1).await;
        // give the committer a beat to (incorrectly) over-advance if the watermark is broken
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(sh.durable_lsn() >= l1, "l1 (and its contiguous prefix) is durable");
        assert!(sh.durable_lsn() < l3, "MUST NOT advance past the unwritten l2 gap to l3");
        h.abort();
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
        let h = tokio::spawn({
            let s = sh.clone();
            async move { s.run_committer().await }
        });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(
            sh.durable_lsn(),
            0,
            "durable_lsn cannot advance past the unwritten (failed) lsn-1 gap"
        );
        h.abort();
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
        let h = tokio::spawn({
            let s = sh.clone();
            async move { s.run_committer().await }
        });
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
        h.abort();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn checkpoint_fsyncs_touched_files_then_recycles_below_lsn() {
        let dir = tmp("ckpt");
        let sh = Shard::open(dir.clone()).unwrap();

        // Spawn the committer so staged records become durable (advances durable_lsn).
        let h = tokio::spawn({
            let s = sh.clone();
            async move { s.run_committer().await }
        });

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
        h.abort();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn checkpoint_is_non_blocking_for_acks() {
        // With checkpoint NEVER run, reserve_and_stage + wait_durable must still
        // ack (gated only on the committer's durable_lsn), and the WAL size grows
        // as records accumulate (a lagging checkpoint only delays recycling).
        let dir = tmp("ckpt-nonblock");
        let sh = Shard::open(dir.clone()).unwrap();
        let h = tokio::spawn({
            let s = sh.clone();
            async move { s.run_committer().await }
        });

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

        h.abort();
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
        let h = tokio::spawn({
            let s = sh.clone();
            async move { s.run_committer().await }
        });
        sh.wait_durable(last).await;
        h.abort();

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

        let h = tokio::spawn({
            let s = sh.clone();
            async move { s.run_committer().await }
        });

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
        h.abort();

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
}
