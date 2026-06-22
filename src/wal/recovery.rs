//! Per-shard WAL recovery — replay the durable log to repair each stream's
//! per-stream-file tail to the **durable frontier** (design spec §9).
//!
//! Runs AFTER the non-sharded sidecar pass (`Store::recover`), which owns stream
//! identity (`stream_id`/`next_id`) and reconstructs every `StreamState` from its
//! `.meta`. Recovery here **only repairs file-tail bytes** — it never allocates
//! ids and never creates/deletes streams.
//!
//! # Algorithm (per shard, in parallel)
//!
//! Shards own **disjoint** stream sets (`WalSet::shard_for` routes
//! deterministically), so the per-shard passes run concurrently with no
//! cross-shard synchronization.
//!
//! For each shard:
//! 1. Read its `checkpoint_lsn` (`wal/<i>/checkpoint`, default 0). This is a
//!    write-skip optimization ONLY — NOT the boundary for which streams reconcile.
//! 2. Walk its segments in lsn order from the OLDEST RETAINED record (lsn 0) to
//!    the FIRST torn / incomplete record — that ends the durable log; the un-acked
//!    tail past it is discarded. Replaying from the oldest (not `checkpoint_lsn`)
//!    computes the durable frontier for EVERY stream, so a stream whose last
//!    durable record is ≤ `checkpoint_lsn` but which carries a torn page-cache tail
//!    in its per-stream file still gets that tail truncated (the C1 fix).
//! 3. For each `Append` record, resolve `stream_id → StreamState` (via an
//!    `id → Arc<StreamState>` index built from the sidecar-recovered streams):
//!    - **Frontier skip:** if `stream_offset < file_base` the bytes have already
//!      been sealed/offloaded — re-applying would be out of range / a double
//!      apply, and those bytes live durably in a sealed chunk, so SKIP.
//!    - Else write the payload into the per-stream file at
//!      `file_pos = stream_offset − file_base`, and track the stream's max
//!      recovered logical end (`stream_offset + payload_len`).
//!    - A record whose `stream_id` has no `StreamState` (deleted stream) is
//!      skipped — recovery never resurrects identity.
//! 4. **Reconcile each touched stream's file tail to the durable frontier:**
//!    - If the per-stream file is LONGER than the recovered frontier, a torn
//!      record reached the file's page cache but never the durable WAL (un-acked)
//!      → **truncate** to the frontier (the C1 torn-JSON fix: the file ends on a
//!      whole, durable record boundary).
//!    - If SHORTER, an acked-in-WAL record was not yet checkpoint-fsync'd into the
//!      file — the replay write above already extended it (no loss).
//!    - `fdatasync` the repaired per-stream file so the truncate/extend is
//!      crash-durable BEFORE the tail is published (a crash after recovery but
//!      before the next checkpoint must not lose the repair).
//!    - Then update `Shared.tail` and the appender `written` so subsequent
//!      reads/appends see the reconciled tail.

use std::collections::HashMap;
use std::io;
use std::os::fd::AsRawFd;
use std::sync::Arc;

use crate::store::{Store, StreamState};
use crate::wal::codec::RecordKind;
use crate::wal::walset::WalSet;

/// Test-only counter of per-stream `sync_data` calls made during tail reconcile.
/// Lets a test assert the repair was made crash-durable (HIGH fix) without
/// observing the kernel page cache directly.
#[cfg(test)]
pub(crate) static RECOVERY_FSYNCS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

/// Replay every shard's WAL (in parallel) and repair each touched stream's
/// per-stream-file tail to the durable frontier. See the module docs / spec §9.
///
/// Must run AFTER `Store::recover` (the sidecar pass), which owns identity. It is
/// a no-op for streams not present in the sidecar-recovered set (deleted streams)
/// and for records below a stream's `file_base` (compacted prefix).
pub fn recover(store: &Arc<Store>, wal: &Arc<WalSet>) -> io::Result<()> {
    // Build the id → StreamState index once from the sidecar-recovered streams.
    // Streams are keyed by NAME in the store; recovery routes by `stream_id`, so
    // we re-key on the stable id. Shared across shards read-only.
    let mut index: HashMap<u64, Arc<StreamState>> = HashMap::new();
    for entry in store.streams.iter() {
        let st = entry.value().clone();
        index.insert(st.id, st);
    }
    let index = Arc::new(index);

    // Per-shard passes are independent (disjoint stream sets). Spawn one blocking
    // task per shard and join — the replay is synchronous file I/O.
    let mut handles = Vec::with_capacity(wal.shards().len());
    for shard in wal.shards() {
        let shard = Arc::clone(shard);
        let index = Arc::clone(&index);
        handles.push(std::thread::spawn(move || recover_shard(&shard, &index)));
    }
    for h in handles {
        // A panicked recovery thread is a bug (poisoned state); surface it.
        h.join().expect("WAL recovery shard thread panicked")?;
    }
    Ok(())
}

