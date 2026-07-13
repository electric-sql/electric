//! End-to-end durability + sharding integration tests (design spec §13).
//! **The integration gate**: where the framing, committers, sharded `WalSet`,
//! checkpoint, and per-shard recovery built+unit-tested in Tasks 1–9 are
//! exercised together over the REAL append/recover/read flow — the genuine HTTP
//! handler path (`handlers::handle` → `handle_create` / `handle_append_inner`
//! → `write_wire` → `maybe_sync_on_ack` → WAL `reserve_and_stage`/`wait_durable`),
//! a simulated crash (drop the store + committers WITHOUT a graceful shutdown),
//! and the full startup recovery sequence (`WalSet::open` → sidecar pass →
//! `wal::recovery::recover` → `reset_after_recovery` → re-attach + `spawn_committers`).
//!
//! Unlike the unit tests, these never hand-build a WAL segment or call a
//! `wal::*` helper directly to *produce* the durable state: every acked record
//! gets durable through the same code an HTTP `POST`/`PUT` runs in production.
//! That is the point — to catch bugs that only appear when the pieces are wired
//! together (paths that pass in isolation but not end-to-end).

use std::io;
use std::sync::Arc;

use bytes::Bytes;

use crate::api::{Method, Req};
use crate::handlers;
use crate::handlers::test_support::DurabilityGuard;
use crate::store::Store;
use crate::tier::TierConfig;
use crate::wal::shard::CommitterHandle;
use crate::wal::walset::WalSet;

