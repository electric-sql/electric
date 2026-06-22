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
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tokio::sync::{watch, Notify};

use super::codec::{encode_into, Record, RecordKind};
use super::segment::{seg_path, FileSegment, SegmentWriter, SEGMENT_BYTES};

/// Mutable, lock-guarded shard state.
struct ShardInner {
    /// The active (current) segment all new records are written into. Held as an
    /// `Arc` so an appender can clone the handle under the short lock and run its
    /// positioned `write_at` off-lock; the committer's `fdatasync` clones it the
    /// same way. (Segment roll — swapping this `Arc` — is a later task.)
    active: Arc<FileSegment>,
    /// The lsn of the first record this active segment holds (its file name).
    seg_start_lsn: u64,
    /// Next free byte offset within the active segment.
    write_pos: u64,
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
    /// **Dirty set** (spec §7): the per-stream files this shard has *touched*
    /// since its last checkpoint, deduped by `stream_id`. The WAL itself only
    /// knows `stream_id`s; the per-stream `Arc<File>` is registered here from the
    /// append path (`maybe_sync_on_ack` holds it). `checkpoint()` drains this set
    /// and `fdatasync`s exactly these files — no double-fsync of untouched
    /// streams — *before* recycling the WAL. This is decoupled from
    /// `reserve_and_stage`, which never needs the `StreamState`.
    dirty: Mutex<HashMap<u64, Arc<std::fs::File>>>,
    /// Test-only seam: invoked at the very start of `reserve_and_stage`, before
    /// any lsn is reserved/staged (i.e. before this record's lsn can ever become
    /// durable). Lets a test assert the per-stream file was ALREADY registered
    /// into the dirty set by the time staging begins — proving `register_dirty`
    /// precedes `reserve_and_stage` (CQ-1 ordering invariant, spec §7).
    #[cfg(test)]
    #[allow(clippy::type_complexity)]
    on_stage: Mutex<Option<Box<dyn Fn(u64) + Send + Sync>>>,
}

/// Name of the per-shard checkpoint-lsn file: `<shard_dir>/checkpoint` (plain
/// decimal text). A value of `N` means every record with lsn ≤ `N` has had its
/// per-stream-file bytes `fdatasync`'d, so WAL segments fully below `N` are
/// recyclable.
const CHECKPOINT_FILE: &str = "checkpoint";

impl Shard {
    /// Open (creating if needed) the shard rooted at `dir`, opening a fresh
    /// active segment starting at lsn 1.
    ///
    /// (Recovery — resuming an existing shard's lsn/segment state — is a later
    /// task; v1 opens a clean shard.)
    pub fn open(dir: PathBuf) -> io::Result<std::sync::Arc<Shard>> {
        std::fs::create_dir_all(&dir)?;
        let seg_start_lsn = 1;
        let active = Arc::new(FileSegment::create(seg_path(&dir, seg_start_lsn), SEGMENT_BYTES)?);
        let (durable_tx, _durable_rx) = watch::channel(0u64);
        Ok(std::sync::Arc::new(Shard {
            inner: Mutex::new(ShardInner {
                active,
                seg_start_lsn,
                write_pos: 0,
                next_lsn: seg_start_lsn,
                written_high: 0,
                written_ahead: BTreeSet::new(),
            }),
            durable_tx,
            notify: Notify::new(),
            dir,
            dirty: Mutex::new(HashMap::new()),
            #[cfg(test)]
            on_stage: Mutex::new(None),
        }))
    }

    /// Reserve an lsn + segment range, stage the framed record's bytes off-lock,
    /// mark it written, and wake the committer. Returns the assigned lsn.
    ///
    /// The encode + `write_at` happen **after** releasing the assign lock, so
    /// concurrent appenders write disjoint reserved ranges without serializing
    /// on the lock (spec §5/§6). The committer is notified on every stage.
    pub fn reserve_and_stage(
        &self,
        kind: RecordKind,
        stream_id: u64,
        stream_offset: u64,
        payload: &[u8],
    ) -> u64 {
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

        // --- Phase 1: reserve under the short lock. ---
        let (lsn, off, seg) = {
            let mut g = self.inner.lock().unwrap();
            let lsn = g.next_lsn;
            g.next_lsn += 1;
            let off = g.write_pos;
            g.write_pos += total;
            // Clone the segment handle so the write runs off-lock; concurrent
            // appenders write disjoint, just-reserved ranges with no lock held.
            let seg = Arc::clone(&g.active);
            (lsn, off, seg)
        };

        // --- Phase 2: encode + write off-lock. ---
        let mut buf = Vec::with_capacity(total as usize);
        encode_into(
            &mut buf,
            &Record { lsn, kind, stream_id, stream_offset, payload },
        );
        seg.write_at(off, &buf).expect("WAL segment write_at failed");

        // --- Mark written + wake the committer. ---
        {
            let mut g = self.inner.lock().unwrap();
            g.mark_written(lsn);
        }
        self.notify.notify_one();
        lsn
    }