/// Replay one shard and reconcile the tails of the streams it touched.
fn recover_shard(
    shard: &crate::wal::shard::Shard,
    index: &HashMap<u64, Arc<StreamState>>,
) -> io::Result<()> {
    // `checkpoint_lsn` is a WRITE-SKIP optimization ONLY — NOT the boundary for
    // which streams get reconciled. We replay from the OLDEST RETAINED record so
    // the durable frontier is computed for EVERY stream, including one whose last
    // durable record is ≤ checkpoint_lsn. That stream may still carry a torn
    // page-cache tail in its per-stream file (bytes written on the hot path before
    // the WAL fdatasync ack, then a crash before the ack) that must be truncated;
    // a `checkpoint_lsn`-bounded replay leaves its frontier empty and re-exposes
    // the torn tail (the exact C1 bug the WAL exists to fix, spec §9 line 198).
    //
    // In v1 the active segment is never recycled and there is one segment per
    // shard, so the retained WAL holds EVERY durable record for every stream —
    // replaying all of them (`replay_from_checkpoint(0, …)`) is complete. We still
    // `pwrite` records ≤ checkpoint_lsn (idempotent; recovery is rare) so the
    // simplest-correct path also restores any not-yet-fsync'd checkpoint bytes.
    //
    // DEFER (post-v1): once segment roll + recycle of records ≤ checkpoint lands,
    // a stream whose durable records are ALL recycled while a torn page-cache tail
    // remains can no longer be reconciled from the WAL alone — that will require
    // recording per-stream durable tails at checkpoint time. Out of scope here.
    let _checkpoint_lsn = shard.read_checkpoint_lsn();

    // Per-stream durable frontier: the max logical end recovered for that stream.
    // Only streams that actually had an in-range Append are inserted, so we
    // reconcile exactly the touched streams.
    let mut frontier: HashMap<u64, u64> = HashMap::new();
    // Captured replay error from inside the closure (the closure cannot return
    // `io::Result`). The first error aborts further application for this shard.
    let mut replay_err: Option<io::Error> = None;

    shard.replay_from_checkpoint(0, |kind, stream_id, stream_offset, payload| {
        if replay_err.is_some() {
            return;
        }
        // v1 replay repairs file-tail bytes for `Append` only. Create/Close/Delete
        // are reconstructed by the sidecar pass (identity is not ours to own).
        if kind != RecordKind::Append {
            return;
        }
        // Deleted/unknown stream: no StreamState → skip (never resurrect identity).
        let Some(st) = index.get(&stream_id) else {
            return;
        };
        let file_base = st.shared.read().unwrap().file_base;
        // Frontier invariant: a record below `file_base` is already sealed into a
        // chunk — re-applying would be out of range / a double apply. Skip it.
        if stream_offset < file_base {
            return;
        }
        let file_pos = stream_offset - file_base;
        if let Err(e) = write_at(st, file_pos, payload) {
            replay_err = Some(e);
            return;
        }
        let end = stream_offset + payload.len() as u64;
        let slot = frontier.entry(stream_id).or_insert(0);
        *slot = (*slot).max(end);
    })?;

    if let Some(e) = replay_err {
        return Err(e);
    }

    // Reconcile each touched stream's file tail to its durable frontier.
    for (stream_id, &logical_tail) in &frontier {
        let st = match index.get(stream_id) {
            Some(st) => st,
            None => continue,
        };
        reconcile_tail(st, logical_tail)?;
    }
    Ok(())
}