/// A unique temp data dir for one test.
fn tmp(tag: &str) -> std::path::PathBuf {
    use std::time::{SystemTime, UNIX_EPOCH};
    let p = std::env::temp_dir().join(format!(
        "ds-wal-e2e-{tag}-{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&p);
    p
}

/// A booted WAL-mode server harness: the store with its WAL attached and the
/// per-shard committers running on their dedicated OS threads. Committer
/// [`CommitterHandle`]s are held so a test can stop + join them to simulate a
/// crash. (Every record a crash test relies on is already acked — hence durable —
/// before the stop, so the final drain a graceful stop performs is a no-op for
/// those records; the on-disk state matches an abrupt crash.)
struct Harness {
    store: Arc<Store>,
    walset: Arc<WalSet>,
    committers: Vec<CommitterHandle>,
}

impl Harness {
    /// Replicate the **exact** `main.rs` WAL startup sequence (spec §9) for the
    /// data dir at `dir` with `shards` shards (or the persisted N if it already
    /// exists). `default_n` is the would-be `available_parallelism` — used only
    /// to seed a fresh dir, and chosen DIFFERENT from `shards` in the N-stability
    /// test to prove routing ignores it.
    ///
    /// Order (load-bearing, spec §9): `WalSet::open` (non-destructive) → build
    /// `Store` (runs the sidecar identity pass) → `wal::recovery::recover` (replay
    /// the durable WAL into the per-stream files + fsync) → `reset_after_recovery`
    /// (wipe the old WAL) → attach + `spawn_committers`.
    fn boot(dir: &std::path::Path, shards: Option<usize>, default_n: usize) -> io::Result<Harness> {
        Harness::boot_with_segment_size(dir, shards, default_n, crate::wal::segment::SEGMENT_BYTES)
    }

    /// [`Harness::boot`] with an explicit WAL segment size, so a test can force
    /// segment rolls/recycles cheaply (multi-segment recovery coverage).
    fn boot_with_segment_size(
        dir: &std::path::Path,
        shards: Option<usize>,
        default_n: usize,
        segment_size: u64,
    ) -> io::Result<Harness> {
        let walset = WalSet::open_with_segment_size(dir, shards, default_n, segment_size)?;
        let store = Arc::new(Store::new_with_tier(dir.to_path_buf(), TierConfig::default())?);
        crate::wal::recovery::recover(&store, &walset)?;
        walset.reset_after_recovery()?;
        store
            .wal
            .set(Arc::clone(&walset))
            .unwrap_or_else(|_| panic!("WAL already attached"));
        // Spawn committers ourselves (not `walset.spawn_committers()`) so we keep
        // the handles and can stop them to simulate a crash.
        let mut committers = Vec::new();
        for shard in walset.shards() {
            committers.push(shard.spawn_committer());
        }
        Ok(Harness { store, walset, committers })
    }

    /// Stop + join every committer thread (so no further `durable_lsn` advance can
    /// race the test's subsequent file surgery). All records the caller cares
    /// about are already acked/durable, so each committer's final drain is a
    /// no-op for them.
    fn stop_committers(&mut self) {
        for h in self.committers.drain(..) {
            h.stop();
        }
    }

    /// Simulate a crash: stop the committers (so no further `durable_lsn`
    /// advance) and drop the store + WalSet WITHOUT a graceful drain/shutdown.
    /// The data dir on disk is left exactly as the live process left it.
    fn crash(mut self) {
        self.stop_committers();
        drop(self.store);
        drop(self.walset);
    }
}

/// Build a `PUT` (create) request for `path` with `content_type` and an optional
/// body. Extra headers (e.g. fork headers) are appended verbatim.
fn put_req(path: &str, content_type: &str, body: &[u8], extra: &[(&str, &str)]) -> Req {
    let mut headers = vec![("content-type".to_string(), content_type.to_string())];
    for (k, v) in extra {
        headers.push((k.to_string(), v.to_string()));
    }
    Req {
        method: Method::Put,
        path: path.to_string(),
        query: None,
        headers,
        body: Bytes::copy_from_slice(body),
    }
}

/// Build a `POST` (append) request for `path`.
fn post_req(path: &str, content_type: &str, body: &[u8]) -> Req {
    Req {
        method: Method::Post,
        path: path.to_string(),
        query: None,
        headers: vec![("content-type".to_string(), content_type.to_string())],
        body: Bytes::copy_from_slice(body),
    }
}

/// Create a stream over the REAL HTTP path; assert a 2xx.
async fn create_stream(store: &Arc<Store>, path: &str, content_type: &str) {
    let resp = handlers::handle(Arc::clone(store), put_req(path, content_type, b"", &[])).await;
    assert!(
        (200..300).contains(&resp.status),
        "create {path} expected 2xx, got {}",
        resp.status
    );
}

/// Append one record over the REAL HTTP path; assert a 2xx ack (which, in WAL
/// mode, means the record's lsn is durable — its prefix is on disk + fdatasync'd;
/// in `memory` mode it means the page-cache write completed — no WAL, no fsync).
async fn append_acked(store: &Arc<Store>, path: &str, content_type: &str, body: &[u8]) {
    let resp = handlers::handle(Arc::clone(store), post_req(path, content_type, body)).await;
    assert!(
        (200..300).contains(&resp.status),
        "append to {path} expected 2xx ack, got {}",
        resp.status
    );
}

/// The data-file path for a stream by name (the read surface; spec §8). Resolves
/// the live `StreamState.file_path` so we read exactly what `sendfile` would.
fn stream_file_bytes(store: &Arc<Store>, path: &str) -> Vec<u8> {
    let st = store.get(path).unwrap_or_else(|| panic!("stream {path} not found"));
    std::fs::read(&st.file_path).unwrap()
}

/// The shard index a stream name routes to, after creating it (so we can assert
/// two streams land on different shards). Uses the live store + walset routing.
fn shard_index_of(store: &Arc<Store>, walset: &Arc<WalSet>, path: &str) -> usize {
    let st = store.get(path).unwrap();
    let target = walset.shard_for(st.id);
    walset
        .shards()
        .iter()
        .position(|s| Arc::ptr_eq(s, target))
        .unwrap()
}

const OCTET: &str = "application/octet-stream";
const JSON: &str = "application/json";

/// Format a byte offset as the wire `Stream-Fork-Offset` value
/// (`<16-digit seq>_<16-digit byte-offset>`; the seq part is ignored for byte
/// resolution by `parse_offset`).
fn fork_offset(bytes: u64) -> String {
    format!("{:016}_{:016}", 0, bytes)
}

// ===========================================================================
// (1) NO-LOSS across ≥2 shards (spec §13 "No-loss", §14 criterion 1)
// ===========================================================================

/// Create several streams (chosen so they hash to ≥2 different shards), append
/// K records to each over the REAL handler path, confirm each append is ACKED
/// (durable in the WAL), then simulate a crash (abort committers, drop store +
/// WalSet, keep the data dir) and reopen with the full startup recovery
/// sequence. Every acked record must recover BYTE-IDENTICAL; an un-acked tail
/// (staged but its committer never advanced `durable_lsn`) must be ABSENT.
#[tokio::test]
async fn e2e_no_loss_two_shards_acked_records_survive_crash() {
    let _guard = DurabilityGuard::wal();
    let dir = tmp("noloss");

    // 4 shards so a handful of streams reliably spreads across ≥2 of them.
    let h = Harness::boot(&dir, Some(4), 4).unwrap();

    // Create enough streams that at least two distinct shards are touched.
    let names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
    for n in names {
        create_stream(&h.store, n, OCTET).await;
    }
    let mut used_shards = std::collections::BTreeSet::new();
    for n in names {
        used_shards.insert(shard_index_of(&h.store, &h.walset, n));
    }
    assert!(
        used_shards.len() >= 2,
        "test needs streams on ≥2 shards; got shards {used_shards:?}"
    );

    // Append K records to each stream; build the expected per-stream byte image.
    const K: usize = 5;
    let mut expected: std::collections::HashMap<&str, Vec<u8>> = std::collections::HashMap::new();
    for n in names {
        let buf = expected.entry(n).or_default();
        for i in 0..K {
            let rec = format!("{n}-record-{i:03}|").into_bytes();
            append_acked(&h.store, n, OCTET, &rec).await;
            buf.extend_from_slice(&rec);
        }
    }

    // CRASH: abort committers + drop everything, no graceful shutdown.
    h.crash();

    // REOPEN with the full startup recovery sequence.
    let h2 = Harness::boot(&dir, None, 4).unwrap();

    // Every acked record survived byte-identical on each stream's read surface.
    for n in names {
        let got = stream_file_bytes(&h2.store, n);
        assert_eq!(
            got, expected[n],
            "stream {n}: all {K} acked records recover byte-identical after crash"
        );
        let st = h2.store.get(n).unwrap();
        assert_eq!(
            st.tail().bytes,
            expected[n].len() as u64,
            "stream {n}: recovered tail == total acked bytes"
        );
    }
    h2.crash();
    let _ = std::fs::remove_dir_all(&dir);
}

/// No-loss boundary: an un-acked tail is ABSENT after recovery. A record can
/// only ack (return 2xx) AFTER its WAL record is whole + fdatasync'd — so the
/// honest model of a "staged but un-acked" record is one whose WAL bytes are
/// TORN (a partial write a crash left mid-record, before the committer's
/// fdatasync could make a whole record durable) while its data DID reach the
/// per-stream file's page cache (`write_wire` runs upstream of the ack gate). On
/// a real crash that record never acked; recovery stops at the first torn WAL
/// record and truncates the file tail back to the durable frontier → the
/// un-acked bytes are gone, the genuinely-acked prefix is fully restored.
#[tokio::test]
async fn e2e_no_loss_unacked_tail_is_absent_after_crash() {
    let _guard = DurabilityGuard::wal();
    use crate::wal::codec::HEADER_LEN;

    let dir = tmp("noloss-unacked");

    let mut h = Harness::boot(&dir, Some(1), 1).unwrap();
    create_stream(&h.store, "s", OCTET).await;

    // Two genuinely-acked appends through the real path (durable in the WAL).
    append_acked(&h.store, "s", OCTET, b"acked-one|").await;
    append_acked(&h.store, "s", OCTET, b"acked-two|").await;
    let acked: &[u8] = b"acked-one|acked-two|";

    // The un-acked tail: its data reached the per-stream FILE page cache (as
    // `write_wire` would), but its WAL record is TORN. Abort the committer so no
    // further durable_lsn advance, then:
    //   (a) append the un-acked bytes to the per-stream file (page-cache write).
    //   (b) plant a TORN partial WAL record right after the two whole durable
    //       records: only a few header bytes, never a full framed record.
    h.stop_committers();
    let st = h.store.get("s").unwrap();
    let unacked: &[u8] = b"UNACKED-NEVER-DURABLE|";
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().append(true).open(&st.file_path).unwrap();
        f.write_all(unacked).unwrap(); // (a) page-cache tail past the durable frontier
        f.sync_all().unwrap();
    }
    // (b) The two durable records occupy `2*HEADER_LEN + len("acked-one|") +
    //     len("acked-two|")` bytes at the start of the active segment `1.wal`.
    //     Overwrite the bytes just past them with a partial (torn) header so the
    //     decoder ends the durable log there.
    let seg_path = crate::wal::segment::seg_path(&dir.join("wal").join("0"), 1);
    let durable_wal_len = 2 * HEADER_LEN + b"acked-one|".len() + b"acked-two|".len();
    {
        use std::io::{Seek, SeekFrom, Write};
        let mut f = std::fs::OpenOptions::new().write(true).open(&seg_path).unwrap();
        f.seek(SeekFrom::Start(durable_wal_len as u64)).unwrap();
        // A few non-zero bytes that cannot decode as a whole record (header CRC
        // will not validate / payload short) → torn end-of-log.
        f.write_all(&[0xAB, 0xCD, 0xEF, 0x01, 0x02]).unwrap();
        f.sync_all().unwrap();
    }

    // Crash + reopen.
    drop(st);
    let store = h.store;
    let walset = h.walset;
    drop(store);
    drop(walset);

    let h2 = Harness::boot(&dir, None, 1).unwrap();
    let got = stream_file_bytes(&h2.store, "s");
    assert_eq!(
        got, acked,
        "only the two ACKED records recover; the torn, un-acked tail is truncated away"
    );
    h2.crash();
    let _ = std::fs::remove_dir_all(&dir);
}

// ===========================================================================
// (2) NO TORN RECORD incl. JSON (spec §13 "No torn record", §14 criterion 2)
// ===========================================================================

/// Post-checkpoint torn case: a per-stream JSON file carries a torn trailing
/// record (a partial JSON value appended to the page cache but never acked into
/// the WAL). The durable WAL covers only whole records. After the real startup
/// recovery the file must end on a whole-record boundary and read back as only
/// whole, valid JSON values.
#[tokio::test]
async fn e2e_no_torn_json_tail_repaired_to_whole_records() {
    let _guard = DurabilityGuard::wal();
    let dir = tmp("torn-json");

    let h = Harness::boot(&dir, Some(1), 1).unwrap();
    create_stream(&h.store, "j", JSON).await;

    // Two whole JSON records through the real path. The wire encoding appends a
    // trailing ',' to each value (handlers::encode_wire), so the file is
    // `{"a":1},{"b":2},`.
    append_acked(&h.store, "j", JSON, br#"{"a":1}"#).await;
    append_acked(&h.store, "j", JSON, br#"{"b":2}"#).await;
    let durable = stream_file_bytes(&h.store, "j");
    assert_eq!(durable, br#"{"a":1},{"b":2},"#, "two whole JSON wire records acked");

    // Now simulate a page-cache write that reached the FILE but never the durable
    // WAL: append a TORN trailing JSON value straight to the per-stream file
    // (bypassing the WAL), then crash. This is exactly the C1 scenario `fast`
    // could not fix: a half-written `{"c":` with no durable record boundary.
    let st = h.store.get("j").unwrap();
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&st.file_path)
            .unwrap();
        f.write_all(br#"{"c":"#).unwrap(); // torn, un-acked JSON tail
        f.sync_all().unwrap();
    }
    drop(st);
    h.crash();

    // Reopen: recovery must truncate the torn tail back to the durable frontier.
    let h2 = Harness::boot(&dir, None, 1).unwrap();
    let got = stream_file_bytes(&h2.store, "j");
    assert_eq!(
        got, br#"{"a":1},{"b":2},"#,
        "recovery repaired the file to whole records; torn `{{\"c\":` discarded"
    );
    // Every record reads back as valid JSON (the wire is value,value, — split on
    // the trailing commas and parse each).
    let text = String::from_utf8(got.clone()).unwrap();
    for v in text.trim_end_matches(',').split("},") {
        let val = if v.ends_with('}') { v.to_string() } else { format!("{v}}}") };
        serde_json::from_str::<serde_json::Value>(&val)
            .unwrap_or_else(|e| panic!("recovered record {val:?} is not valid JSON: {e}"));
    }
    h2.crash();
    let _ = std::fs::remove_dir_all(&dir);
}

/// The CRITICAL Task-7 case: the torn tail when the last DURABLE record is
/// ≤ `checkpoint_lsn`. Append+ack two records (durable in the WAL), drive a real
/// checkpoint so `checkpoint_lsn` covers BOTH, then add a torn page-cache tail
/// and crash. A `checkpoint_lsn`-bounded replay would see no post-checkpoint
/// record for the stream → leave the torn tail. The shipped replay-from-oldest
/// must still compute the frontier and truncate the torn tail.
#[tokio::test]
async fn e2e_no_torn_tail_when_last_durable_record_below_checkpoint() {
    let _guard = DurabilityGuard::wal();
    let dir = tmp("torn-below-ckpt");

    let h = Harness::boot(&dir, Some(1), 1).unwrap();
    create_stream(&h.store, "s", OCTET).await;
    append_acked(&h.store, "s", OCTET, b"rec-one|").await;
    append_acked(&h.store, "s", OCTET, b"rec-two|").await;
    let durable: &[u8] = b"rec-one|rec-two|";

    // Drive a REAL checkpoint: fdatasync the touched per-stream file + persist
    // checkpoint_lsn covering both acked records. (Single shard.)
    let ckpt = h.walset.shards()[0].checkpoint().await.unwrap();
    assert!(ckpt >= 2, "checkpoint_lsn covers both acked records (got {ckpt})");

    // Torn page-cache tail past the durable+checkpointed frontier, then crash.
    let st = h.store.get("s").unwrap();
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&st.file_path)
            .unwrap();
        f.write_all(b"TORN-TAIL-PAST-CHECKPOINT").unwrap();
        f.sync_all().unwrap();
    }
    drop(st);
    h.crash();

    let h2 = Harness::boot(&dir, None, 1).unwrap();
    let got = stream_file_bytes(&h2.store, "s");
    assert_eq!(
        got, durable,
        "torn tail truncated even though the last durable record is ≤ checkpoint_lsn (Task-7 critical)"
    );
    h2.crash();
    let _ = std::fs::remove_dir_all(&dir);
}

// ===========================================================================
// (3) SHARDING — parallel recovery + below-file_base skip (spec §13 "Sharding")
// ===========================================================================

/// Streams hashing to different shards recover in parallel correctly (every
/// stream's records restored from its own shard's WAL, in one `recover` call
/// that spawns a thread per shard). Also asserts the live routing actually
/// spread the streams across ≥2 shards (else the test is vacuous).
#[tokio::test]
async fn e2e_sharding_parallel_recovery_across_shards() {
    let _guard = DurabilityGuard::wal();
    let dir = tmp("sharding");

    let h = Harness::boot(&dir, Some(4), 4).unwrap();
    // Many streams to guarantee a multi-shard spread.
    let names: Vec<String> = (0..12).map(|i| format!("stream-{i:02}")).collect();
    for n in &names {
        create_stream(&h.store, n, OCTET).await;
    }
    let shards: std::collections::BTreeSet<usize> = names
        .iter()
        .map(|n| shard_index_of(&h.store, &h.walset, n))
        .collect();
    assert!(shards.len() >= 2, "streams must span ≥2 shards; got {shards:?}");

    let mut expected: std::collections::HashMap<String, Vec<u8>> = std::collections::HashMap::new();
    for n in &names {
        let mut buf = Vec::new();
        for i in 0..3 {
            let rec = format!("{n}#{i}|").into_bytes();
            append_acked(&h.store, n, OCTET, &rec).await;
            buf.extend_from_slice(&rec);
        }
        expected.insert(n.clone(), buf);
    }
    h.crash();

    // One `recover` call inside boot replays all shards in parallel.
    let h2 = Harness::boot(&dir, None, 4).unwrap();
    for n in &names {
        assert_eq!(
            stream_file_bytes(&h2.store, n),
            expected[n],
            "stream {n} (its own shard) recovers all records after parallel recovery"
        );
    }
    h2.crash();
    let _ = std::fs::remove_dir_all(&dir);
}

/// A record with `stream_offset < file_base` (a forked/compacted stream's
/// already-sealed prefix) is SKIPPED on replay — no out-of-range write. We build
/// this end-to-end: fork a stream at a non-zero offset over the REAL handler path
/// (so `file_base > 0`), append+ack a record to the fork, then ALSO stage a WAL
/// record below the fork's `file_base` directly into its shard (the kind of
/// record a pre-fork compaction left behind). After crash+recovery the fork's
/// file holds only the in-range record; the below-frontier record is not applied.
#[tokio::test]
async fn e2e_sharding_below_file_base_record_skipped() {
    let _guard = DurabilityGuard::wal();
    let dir = tmp("below-base");

    let mut h = Harness::boot(&dir, Some(1), 1).unwrap();
    // Parent with content so a fork can diverge at offset > 0.
    create_stream(&h.store, "parent", OCTET).await;
    append_acked(&h.store, "parent", OCTET, b"0123456789").await; // tail = 10
    // Fork at offset 5 over the real path → the fork's file_base == 5.
    let resp = handlers::handle(
        Arc::clone(&h.store),
        put_req(
            "child",
            OCTET,
            b"",
            &[("stream-forked-from", "parent"), ("stream-fork-offset", &fork_offset(5))],
        ),
    )
    .await;
    assert!((200..300).contains(&resp.status), "fork create got {}", resp.status);
    let child = h.store.get("child").unwrap();
    let file_base = child.shared.read().unwrap().file_base;
    assert_eq!(file_base, 5, "forked stream file_base = fork offset");

    // Append one in-range record to the fork via the real path (stream_offset =
    // file_base = 5, file position 0).
    append_acked(&h.store, "child", OCTET, b"FORKDATA").await;

    // Stage a WAL record for the fork BELOW its file_base (stream_offset 2 < 5):
    // the frontier-skip case. It must be skipped on replay (re-applying would be
    // an out-of-range / double-apply; those bytes live in the parent/sealed
    // prefix). Stop the committers first so we don't perturb the acked frontier.
    h.stop_committers();
    let shard = h.walset.shard_for(child.id);
    shard
        .reserve_and_stage(
            crate::wal::codec::RecordKind::Append,
            child.id,
            2, // < file_base (5) → must be skipped
            b"BELOW-FRONTIER",
        )
        .unwrap();
    // Re-run a committer briefly so this staged record DOES become durable in the
    // WAL (proving the skip is in recovery's replay, not just an un-acked drop).
    let c = shard.spawn_committer();
    // Wait until durable so the record is genuinely in the WAL's durable range.
    shard.wait_durable(shard.tail_lsn()).await;
    c.stop();

    drop(child);
    let store = h.store;
    let walset = h.walset;
    drop(store);
    drop(walset);

    let h2 = Harness::boot(&dir, None, 1).unwrap();
    // The fork's file holds ONLY the in-range record (8 bytes "FORKDATA"). The
    // below-frontier record was skipped (not written out of range at a negative
    // / wrapped position).
    let got = stream_file_bytes(&h2.store, "child");
    assert_eq!(
        got, b"FORKDATA",
        "below-file_base WAL record skipped on replay; only the in-range record applied"
    );
    let child2 = h2.store.get("child").unwrap();
    assert_eq!(
        child2.tail().bytes,
        file_base + 8,
        "fork tail = file_base + in-range bytes (no out-of-range write)"
    );
    h2.crash();
    let _ = std::fs::remove_dir_all(&dir);
}

// ===========================================================================
// (4) N-STABILITY (spec §13 "N-stability", §5)
// ===========================================================================

/// Reopen the same data dir with a DIFFERENT `available_parallelism`/default_n →
/// every stream still resolves to its PERSISTED shard (routing uses the persisted
/// N + stream_id, never the per-boot core count). Also asserts the lib-level
/// guard: `WalSet::open` with `--wal-shards` ≠ the persisted N is an error
/// (the `is_err()` the brief calls out — main.rs maps it to exit 2).
#[tokio::test]
async fn e2e_n_stability_shard_resolution_ignores_core_count() {
    let _guard = DurabilityGuard::wal();
    let dir = tmp("n-stability");

    // Persist N = 4, seeded with default_n = 4.
    let h = Harness::boot(&dir, Some(4), 4).unwrap();
    let names: Vec<String> = (0..10).map(|i| format!("s-{i}")).collect();
    for n in &names {
        create_stream(&h.store, n, OCTET).await;
        append_acked(&h.store, n, OCTET, b"x").await;
    }
    // Record each stream's (id, shard index) under the persisted-4 routing.
    let mut want: Vec<(u64, usize)> = Vec::new();
    for n in &names {
        let st = h.store.get(n).unwrap();
        want.push((st.id, shard_index_of(&h.store, &h.walset, n)));
    }
    h.crash();

    // Reopen with a DIFFERENT default_n (16) — a machine with more cores. The
    // persisted N (4) must win, so every stream resolves to the SAME shard.
    let h2 = Harness::boot(&dir, None, 16).unwrap();
    assert_eq!(h2.walset.shards().len(), 4, "persisted N (4) used, not default_n (16)");
    for (id, expect_idx) in &want {
        let target = h2.walset.shard_for(*id);
        let got_idx = h2
            .walset
            .shards()
            .iter()
            .position(|s| Arc::ptr_eq(s, target))
            .unwrap();
        assert_eq!(got_idx, *expect_idx, "stream id {id} resolves to its persisted shard");
    }

    // Lib-level guard (maps to exit 2 in main.rs): a requested N ≠ persisted is
    // rejected.
    assert!(
        WalSet::open(&dir, Some(8), 8).is_err(),
        "--wal-shards 8 ≠ persisted 4 is rejected (exit 2 at the binary level)"
    );
    assert!(
        WalSet::open(&dir, Some(4), 99).is_ok(),
        "a matching --wal-shards is accepted"
    );
    h2.crash();
    let _ = std::fs::remove_dir_all(&dir);
}

// ===========================================================================
// (5) CHECKPOINT NON-BLOCKING (spec §13 "Checkpoint non-blocking", §7)
// ===========================================================================

/// With the checkpoint NEVER run, appends keep acking over the real handler path
/// and the WAL `size_bytes` grows (does not shrink — a lagging checkpoint only
/// delays WAL recycling, it never backpressures the ack path).
#[tokio::test]
async fn e2e_checkpoint_non_blocking_appends_ack_and_wal_grows() {
    let _guard = DurabilityGuard::wal();
    let dir = tmp("ckpt-nonblock");

    let h = Harness::boot(&dir, Some(1), 1).unwrap();
    create_stream(&h.store, "s", OCTET).await;

    let size0: u64 = h.walset.shards().iter().map(|s| s.wal_size_bytes()).sum();

    // Many acked appends through the real path, with NO checkpoint ever driven.
    // Each `append_acked` only returns 2xx after `wait_durable` — so the ack path
    // is provably gated on the committer's durable_lsn, not on checkpoint.
    for i in 0..32u64 {
        let rec = format!("payload-{i:04}|").into_bytes();
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            append_acked(&h.store, "s", OCTET, &rec),
        )
        .await
        .expect("appends ack with NO checkpoint having run (non-blocking)");
    }

    let size1: u64 = h.walset.shards().iter().map(|s| s.wal_size_bytes()).sum();
    assert!(
        size1 >= size0,
        "WAL size_bytes does not shrink without a checkpoint (got {size0} → {size1})"
    );
    // And the on-disk segment is retained (not recycled, since no checkpoint ran).
    assert!(
        h.walset.shards()[0].wal_segments() >= 1,
        "WAL segment retained without a checkpoint"
    );

    h.crash();
    let _ = std::fs::remove_dir_all(&dir);
}