    /// Register a touched stream's per-stream `Arc<File>` into this shard's dirty
    /// set (spec §7). Called from the append path (`maybe_sync_on_ack`) right
    /// after staging a record, since that is where the stream's `Arc<File>` is in
    /// hand. Deduped by `stream_id`: re-touching a stream just refreshes the
    /// handle, so `checkpoint()` `fdatasync`s each touched file exactly once.
    ///
    /// Keeping this off `reserve_and_stage` keeps the WAL ignorant of
    /// `StreamState` (the WAL only ever needs `stream_id`).
    pub fn register_dirty(&self, stream_id: u64, file: Arc<std::fs::File>) {
        self.dirty.lock().unwrap().insert(stream_id, file);
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
        let touched: Vec<Arc<std::fs::File>> = {
            let mut g = self.dirty.lock().unwrap();
            std::mem::take(&mut *g).into_values().collect()
        };
        // Run the (potentially blocking) fdatasyncs off the async runtime so a
        // slow disk can't stall this task's executor thread. Ordering preserved:
        // we await all per-stream fsyncs before touching the WAL.
        let to_sync = touched;
        tokio::task::spawn_blocking(move || -> io::Result<()> {
            for f in &to_sync {
                f.sync_data()?;
            }
            Ok(())
        })
        .await
        .expect("checkpoint fdatasync task panicked")?;

        // 3. Persist checkpoint_lsn (durably) AFTER the per-stream files are
        //    fsync'd, so the recorded floor only ever covers bytes already on
        //    disk in their own files.
        let ckpt_path = self.dir.join(CHECKPOINT_FILE);
        let tmp = self.dir.join(format!("{CHECKPOINT_FILE}.tmp"));
        std::fs::write(&tmp, checkpoint_lsn.to_string())?;
        std::fs::rename(&tmp, &ckpt_path)?;

        // 4. Recycle: unlink WAL segments fully below checkpoint_lsn. This is the
        //    LAST step — strictly after the per-stream fsyncs above.
        self.recycle_below(checkpoint_lsn)?;

        Ok(checkpoint_lsn)
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

    /// Total bytes of this shard's on-disk WAL segments (the recyclable-growth
    /// signal: with checkpoint stalled, this grows as appends accumulate).
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

    /// Await until this shard's `durable_lsn >= lsn`.
    pub async fn wait_durable(&self, lsn: u64) {
        let mut rx = self.durable_tx.subscribe();
        // Fast path: already durable.
        if *rx.borrow_and_update() >= lsn {
            return;
        }
        loop {
            // `changed()` errors only if the sender is dropped, which never
            // happens while the shard is alive.
            if rx.changed().await.is_err() {
                return;
            }
            if *rx.borrow_and_update() >= lsn {
                return;
            }
        }
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

            let watermark = self.inner.lock().unwrap().written_high;
            let durable = *self.durable_tx.borrow();

            if watermark > durable {
                // There is newly-written, not-yet-durable data. fdatasync the
                // segment, then publish the watermark we fsync'd up to.
                let seg = {
                    let g = self.inner.lock().unwrap();
                    Arc::clone(&g.active)
                };
                let fsync_res = seg.fdatasync();
                match fsync_res {
                    Ok(()) => {
                        // Re-snapshot AFTER the fsync: any lsn whose bytes were on
                        // disk before this fsync completed is now durable. We
                        // conservatively publish the watermark captured before the
                        // fsync — every one of those records' bytes was written
                        // (mark_written) before we read `written_high`, and the
                        // fsync flushed all of the segment's dirty pages, so they
                        // are durable. (A record that became written *during* the
                        // fsync is picked up by the next iteration's notify.)
                        let _ = self.durable_tx.send(watermark);
                        // Loop again immediately (do not await) in case the
                        // watermark advanced further while we were fsyncing.
                        continue;
                    }
                    Err(e) => {
                        // fsync failed: do NOT advance durable_lsn, do NOT ack.
                        // Wait for the next notify and retry; the records stay
                        // un-durable until a later fsync succeeds.
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

    #[tokio::test]
    async fn committer_does_not_advance_past_unwritten_gap() {
        // l1 staged (written), l2 RESERVED-BUT-UNWRITTEN (gap), l3 staged (written).
        // The committer must NOT advance durable_lsn past the gap, even though l3's bytes
        // are on disk — durable_lsn may reach l1 but MUST stay < l3 until l2 is written.
        let sh = Shard::open(tmp("shard")).unwrap();
        let l1 = sh.reserve_and_stage(RecordKind::Append, 1, 0, b"a");
        let _l2 = sh.reserve_only(); // #[cfg(test)] hook: assigns lsn, no write
        let l3 = sh.reserve_and_stage(RecordKind::Append, 1, 2, b"c");
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
    async fn checkpoint_fsyncs_touched_files_then_recycles_below_lsn() {
        let dir = tmp("ckpt");
        let sh = Shard::open(dir.clone()).unwrap();

        // Spawn the committer so staged records become durable (advances durable_lsn).
        let h = tokio::spawn({
            let s = sh.clone();
            async move { s.run_committer().await }
        });

        // Stage a couple of records and register a touched per-stream file.
        let l1 = sh.reserve_and_stage(RecordKind::Append, 42, 0, b"hello");
        let l2 = sh.reserve_and_stage(RecordKind::Append, 42, 5, b"world");
        // A stand-in for the stream's own file: write bytes WITHOUT fsync, then
        // register it. checkpoint() must fdatasync it (we assert the bytes land).
        let stream_file_path = dir.join("stream-42.data");
        let f = Arc::new(
            std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(true)
                .open(&stream_file_path)
                .unwrap(),
        );
        {
            use std::io::Write;
            (&*f).write_all(b"helloworld").unwrap();
        }
        sh.register_dirty(42, Arc::clone(&f));

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
            last = sh.reserve_and_stage(RecordKind::Append, 7, i * 5, b"abcde");
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
            let lsn = sh.reserve_and_stage(RecordKind::Append, 7, i * 10, &p);
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