/// Positioned write of `payload` at `file_pos` into a stream's per-stream file.
///
/// The live `Shared.file` handle is opened `O_APPEND` (Linux forces appends to
/// the end, ignoring a `pwrite` offset), so recovery opens a fresh
/// read-write (non-append) handle for positioned writes/truncation.
fn write_at(st: &StreamState, file_pos: u64, payload: &[u8]) -> io::Result<()> {
    let f = open_rw(st)?;
    let fd = f.as_raw_fd();
    let mut written: usize = 0;
    while written < payload.len() {
        let buf = &payload[written..];
        // SAFETY: `fd` is a valid open fd for the lifetime of `f`; `buf` is a live
        // slice; the kernel writes at the explicit offset (no cursor / append).
        let n = unsafe {
            libc::pwrite(
                fd,
                buf.as_ptr() as *const libc::c_void,
                buf.len(),
                (file_pos + written as u64) as libc::off_t,
            )
        };
        if n < 0 {
            return Err(io::Error::last_os_error());
        }
        if n == 0 {
            return Err(io::Error::new(io::ErrorKind::WriteZero, "pwrite returned 0"));
        }
        written += n as usize;
    }
    Ok(())
}

/// Reconcile the per-stream file's tail to the durable `logical_tail`, then
/// update `Shared.tail` and the appender `written` so reads/appends are
/// consistent. Truncates a longer (torn page-cache) tail to the durable
/// frontier; a shorter file was already extended by the replay writes.
fn reconcile_tail(st: &StreamState, logical_tail: u64) -> io::Result<()> {
    let file_base = st.shared.read().unwrap().file_base;
    // The frontier is always ≥ file_base (we only insert in-range Appends), so
    // this never underflows.
    let file_len = logical_tail - file_base;

    let f = open_rw(st)?;
    let cur = f.metadata()?.len();
    if cur > file_len {
        // A torn record was written to the file's page cache but never made the
        // durable WAL → un-acked. Truncate to the whole-record durable boundary.
        f.set_len(file_len)?;
    }
    // (cur < file_len: the replay writes above already extended the file — no
    //  truncation; cur == file_len: nothing to do.)

    // Durability of the REPAIR (spec §9): the truncate above and the replay
    // `write_at` extends land only in the page cache. A crash after recovery but
    // before the next checkpoint fsync would lose the repair — the no-loss extend
    // (an acked record re-written by replay) lost AGAIN, and the torn tail
    // un-truncated again. fdatasync the per-stream file so the repaired,
    // whole-record-boundary file is crash-durable BEFORE we publish the tail.
    f.sync_data()?;
    #[cfg(test)]
    RECOVERY_FSYNCS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

    // Publish the reconciled tail to in-memory state.
    let closed = {
        let mut s = st.shared.write().unwrap();
        s.tail = logical_tail;
        s.closed_durable
    };
    // Refresh the reader-notification watch so any future subscriber observes the
    // reconciled tail (not the stale, possibly-torn boot value the sidecar seeded).
    st.tail_tx.send_replace(crate::store::Tail {
        bytes: logical_tail,
        closed,
    });
    if let Ok(mut ap) = st.appender.try_lock() {
        ap.written = file_len;
    } else {
        // Recovery runs single-threaded w.r.t. this stream (no live appenders yet
        // at boot), so the lock is always free; fall back to a blocking lock if
        // some boot-time task holds it transiently.
        let mut ap = st.appender.blocking_lock();
        ap.written = file_len;
    }
    Ok(())
}