// ===========================================================================
// (6) CARRIED Task-5 nit: drive the FULL HTTP handler path for a FORKED stream
//     (file_base > 0) and assert the recovered data is correct (spec §13/§9).
// ===========================================================================

/// Closes the Task-5 gap: the forked-offset durability test drove the
/// `write_wire` + `maybe_sync_on_ack` helpers directly. This drives the genuine
/// HTTP path end-to-end — `PUT` a fork (file_base > 0), `POST` records to it,
/// then crash + recover — and asserts the recovered fork data is byte-correct.
/// This exercises the LOGICAL `stream_offset = file_base + file-relative` mapping
/// the handler computes and recovery's `file_pos = stream_offset − file_base`
/// inversion, over the real wire.
#[tokio::test]
async fn e2e_forked_stream_full_http_path_recovers_correctly() {
    let _guard = DurabilityGuard::wal();
    let dir = tmp("forked-http");

    let h = Harness::boot(&dir, Some(2), 2).unwrap();

    // Parent with 10 bytes, fork at offset 7 → fork file_base = 7.
    create_stream(&h.store, "p", OCTET).await;
    append_acked(&h.store, "p", OCTET, b"ABCDEFGHIJ").await;
    let resp = handlers::handle(
        Arc::clone(&h.store),
        put_req(
            "f",
            OCTET,
            b"",
            &[("stream-forked-from", "p"), ("stream-fork-offset", &fork_offset(7))],
        ),
    )
    .await;
    assert!((200..300).contains(&resp.status), "fork create got {}", resp.status);
    let child = h.store.get("f").unwrap();
    assert_eq!(child.shared.read().unwrap().file_base, 7, "fork file_base = 7");
    drop(child);

    // Append records to the fork through the REAL POST path. The handler computes
    // stream_offset = file_base(7) + file-relative pre-offset, and stages THAT
    // logical offset into the WAL; recovery inverts it back to file pos.
    append_acked(&h.store, "f", OCTET, b"forkrec1|").await;
    append_acked(&h.store, "f", OCTET, b"forkrec2|").await;
    let expected: &[u8] = b"forkrec1|forkrec2|"; // file-relative bytes (file pos 0..)
    assert_eq!(stream_file_bytes(&h.store, "f"), expected, "fork file before crash");

    h.crash();

    // Reopen: recovery must place the fork's WAL payloads at file pos
    // (stream_offset − file_base), reconstructing exactly the fork-relative bytes.
    let h2 = Harness::boot(&dir, None, 2).unwrap();
    let got = stream_file_bytes(&h2.store, "f");
    assert_eq!(
        got, expected,
        "forked stream (file_base > 0) recovers byte-correct over the full HTTP path"
    );
    let child2 = h2.store.get("f").unwrap();
    assert_eq!(
        child2.tail().bytes,
        7 + expected.len() as u64,
        "fork tail = file_base + recovered bytes"
    );
    h2.crash();
    let _ = std::fs::remove_dir_all(&dir);
}

