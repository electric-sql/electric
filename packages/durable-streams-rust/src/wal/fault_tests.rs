//! Fault-injection recovery validation (DISPOSABLE BRANCH — never merge).
//!
//! Each scenario runs its workload in a CHILD PROCESS (re-exec of this test
//! binary with `DS_FAULT` + `DS_FAULT_DIR` set), because (a) the hardened
//! fail-stop paths call `std::process::abort()` for real, and (b) the fault
//! plan is env-driven and process-global — a child per scenario keeps plans
//! isolated. The child prints `ACKED:<payload>` after every acked append; the
//! parent asserts the exit status, then RECOVERS the child's data dir
//! in-process and checks the durability contract: every acked byte survives
//! (a prefix match — bytes staged-but-unacked at the kill MAY also survive; an
//! abort is not a power loss).

use std::io;
use std::process::Command;
use std::sync::Arc;

use bytes::Bytes;

use crate::api::{Method, Req};
use crate::handlers;
use crate::handlers::test_support::DurabilityGuard;
use crate::store::Store;
use crate::tier::TierConfig;
use crate::wal::shard::CommitterHandle;
use crate::wal::walset::WalSet;

const OCTET: &str = "application/octet-stream";
const SEG: u64 = 4096; // small segments so rolls happen quickly

// ---------- minimal harness (mirrors e2e_tests's; duplicated on purpose:
// this whole module is disposable) ----------

struct H {
    store: Arc<Store>,
    walset: Arc<WalSet>,
    committers: Vec<CommitterHandle>,
}

fn boot(dir: &std::path::Path) -> io::Result<H> {
    let walset = WalSet::open_with_segment_size(dir, Some(1), 1, SEG)?;
    let store = Arc::new(Store::new_with_tier(dir.to_path_buf(), TierConfig::default())?);
    crate::wal::recovery::recover(&store, &walset)?;
    walset.reset_after_recovery()?;
    store.wal.set(Arc::clone(&walset)).unwrap_or_else(|_| panic!("wal attached"));
    let mut committers = Vec::new();
    for shard in walset.shards() {
        committers.push(shard.spawn_committer());
    }
    Ok(H { store, walset, committers })
}

impl H {
    fn crash(mut self) {
        for c in self.committers.drain(..) {
            c.stop();
        }
    }
}

fn req(method: Method, path: &str, body: &[u8]) -> Req {
    Req {
        method,
        path: path.to_string(),
        query: None,
        headers: vec![("content-type".to_string(), OCTET.to_string())],
        body: Bytes::copy_from_slice(body),
    }
}

async fn create(store: &Arc<Store>, path: &str) {
    let r = handlers::handle(Arc::clone(store), req(Method::Put, path, b"")).await;
    assert!((200..300).contains(&r.status), "create: {}", r.status);
}

/// Append; on 2xx record the acked payload to the ACK LOG. A raw `write` (not
/// buffered stdout) is used because the fail-stop paths call `abort()`, which
/// does NOT flush stdio buffers — the ack log's bytes reach the page cache
/// immediately and survive the abort (we are testing recovery, not power loss).
async fn append(store: &Arc<Store>, path: &str, body: &[u8]) -> u16 {
    let r = handlers::handle(Arc::clone(store), req(Method::Post, path, body)).await;
    if (200..300).contains(&r.status) {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(ack_log())
            .unwrap();
        f.write_all(body).unwrap();
        // Best-effort push past the libc buffer; File writes are already
        // unbuffered syscalls, so the bytes are in the page cache now.
        let _ = f.flush();
    }
    r.status
}

/// Path of the child's ack log (a sibling of the data dir, so recovery of the
/// data dir never trips over it).
fn ack_log() -> std::path::PathBuf {
    child_dir().with_extension("acklog")
}

fn stream_bytes(store: &Arc<Store>, path: &str) -> Vec<u8> {
    let st = store.get(path).unwrap_or_else(|| panic!("stream {path} missing after recovery"));
    std::fs::read(&st.file_path).unwrap()
}

// ---------- parent-side driver ----------

/// Spawn this test binary re-running `child` (an #[ignore] test) with the given
/// fault plan and a fresh data dir. Returns (success_exit, acked_concat, dir).
fn run_child(child: &str, fault: &str) -> (bool, Vec<u8>, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!(
        "ds-fault-{}-{}-{}",
        child.replace("::", "_"),
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    let ack_log = dir.with_extension("acklog");
    let _ = std::fs::remove_file(&ack_log);
    let out = Command::new(std::env::current_exe().unwrap())
        .args(["--test-threads=1", "--exact", child, "--ignored"])
        .env("DS_FAULT", fault)
        .env("DS_FAULT_DIR", &dir)
        .output()
        .expect("spawn child");
    // The ack log is the source of truth for "what the server acked" — written
    // by raw file writes so it survives the child's abort() (stdout does not).
    let acked = std::fs::read(&ack_log).unwrap_or_default();
    let _ = std::fs::remove_file(&ack_log);
    (out.status.success(), acked, dir)
}

/// Recover the child's dir and assert every acked byte survived (prefix match).
fn assert_acked_survive(dir: &std::path::Path, acked: &[u8], stream: &str) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let _guard = DurabilityGuard::wal();
        let h = boot(dir).expect("recovery boot");
        if acked.is_empty() {
            h.crash();
            return;
        }
        let got = stream_bytes(&h.store, stream);
        assert!(
            got.starts_with(acked),
            "acked bytes lost: recovered {} bytes, acked {} — recovered prefix {:?}…, acked {:?}…",
            got.len(),
            acked.len(),
            &got[..got.len().min(40)],
            &acked[..acked.len().min(40)]
        );
        h.crash();
    });
}