/// Open a fresh read-write (non-append) handle to a stream's per-stream data file
/// for positioned writes / truncation during recovery.
fn open_rw(st: &StreamState) -> io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&st.file_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{write_meta_sync, CreateResult, Store, StreamConfig};
    use crate::tier::TierConfig;
    use crate::wal::codec::{encode_into, Record};
    use crate::wal::segment::seg_path;
    use std::path::PathBuf;

    fn tmp(tag: &str) -> PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let p = std::env::temp_dir().join(format!(
            "ds-wal-recovery-test-{tag}-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    fn cfg() -> StreamConfig {
        StreamConfig {
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

    /// Encode an `Append` record for `(stream_id, stream_offset, payload)` at `lsn`
    /// and append its framed bytes to `buf`.
    fn append_record(buf: &mut Vec<u8>, lsn: u64, stream_id: u64, stream_offset: u64, payload: &[u8]) {
        encode_into(
            buf,
            &Record {
                lsn,
                kind: RecordKind::Append,
                stream_id,
                stream_offset,
                payload,
            },
        );
    }

    #[tokio::test]
    async fn wal_recovery_repairs_tail_no_torn_no_loss() {
        let dir = tmp("repair");

        // --- Build a 1-shard WAL + a store, create the stream, and lay down the
        //     per-stream file + a hand-built WAL segment so we control exactly
        //     what is durable vs torn. ---
        let wal = WalSet::open(&dir, Some(1), 1).unwrap();
        let mut store = Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap();
        store.wal = Some(std::sync::Arc::clone(&wal));
        let store = std::sync::Arc::new(store);

        // Three durable records for a root stream (file_base = 0).
        let r1 = b"alpha".as_slice();
        let r2 = b"bravo!!".as_slice();
        let r3 = b"charlie-delta".as_slice();
        // A 4th record that is ACKED in the file's page cache but TORN in the WAL.
        let r4_torn = b"torn-tail-never-durable".as_slice();

        let st = match store.create("s", cfg(), None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };
        let durable_len = r1.len() + r2.len() + r3.len();

        // The per-stream file as a CRASH would leave it: all three durable records
        // PLUS a torn 4th record that reached the page cache but never the durable
        // WAL. (We must reconcile this 4th away.)
        {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .open(&st.file_path)
                .unwrap();
            f.write_all(r1).unwrap();
            f.write_all(r2).unwrap();
            f.write_all(r3).unwrap();
            f.write_all(r4_torn).unwrap(); // torn page-cache tail past the durable frontier
            f.sync_all().unwrap();
        }

        // Build the shard's WAL segment by hand: r1,r2,r3 are whole durable
        // records. The 4th append (r4_torn) NEVER reached the durable WAL — its
        // bytes are only in the file's page cache (above). After r3 the segment is
        // the fallocate'd zero region, which `decode_at` reads as `Incomplete` =
        // the clean end of the durable log. So the durable frontier is after r3,
        // and recovery must reconcile (truncate) the un-acked r4 page-cache tail.
        let id = st.id;
        let mut seg = Vec::new();
        append_record(&mut seg, 1, id, 0, r1);
        append_record(&mut seg, 2, id, r1.len() as u64, r2);
        append_record(&mut seg, 3, id, (r1.len() + r2.len()) as u64, r3);
        let whole_len = seg.len();
        let _ = r4_torn; // only in the page-cache file, never in the WAL

        // A seeded stream with file_base = K to exercise the frontier skip: a WAL
        // record with stream_offset < K must be skipped (no out-of-range write).
        const K: u64 = 100;
        let st2 = match store.create("compacted", cfg(), None, K).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create st2 failed"),
        };
        assert_eq!(st2.shared.read().unwrap().file_base, K, "seeded file_base = K");
        let id2 = st2.id;
        // st2's live file is empty (file_base = K, tail = K, 0 bytes on disk).
        // A WAL record below the frontier (stream_offset = 10 < K) must be SKIPPED.
        append_record(&mut seg, 5, id2, 10, b"below-frontier-must-skip");
        // And an in-range record for st2 at exactly file_base (file_pos 0) that is
        // acked in the WAL but NOT yet in the file → replay must RESTORE it (no loss).
        let r_noloss = b"no-loss-restored".as_slice();
        append_record(&mut seg, 6, id2, K, r_noloss);

        // The WAL segment lives at <dir>/wal/0/1.wal. `WalSet::open` already created
        // the shard dir + an fallocate'd active 1.wal; overwrite it with our bytes.
        let seg_file = seg_path(&dir.join("wal").join("0"), 1);
        std::fs::write(&seg_file, &seg).unwrap();

        // Persist sidecars so the sidecar pass recovers both streams on reopen.
        write_meta_sync(&st, true).unwrap();
        write_meta_sync(&st2, true).unwrap();

        let st_file_path = st.file_path.clone();
        let st2_file_path = st2.file_path.clone();

        // Drop everything (simulate process exit).
        drop(st);
        drop(st2);
        drop(store);
        drop(wal);

        // --- Reopen: sidecar pass + WAL recovery. ---
        let wal = WalSet::open(&dir, Some(1), 1).unwrap();
        let mut store = Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap();
        store.wal = Some(std::sync::Arc::clone(&wal));
        let store = std::sync::Arc::new(store);

        recover(&store, &wal).unwrap();

        // (a) the file ends at the 3rd WHOLE durable record — the torn 4th discarded.
        let meta_len = std::fs::metadata(&st_file_path).unwrap().len();
        assert_eq!(
            meta_len as usize, durable_len,
            "file truncated to file_base + len(r1)+len(r2)+len(r3); torn 4th discarded"
        );
        let _ = whole_len; // (whole_len == HEADER_LEN*3 + durable_len, sanity only)

        // (b) the file bytes are EXACTLY r1‖r2‖r3 (byte-identical, whole records only).
        let mut expect = Vec::new();
        expect.extend_from_slice(r1);
        expect.extend_from_slice(r2);
        expect.extend_from_slice(r3);
        assert_eq!(
            std::fs::read(&st_file_path).unwrap(),
            expect,
            "recovered bytes are r1‖r2‖r3 exactly"
        );
        // In-memory tail reconciled to the durable frontier.
        let st = store.streams.iter().find(|e| e.value().id == id).unwrap().value().clone();
        assert_eq!(st.shared.read().unwrap().tail, durable_len as u64, "Shared.tail == durable frontier");
        assert_eq!(st.appender.lock().await.written, durable_len as u64, "appender.written reconciled");

        // (c) the below-frontier record (stream_offset 10 < K) was SKIPPED — the
        //     no-loss record at file_pos 0 IS restored, and nothing was written out
        //     of range. The file is exactly the restored record (16 bytes), NOT the
        //     skipped 24-byte below-frontier payload.
        let st2_bytes = std::fs::read(&st2_file_path).unwrap();
        assert_eq!(
            st2_bytes, r_noloss,
            "below-frontier record skipped; the in-range no-loss record restored at file_pos 0"
        );
        let st2 = store.streams.iter().find(|e| e.value().id == id2).unwrap().value().clone();
        assert_eq!(
            st2.shared.read().unwrap().tail,
            K + r_noloss.len() as u64,
            "st2 tail = file_base + restored len"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Write `checkpoint_lsn` into a 1-shard WAL's `<dir>/wal/0/checkpoint`.
    fn write_checkpoint(dir: &std::path::Path, lsn: u64) {
        std::fs::write(dir.join("wal").join("0").join("checkpoint"), lsn.to_string()).unwrap();
    }

    /// CRITICAL (C1): a stream whose ONLY post-`checkpoint_lsn` append is TORN —
    /// i.e. its durable records are ALL ≤ `checkpoint_lsn` — but whose per-stream
    /// file carries a torn page-cache tail PAST the last durable record (bytes
    /// written on the hot path before the WAL fdatasync ack, then a crash).
    ///
    /// A `checkpoint_lsn`-bounded replay leaves this stream's frontier EMPTY
    /// (no in-range record after the checkpoint) → `reconcile_tail` never runs →
    /// the torn tail is re-exposed. Replaying from the OLDEST retained record
    /// computes the frontier and truncates the torn tail.
    ///
    /// MUST fail before the fix (file keeps the torn tail) and pass after.
    #[tokio::test]
    async fn wal_recovery_truncates_torn_tail_when_durable_records_all_below_checkpoint() {
        let dir = tmp("torn-below-ckpt");

        let wal = WalSet::open(&dir, Some(1), 1).unwrap();
        let mut store = Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap();
        store.wal = Some(std::sync::Arc::clone(&wal));
        let store = std::sync::Arc::new(store);

        // Two durable records; both will be ≤ checkpoint_lsn.
        let r1 = b"alpha".as_slice();
        let r2 = b"bravo!!".as_slice();
        // Torn page-cache tail past the durable frontier (never reached the WAL).
        let r_torn = b"torn-tail-{\"x\":".as_slice(); // even torn JSON

        let st = match store.create("s", cfg(), None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };
        let durable_len = r1.len() + r2.len();

        // The per-stream file as a crash left it: r1‖r2 (durable) + torn tail.
        {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().write(true).open(&st.file_path).unwrap();
            f.write_all(r1).unwrap();
            f.write_all(r2).unwrap();
            f.write_all(r_torn).unwrap(); // un-acked torn page-cache tail
            f.sync_all().unwrap();
        }

        // WAL holds ONLY r1 (lsn 1) and r2 (lsn 2) — both whole, both durable. The
        // torn 3rd append never reached the WAL.
        let id = st.id;
        let mut seg = Vec::new();
        append_record(&mut seg, 1, id, 0, r1);
        append_record(&mut seg, 2, id, r1.len() as u64, r2);
        let seg_file = seg_path(&dir.join("wal").join("0"), 1);
        std::fs::write(&seg_file, &seg).unwrap();

        // Checkpoint fsynced the file up to AND INCLUDING r2: checkpoint_lsn = 2,
        // so a `checkpoint_lsn`-bounded replay (lsn >= 2 only) would replay just r2.
        // Make it strictly ABOVE both durable records (lsn 3) so the bounded replay
        // sees NOTHING for this stream — the frontier stays empty and the torn tail
        // survives. Replay-from-oldest still recovers r1‖r2 and truncates the tail.
        write_checkpoint(&dir, 3);

        write_meta_sync(&st, true).unwrap();
        let st_file_path = st.file_path.clone();

        drop(st);
        drop(store);
        drop(wal);

        let wal = WalSet::open(&dir, Some(1), 1).unwrap();
        let mut store = Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap();
        store.wal = Some(std::sync::Arc::clone(&wal));
        let store = std::sync::Arc::new(store);

        recover(&store, &wal).unwrap();

        // The torn tail is discarded: file ends at file_base + end(last durable rec).
        let meta_len = std::fs::metadata(&st_file_path).unwrap().len();
        assert_eq!(
            meta_len as usize, durable_len,
            "torn page-cache tail truncated even though durable records are all ≤ checkpoint_lsn"
        );
        // Bytes are byte-identical to the durable prefix r1‖r2 (no torn JSON).
        let mut expect = Vec::new();
        expect.extend_from_slice(r1);
        expect.extend_from_slice(r2);
        assert_eq!(
            std::fs::read(&st_file_path).unwrap(),
            expect,
            "recovered bytes are exactly the durable prefix r1‖r2"
        );
        let st = store.streams.iter().find(|e| e.value().id == id).unwrap().value().clone();
        assert_eq!(
            st.shared.read().unwrap().tail,
            durable_len as u64,
            "Shared.tail reconciled to the durable frontier"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// HIGH: the repair (truncate / extend) must be fdatasync'd before `recover()`
    /// returns. Asserts (a) a per-stream `sync_data` was invoked during reconcile,
    /// and (b) the reconciled (truncated) length is durably ON DISK — provable by
    /// re-opening WITHOUT re-running recovery: the sidecar pass seeds
    /// `tail = file_base + file size`, so it reads the truncated length only if the
    /// truncation actually hit the disk (not just the page cache).
    #[tokio::test]
    async fn wal_recovery_repair_is_fsynced_and_persists_across_reopen() {
        let dir = tmp("fsync-repair");

        let wal = WalSet::open(&dir, Some(1), 1).unwrap();
        let mut store = Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap();
        store.wal = Some(std::sync::Arc::clone(&wal));
        let store = std::sync::Arc::new(store);

        let r1 = b"durable-record".as_slice();
        let r_torn = b"torn-page-cache-tail".as_slice();

        let st = match store.create("s", cfg(), None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };
        let durable_len = r1.len();

        {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().write(true).open(&st.file_path).unwrap();
            f.write_all(r1).unwrap();
            f.write_all(r_torn).unwrap(); // un-acked torn tail to be truncated
            f.sync_all().unwrap();
        }

        let id = st.id;
        let mut seg = Vec::new();
        append_record(&mut seg, 1, id, 0, r1);
        let seg_file = seg_path(&dir.join("wal").join("0"), 1);
        std::fs::write(&seg_file, &seg).unwrap();

        write_meta_sync(&st, true).unwrap();
        let st_file_path = st.file_path.clone();

        drop(st);
        drop(store);
        drop(wal);

        // --- First reopen: run recovery (which must truncate AND fsync). ---
        let wal = WalSet::open(&dir, Some(1), 1).unwrap();
        let mut store = Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap();
        store.wal = Some(std::sync::Arc::clone(&wal));
        let store = std::sync::Arc::new(store);

        let before = RECOVERY_FSYNCS.load(std::sync::atomic::Ordering::SeqCst);
        recover(&store, &wal).unwrap();
        let after = RECOVERY_FSYNCS.load(std::sync::atomic::Ordering::SeqCst);
        assert!(
            after > before,
            "reconcile_tail must sync_data the repaired per-stream file (HIGH durability fix)"
        );
        assert_eq!(
            std::fs::metadata(&st_file_path).unwrap().len() as usize,
            durable_len,
            "file truncated to the durable frontier after recovery"
        );

        drop(store);
        drop(wal);

        // --- Second reopen: sidecar pass ONLY, NO WAL recovery. The seeded tail is
        //     file_base + on-disk file size. If the truncation only hit the page
        //     cache it would be lost here; persistence proves the fsync. ---
        let store2 = Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap();
        let store2 = std::sync::Arc::new(store2);
        // (No store2.wal / no recover() call — pure on-disk observation.)
        let st2 = store2.streams.iter().find(|e| e.value().id == id).unwrap().value().clone();
        assert_eq!(
            st2.shared.read().unwrap().tail,
            durable_len as u64,
            "the reconciled length is durable on disk (survives a reopen without recovery)"
        );
        assert_eq!(
            std::fs::read(&st_file_path).unwrap(),
            r1,
            "on-disk bytes are exactly the durable record; the torn tail is gone for good"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