// ===========================================================================
// (7) COMPAT: strict-created data dir reopens WAL-only without data loss
// ===========================================================================

/// A data dir with per-stream files but NO `wal/` subtree (as a `strict`-era
/// deployment would have) reopens WAL-only without losing data. The WAL recovery
/// replays an empty WAL (no records → no truncations) and leaves the per-stream
/// files untouched. This is the characterization test that must PASS before the
/// WAL is made unconditional in main.rs.
#[tokio::test]
async fn strict_created_dir_reopens_wal_only_without_data_loss() {
    let _guard = DurabilityGuard::wal();
    use std::io::Write;
    let dir = tmp("strict-compat");

    // --- Phase 1: write data directly to per-stream files (no WAL), simulating
    // a strict-mode deployment. We bypass the HTTP handler and write directly
    // via the appender so no WAL is touched.
    {
        let store = Arc::new(
            crate::store::Store::new_with_tier(dir.clone(), crate::tier::TierConfig::default()).unwrap(),
        );
        let st = {
            let s = Arc::clone(&store);
            tokio::task::spawn_blocking(move || {
                s.create(
                    "s/keep",
                    crate::store::StreamConfig {
                        content_type: "application/octet-stream".into(),
                        ttl_seconds: None,
                        expires_at: None,
                        expires_at_raw: None,
                        create_closed: false,
                        forked_from: None,
                        fork_offset_raw: None,
                        fork_sub_offset: None,
                    },
                    None,
                    0,
                )
            })
            .await
            .unwrap()
            .unwrap()
        };
        let st = match st {
            crate::store::CreateResult::Created(s) => s,
            _ => panic!("create failed in Phase 1"),
        };
        // Append bytes directly to the per-stream file (no WAL).
        {
            let mut ap = st.appender.lock().await;
            (&*ap.file).write_all(b"hello-world").unwrap();
            ap.written += 11;
            let mut s = st.shared.write().unwrap();
            s.tail = s.file_base + ap.written;
        }
        // Persist the tail to the sidecar so recovery sees it on reopen.
        let st2 = Arc::clone(&st);
        tokio::task::spawn_blocking(move || crate::store::write_meta_sync(&st2, true))
            .await
            .unwrap()
            .unwrap();
        // A strict-era server predates the `durable_tail` sidecar proof — strip
        // the field the CURRENT writer emitted so the sidecar is byte-faithful
        // to what an old deployment left behind (recovery must fall back to
        // trusting the file size for such sidecars).
        let meta_path = crate::store::meta_path(&st.file_path);
        let mut v: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&meta_path).unwrap()).unwrap();
        v.as_object_mut().unwrap().remove("durable_tail");
        std::fs::write(&meta_path, serde_json::to_vec(&v).unwrap()).unwrap();
    }
    // Remove any wal/ subtree — a strict-era dir has none.
    std::fs::remove_dir_all(dir.join("wal")).ok();

    // --- Phase 2: reopen WAL-only (the exact main.rs startup sequence).
    let store = Arc::new(
        crate::store::Store::new_with_tier(dir.clone(), crate::tier::TierConfig::default()).unwrap(),
    );
    let walset = crate::wal::walset::WalSet::open(&dir, None, 1).unwrap();
    // An empty WAL replay must NOT truncate pre-existing per-stream data.
    crate::wal::recovery::recover(&store, &walset).unwrap();
    walset.reset_after_recovery().unwrap();
    store
        .wal
        .set(Arc::clone(&walset))
        .unwrap_or_else(|_| panic!("wal already set"));

    let st = store.get("s/keep").expect("stream must survive WAL-only reopen");
    let got = std::fs::read(&st.file_path).unwrap();
    assert_eq!(
        got,
        b"hello-world",
        "pre-WAL data must survive a WAL-only reopen without loss"
    );
    assert_eq!(
        st.tail().bytes,
        11,
        "recovered tail must equal the bytes written in Phase 1"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

// ===========================================================================
// (7b) MULTI-SEGMENT recovery: boot must not clobber sealed/recycled segments
// ===========================================================================

/// Acked records that live in WAL segments AFTER the first survive a crash.
///
/// With a small segment size, enough acked appends roll the WAL: `1.wal` is
/// SEALED (truncated to its exactly-packed length + fsync'd) and later records
/// land in `<n>.wal`. A crash + reboot must replay ALL retained segments.
///
/// Regression (sim seed 89837): `Shard::open` re-preallocated `1.wal` to full
/// segment size, so the sealed segment grew a zero tail; replay read that tail
/// as `Incomplete` (= end of the durable log) and silently dropped every
/// record in later segments — then `reconcile_tail` TRUNCATED the per-stream
/// files back to the stale frontier. Acked-data loss on the recovery path.
#[tokio::test]
async fn e2e_multi_segment_acked_records_after_first_seal_survive_crash() {
    let _guard = DurabilityGuard::wal();
    const SEG: u64 = 4096;
    let dir = tmp("multi-seg");

    let h = Harness::boot_with_segment_size(&dir, Some(1), 1, SEG).unwrap();
    create_stream(&h.store, "s", OCTET).await;

    // Append acked records until the shard has rolled at least once (≥2
    // on-disk segments), then a few more so the post-roll segment holds data.
    let mut expected = Vec::new();
    let mut i = 0usize;
    while h.walset.shards()[0].wal_segments() < 2 || i < 40 {
        let rec = format!("multi-seg-record-{i:04}|").into_bytes();
        append_acked(&h.store, "s", OCTET, &rec).await;
        expected.extend_from_slice(&rec);
        i += 1;
        assert!(i < 10_000, "never rolled a segment; check SEG/record sizing");
    }
    assert!(
        h.walset.shards()[0].wal_segments() >= 2,
        "test needs ≥2 retained segments"
    );

    h.crash();

    let h2 = Harness::boot_with_segment_size(&dir, None, 1, SEG).unwrap();
    let got = stream_file_bytes(&h2.store, "s");
    assert_eq!(
        got.len(),
        expected.len(),
        "every acked record recovers across ALL retained segments (lost {} bytes)",
        expected.len().saturating_sub(got.len())
    );
    assert_eq!(got, expected, "recovered bytes byte-identical across segment seams");
    h2.crash();
    let _ = std::fs::remove_dir_all(&dir);
}

/// Acked records recover when `1.wal` was RECYCLED (checkpoint deleted it and
/// the oldest retained segment starts at lsn > 1).
///
/// Regression (same root cause, worse case): `Shard::open` unconditionally
/// created a fresh, all-zero `1.wal`. Replay walked segments in start-lsn
/// order, began with the spurious zero-filled `1.wal`, decoded `Incomplete` at
/// offset 0, and treated that as the end of the durable log — replaying
/// NOTHING. Every acked record after the last checkpoint was truncated away.
#[tokio::test]
async fn e2e_recycled_first_segment_acked_records_survive_crash() {
    let _guard = DurabilityGuard::wal();
    const SEG: u64 = 4096;
    let dir = tmp("recycled-first");

    let h = Harness::boot_with_segment_size(&dir, Some(1), 1, SEG).unwrap();
    create_stream(&h.store, "s", OCTET).await;

    // Phase 1: roll past 1.wal, then checkpoint → sealed segments fully below
    // the floor (including 1.wal) are recycled (deleted).
    let mut expected = Vec::new();
    let mut i = 0usize;
    while h.walset.shards()[0].wal_segments() < 3 {
        let rec = format!("pre-ckpt-{i:04}|").into_bytes();
        append_acked(&h.store, "s", OCTET, &rec).await;
        expected.extend_from_slice(&rec);
        i += 1;
        assert!(i < 10_000, "never rolled; check SEG/record sizing");
    }
    h.walset.shards()[0].checkpoint().await.unwrap();
    assert!(
        !dir.join("wal").join("0").join("1.wal").exists(),
        "checkpoint recycled 1.wal (else this test is vacuous)"
    );

    // Phase 2: more ACKED records after the checkpoint (they live only in the
    // WAL + page cache; the checkpoint that would fsync them never runs).
    for j in 0..25usize {
        let rec = format!("post-ckpt-{j:04}|").into_bytes();
        append_acked(&h.store, "s", OCTET, &rec).await;
        expected.extend_from_slice(&rec);
    }

    h.crash();

    let h2 = Harness::boot_with_segment_size(&dir, None, 1, SEG).unwrap();
    let got = stream_file_bytes(&h2.store, "s");
    assert_eq!(
        got.len(),
        expected.len(),
        "post-checkpoint acked records recover from the retained (recycle-survivor) segments"
    );
    assert_eq!(got, expected, "recovered bytes byte-identical");
    h2.crash();
    let _ = std::fs::remove_dir_all(&dir);
}

/// `--stream-lanes N`: stream data files hash across `streams/<0..N>/` subdirs
/// (one per device in the intended deployment — the ~1M-stream writeback-wall
/// fix). Crash recovery must find every file in its lane dir, and the
/// checkpoint's per-lane syncfs must preserve durability-before-recycle exactly
/// as the single-lane layout does. Guarded by DurabilityGuard (serialized) since
/// stream-lanes is process-global state; reset to 1 before releasing the guard.
#[tokio::test]
async fn e2e_stream_lanes_recover_acked_records() {
    let _guard = DurabilityGuard::wal();
    crate::store::set_stream_lanes(3);
    const SEG: u64 = 4096;
    let dir = tmp("stream-lanes");

    let h = Harness::boot_with_segment_size(&dir, Some(1), 1, SEG).unwrap();
    // Enough streams that the FNV lane hash populates more than one lane.
    let names: Vec<String> = (0..12).map(|i| format!("lane-s{i}")).collect();
    for n in &names {
        create_stream(&h.store, n, OCTET).await;
    }
    let mut expected: std::collections::HashMap<String, Vec<u8>> = Default::default();
    for round in 0..40usize {
        for n in &names {
            let rec = format!("{n}-r{round:03}|").into_bytes();
            append_acked(&h.store, n, OCTET, &rec).await;
            expected.entry(n.clone()).or_default().extend_from_slice(&rec);
        }
    }
    // Checkpoint (per-lane syncfs + recycle), then more acked appends on top.
    h.walset.shards()[0].checkpoint().await.unwrap();
    for n in &names {
        let rec = format!("{n}-post|").into_bytes();
        append_acked(&h.store, n, OCTET, &rec).await;
        expected.entry(n.clone()).or_default().extend_from_slice(&rec);
    }

    h.crash();

    let h2 = Harness::boot_with_segment_size(&dir, None, 1, SEG).unwrap();
    // Layout sanity: files actually spread across lane subdirs.
    let lanes_used = (0..3)
        .filter(|l| {
            std::fs::read_dir(dir.join("streams").join(l.to_string()))
                .map(|d| d.flatten().next().is_some())
                .unwrap_or(false)
        })
        .count();
    assert!(lanes_used >= 2, "expected streams spread over lanes, got {lanes_used}");
    for n in &names {
        let got = stream_file_bytes(&h2.store, n);
        assert_eq!(
            &got,
            expected.get(n).unwrap(),
            "stream {n} recovers byte-identical across lanes"
        );
    }
    h2.crash();
    // Layout-mismatch guard: reopening this 3-lane dir with a different lane
    // count must be REFUSED (persisted `.lanes` marker) — a silent mismatch
    // would make every existing stream invisible.
    crate::store::set_stream_lanes(2);
    let err = Store::new_with_tier(dir.clone(), TierConfig::default())
        .err()
        .expect("opening a 3-lane layout with --stream-lanes 2 must fail");
    assert!(
        err.to_string().contains("stream-lanes"),
        "mismatch error should name the knob: {err}"
    );
    crate::store::set_stream_lanes(1);
    let _ = std::fs::remove_dir_all(&dir);
}

/// Cardinality-cliff #1: with `--wal-checkpoint-syncfs on`, the checkpoint makes
/// touched per-stream files durable via ONE `syncfs()` barrier instead of the
/// per-stream `fdatasync` loop. This must preserve the durability-before-recycle
/// guarantee: after a checkpoint recycles the WAL, acked records (both those below
/// the checkpoint floor, made durable by `syncfs`, and those appended after) must
/// still recover byte-identically. On Linux this exercises the real `syncfs` path;
/// on other targets the code falls back to the per-stream loop (still correct).
#[tokio::test]
async fn e2e_checkpoint_syncfs_recovers_acked_records() {
    let _guard = DurabilityGuard::wal();
    const SEG: u64 = 4096;
    let dir = tmp("syncfs-ckpt");

    let h = Harness::boot_with_segment_size(&dir, Some(1), 1, SEG).unwrap();
    create_stream(&h.store, "s", OCTET).await;

    let mut expected = Vec::new();
    // Enough records + small segments to force at least one roll, so the checkpoint
    // actually recycles a fully-below-floor segment (relying on the syncfs'd file).
    for i in 0..400usize {
        let rec = format!("syncfs-{i:04}|").into_bytes();
        append_acked(&h.store, "s", OCTET, &rec).await;
        expected.extend_from_slice(&rec);
    }
    // Force the checkpoint → syncfs barrier → recycle.
    h.walset.shards()[0].checkpoint().await.unwrap();
    // More acked appends after the checkpoint (live segment).
    for i in 400..500usize {
        let rec = format!("syncfs-{i:04}|").into_bytes();
        append_acked(&h.store, "s", OCTET, &rec).await;
        expected.extend_from_slice(&rec);
    }

    h.crash();

    let h2 = Harness::boot_with_segment_size(&dir, None, 1, SEG).unwrap();
    let got = stream_file_bytes(&h2.store, "s");
    assert_eq!(
        got, expected,
        "syncfs-checkpoint acked records recover byte-identical (durability-before-recycle held)"
    );
    h2.crash();
    let _ = std::fs::remove_dir_all(&dir);
}

// ===========================================================================
// (7c) WAL-QUIET stream: torn unacked tail truncated via the sidecar proof
// ===========================================================================

/// A stream with NO durable WAL record and NO checkpoint `tails` entry (created
/// after the last checkpoint; its only append was in-flight at the crash) must
/// still have its torn, never-acked page-cache tail truncated on recovery.
///
/// Regression (sim seed 20230): with the WAL bytes for the in-flight append
/// torn by power loss and its data-file bytes partially persisted, recovery had
/// NO truncation proof for the stream — the sidecar pass trusted
/// `tail = file size` and exposed the torn fragment to readers (the exact C1
/// shape the WAL exists to prevent). The sidecar now persists a `durable_tail`
/// proof (fsynced at create/close, refreshed at checkpoint + recovery), and
/// recovery seeds every stream's frontier from it.
#[tokio::test]
async fn e2e_wal_quiet_stream_torn_unacked_tail_truncated() {
    let _guard = DurabilityGuard::wal();
    let dir = tmp("quiet-torn");

    let mut h = Harness::boot(&dir, Some(1), 1).unwrap();

    // An earlier checkpointed stream so the shard's tails file is non-empty
    // (proves the fix is not just "empty tails == reconcile everything").
    create_stream(&h.store, "older", OCTET).await;
    append_acked(&h.store, "older", OCTET, b"older-rec|").await;
    h.walset.shards()[0].checkpoint().await.unwrap();

    // The WAL-quiet stream: created AFTER the checkpoint, never acked an append.
    create_stream(&h.store, "fresh", OCTET).await;

    // Its only append is in-flight at the crash: bytes reached the data file's
    // page cache and the WAL staging buffer, but the committer never fsync'd
    // (stop it first), so no ack was ever released.
    h.stop_committers();
    let st = h.store.get("fresh").unwrap();
    let torn: &[u8] = b"TORN-IN-FLIGHT-NEVER-ACKED";
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().append(true).open(&st.file_path).unwrap();
        f.write_all(torn).unwrap();
        f.sync_all().unwrap(); // even fully-persisted: still un-acked, must go
    }
    let shard = h.walset.shard_for(st.id).clone();
    shard
        .reserve_and_stage(crate::wal::codec::RecordKind::Append, st.id, 0, torn)
        .unwrap();
    // Power loss tears the staged (never-fdatasync'd) WAL record: zero it out.
    // Everything at/above this record was never covered by an ack.
    {
        use std::io::{Seek, SeekFrom, Write};
        let seg = crate::wal::segment::seg_path(&dir.join("wal").join("0"), 1);
        let len = std::fs::metadata(&seg).unwrap().len();
        let mut f = std::fs::OpenOptions::new().write(true).open(&seg).unwrap();
        // The quiet stream's record is the LAST staged record; zeroing the whole
        // segment suffix past the durable prefix models its loss. Find the
        // offset by decoding up to the first record for `st.id`.
        let bytes = std::fs::read(&seg).unwrap();
        let mut off = 0usize;
        while let crate::wal::codec::Decoded::Record { stream_id, total, .. } =
            crate::wal::codec::decode_at(&bytes, off)
        {
            if stream_id == st.id {
                break;
            }
            off += total;
        }
        f.seek(SeekFrom::Start(off as u64)).unwrap();
        f.write_all(&vec![0u8; (len as usize) - off]).unwrap();
        f.sync_all().unwrap();
    }

    drop(st);
    let store = h.store;
    let walset = h.walset;
    drop(store);
    drop(walset);

    // Reopen: recovery must truncate the torn tail even though the stream has
    // zero surviving WAL records and no tails entry — the sidecar's durable_tail
    // proof (0, persisted at create) is the seed.
    let h2 = Harness::boot(&dir, None, 1).unwrap();
    let got = stream_file_bytes(&h2.store, "fresh");
    assert_eq!(
        got,
        b"",
        "torn un-acked tail truncated on a WAL-quiet stream (sidecar durable_tail proof)"
    );
    let st2 = h2.store.get("fresh").unwrap();
    assert_eq!(st2.tail().bytes, 0, "tail reconciled to the durable frontier (0)");
    // The checkpointed stream is untouched.
    assert_eq!(stream_file_bytes(&h2.store, "older"), b"older-rec|");
    h2.crash();
    let _ = std::fs::remove_dir_all(&dir);
}