// ---------- children (invoked only via run_child; #[ignore]d otherwise) ----------

fn child_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var("DS_FAULT_DIR").expect("DS_FAULT_DIR"))
}

/// Child: append until the committer's fdatasync fault aborts the process.
#[tokio::test]
#[ignore = "fault child — run via parent"]
async fn child_commit_fsync_burst() {
    let _guard = DurabilityGuard::wal();
    let h = boot(&child_dir()).unwrap();
    create(&h.store, "s").await;
    for i in 0..200u32 {
        let body = format!("rec{i:04}|");
        let st = append(&h.store, "s", body.as_bytes()).await;
        if st >= 500 {
            println!("GOT500:{i}");
        }
    }
    // If the fault never fired we exit 0 — the parent treats that as a bug.
    h.crash();
}

/// Child: acked appends, then a checkpoint whose barrier faults (abort).
#[tokio::test]
#[ignore = "fault child — run via parent"]
async fn child_checkpoint_barrier() {
    let _guard = DurabilityGuard::wal();
    let h = boot(&child_dir()).unwrap();
    create(&h.store, "s").await;
    for i in 0..50u32 {
        append(&h.store, "s", format!("ck{i:04}|").as_bytes()).await;
    }
    // Barrier fault fires inside -> abort (never returns).
    let _ = h.walset.shards()[0].checkpoint().await;
    h.crash();
}

/// Child: small segments force a roll; the seal fault aborts at the roll.
#[tokio::test]
#[ignore = "fault child — run via parent"]
async fn child_seal_at_roll() {
    let _guard = DurabilityGuard::wal();
    let h = boot(&child_dir()).unwrap();
    create(&h.store, "s").await;
    for i in 0..400u32 {
        append(&h.store, "s", format!("seal{i:05}|").as_bytes()).await;
    }
    h.crash();
}

/// Child: checkpoint #1's tails write faults (plain Err, NO abort) — the
/// drained dirty set must be re-registered so checkpoint #2 persists the tails
/// proofs before the recycle that follows. Exits 0.
#[tokio::test]
#[ignore = "fault child — run via parent"]
async fn child_tails_write_then_retry() {
    let _guard = DurabilityGuard::wal();
    let h = boot(&child_dir()).unwrap();
    create(&h.store, "s").await;
    for i in 0..50u32 {
        append(&h.store, "s", format!("tl{i:04}|").as_bytes()).await;
    }
    let r1 = h.walset.shards()[0].checkpoint().await;
    assert!(r1.is_err(), "checkpoint #1 must fail on the injected tails fault");
    let r2 = h.walset.shards()[0].checkpoint().await;
    assert!(r2.is_ok(), "checkpoint #2 must succeed and re-cover the drained streams");
    h.crash();
}

/// Child: a short (partial) data-file write mid-burst — the append 500s, the
/// partial bytes are truncated, later appends stay correctly framed. Exits 0.
#[tokio::test]
#[ignore = "fault child — run via parent"]
async fn child_short_data_write() {
    let _guard = DurabilityGuard::wal();
    let h = boot(&child_dir()).unwrap();
    create(&h.store, "s").await;
    for i in 0..10u32 {
        let st = append(&h.store, "s", format!("dw{i:04}|").as_bytes()).await;
        if st >= 500 {
            println!("GOT500:{i}");
        }
    }
    h.crash();
}

// ---------- parent scenarios ----------

#[test]
fn fault_commit_fsync_abort_preserves_acked() {
    let (ok, acked, dir) = run_child(
        "wal::fault_tests::child_commit_fsync_burst",
        "wal-fsync:err:3",
    );
    assert!(!ok, "the injected committer fsync failure must abort the child");
    assert_acked_survive(&dir, &acked, "s");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fault_checkpoint_barrier_abort_preserves_acked() {
    let (ok, acked, dir) = run_child(
        "wal::fault_tests::child_checkpoint_barrier",
        "ckpt-barrier:err:1",
    );
    assert!(!ok, "the injected checkpoint barrier failure must abort the child");
    assert!(!acked.is_empty(), "child acked appends before the checkpoint");
    assert_acked_survive(&dir, &acked, "s");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fault_seal_abort_preserves_acked() {
    let (ok, acked, dir) = run_child("wal::fault_tests::child_seal_at_roll", "seal:err:1");
    assert!(!ok, "the injected seal failure must abort the child at the first roll");
    assert!(!acked.is_empty(), "child acked appends before the roll");
    assert_acked_survive(&dir, &acked, "s");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fault_tails_write_error_recovers_via_reregistration() {
    let (ok, acked, dir) = run_child(
        "wal::fault_tests::child_tails_write_then_retry",
        "tails-write:err:1",
    );
    assert!(ok, "tails-write fault is a plain error path; the child exits clean");
    assert!(!acked.is_empty());
    // Checkpoint #2 recycled the WAL; recovery now depends on the tails proofs
    // that only exist because the failed checkpoint re-registered its dirty set.
    assert_acked_survive(&dir, &acked, "s");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fault_short_data_write_rolls_back_cleanly() {
    let (ok, acked, dir) = run_child(
        "wal::fault_tests::child_short_data_write",
        "data-write:short:4",
    );
    assert!(ok, "short data write is a rolled-back 500; the child exits clean");
    assert!(!acked.is_empty());
    // The recovered file must contain EXACTLY the acked records — the injected
    // partial bytes must not appear between them (offset desync check).
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let _guard = DurabilityGuard::wal();
        let h = boot(&dir).unwrap();
        let got = stream_bytes(&h.store, "s");
        assert_eq!(
            got, acked,
            "recovered bytes must be exactly the acked records — no partial-write garbage"
        );
        h.crash();
    });
    let _ = std::fs::remove_dir_all(&dir);
}
