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
//! 1. Read its `checkpoint_lsn` (`wal/<i>/checkpoint`, default 0).
//! 2. Walk its segments in lsn order from `checkpoint_lsn` to the FIRST torn /
//!    incomplete record — that ends the durable log; the un-acked tail past it is
//!    discarded.
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
//!    - Then update `Shared.tail` and the appender `written` so subsequent
//!      reads/appends see the reconciled tail.

use std::collections::HashMap;
use std::io;
use std::os::fd::AsRawFd;
use std::sync::Arc;

use crate::store::{Store, StreamState};
use crate::wal::codec::RecordKind;
use crate::wal::walset::WalSet;

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
    let checkpoint_lsn = shard.read_checkpoint_lsn();

    // Per-stream durable frontier: the max logical end recovered for that stream.
    // Only streams that actually had an in-range Append are inserted, so we
    // reconcile exactly the touched streams.
    let mut frontier: HashMap<u64, u64> = HashMap::new();
    // Captured replay error from inside the closure (the closure cannot return
    // `io::Result`). The first error aborts further application for this shard.
    let mut replay_err: Option<io::Error> = None;

    shard.replay_from_checkpoint(checkpoint_lsn, |kind, stream_id, stream_offset, payload| {
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
}