// ===========================================================================
// (7d) DELETE ack durability: an acked DELETE survives a crash
// ===========================================================================

/// The 204 for DELETE is a durability promise. Regression (sim seed 20387):
/// `handle_delete` acked while the file + sidecar unlinks ran on a DETACHED
/// blocking task — a crash right after the ack (before the task ran) left both
/// files on disk and the stream RESURRECTED with all its data on reboot. The
/// unlinks (+ parent-dir fsync) are now awaited before the 204.
#[tokio::test]
async fn e2e_acked_delete_is_durable_no_resurrection_after_crash() {
    let _guard = DurabilityGuard::wal();
    let dir = tmp("delete-durable");

    let h = Harness::boot(&dir, Some(1), 1).unwrap();
    create_stream(&h.store, "victim", OCTET).await;
    append_acked(&h.store, "victim", OCTET, b"doomed-data|").await;
    let file_path = h.store.get("victim").unwrap().file_path.clone();
    let meta = crate::store::meta_path(&file_path);

    let resp = handlers::handle(
        Arc::clone(&h.store),
        Req {
            method: Method::Delete,
            path: "victim".into(),
            query: None,
            headers: vec![],
            body: Bytes::new(),
        },
    )
    .await;
    assert_eq!(resp.status, 204, "delete acked");
    // The ack IS the durability point: both on-disk artifacts are already gone
    // when the response returns (not on some detached task's schedule).
    assert!(!file_path.exists(), "data file removed before the DELETE ack");
    assert!(!meta.exists(), "meta sidecar removed before the DELETE ack");

    // Crash + reboot: the stream must not resurrect.
    h.crash();
    let h2 = Harness::boot(&dir, None, 1).unwrap();
    assert!(
        h2.store.get("victim").is_none(),
        "acked-deleted stream must not resurrect after a crash"
    );
    h2.crash();
    let _ = std::fs::remove_dir_all(&dir);
}

