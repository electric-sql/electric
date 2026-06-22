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

use std::collections::BTreeSet;
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
}

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