// ===========================================================================
// (8) MEMORY-MODE sidecar recovery (no WAL)
// ===========================================================================

/// In `memory` mode there is no WAL: appends write to the per-stream file
/// (buffered) and ack on the page-cache write. On restart the server rebuilds
/// state from the per-stream files + `.meta` sidecars (the existing sidecar
/// pass that also runs in `wal` mode). This test confirms that a memory-mode
/// server's data is present after a simulated restart — the Store reopen runs
/// the sidecar pass and the stream is fully accessible.
///
/// This is host-runnable: it exercises the plain file I/O path (no splice, no
/// Linux-only syscalls). The `DurabilityGuard::memory()` acquires the
/// serialization mutex so this test cannot race the durability-mode global
/// with other e2e tests.
#[tokio::test]
async fn memory_mode_data_survives_restart_via_sidecar() {
    let _guard = DurabilityGuard::memory();
    let dir = tmp("mem-sidecar");

    // Phase 1: create + append in memory mode (no WAL attached).
    {
        let store = Arc::new(
            Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap(),
        );
        // Do NOT attach a WalSet — memory mode has no WAL.
        create_stream(&store, "m/keep", OCTET).await;
        append_acked(&store, "m/keep", OCTET, b"survive-me").await;
        // `store` drops here without a WAL shutdown — simulates a restart.
    }

    // Phase 2: reopen — the sidecar pass rebuilds from the per-stream file +
    // `.meta`; no WAL to replay.
    let store2 = Arc::new(
        Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap(),
    );
    let st = store2.get("m/keep").expect("stream recovered from sidecar");
    let got = std::fs::read(&st.file_path).unwrap();
    assert_eq!(got, b"survive-me", "memory-mode data survives restart via sidecar pass");
    assert_eq!(
        st.tail().bytes,
        b"survive-me".len() as u64,
        "recovered tail == appended bytes"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
