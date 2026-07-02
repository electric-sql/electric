//! Randomized crash/recovery simulation — a seeded fuzz harness for the WAL
//! recovery path. Design: docs/superpowers/specs/2026-07-02-wal-crash-simulation-design.md
//!
//! Each seed drives the REAL handler path (`handlers::handle`) with a random
//! workload (creates, appends, cancelled appends, closes, forks, deletes,
//! checkpoints), then simulates a crash by dropping the generation's tokio
//! runtime (aborting in-flight requests at whatever await point they reached),
//! stopping the committers, and optionally injecting disk faults constrained to
//! the documented fault model:
//!
//! - per-stream data files are fsynced only at checkpoint / recovery repair, so
//!   any byte past a stream's known-fsynced floor may be truncated, scribbled,
//!   or zero-extended (power loss / torn page writeback);
//! - WAL segment bytes belonging to records with `lsn > durable_lsn` at crash
//!   time were never fdatasync'd (no ack was released for them), so a random
//!   suffix of that region may be zeroed or scribbled.
//!
//! It then re-runs the real boot sequence (`WalSet::open` → sidecar pass →
//! `wal::recovery::recover` → `reset_after_recovery`) and checks the oracle:
//! every ACKED record is present, in order, whole; maybe-applied (cancelled /
//! in-flight-at-crash) records are each present-whole or absent; no torn or
//! foreign bytes; tails/file_base/closed-ness consistent; deleted streams stay
//! deleted; recovery itself never errors or panics. Multiple generations per
//! seed continue the workload on the recovered store to catch
//! recovery-of-recovery bugs.
//!
//! Reproduce a failure with the seed printed in the panic message:
//! `DS_SIM_SEED0=<seed> DS_SIM_SEEDS=1 cargo test crash_recovery_randomized`.
//! Scale the hunt with `DS_SIM_SEEDS` / `DS_SIM_GENS` / `DS_SIM_STEPS`.

use std::path::PathBuf;
use std::sync::Arc;

use bytes::Bytes;

use crate::api::{Method, Req};
use crate::handlers;
use crate::handlers::test_support::DurabilityGuard;
use crate::store::Store;
use crate::tier::TierConfig;
use crate::wal::codec::{decode_at, Decoded, RecordKind};
use crate::wal::shard::CommitterHandle;
use crate::wal::walset::WalSet;

/// Small segments so the workload rolls + recycles segments (the recovery paths
/// with the most history of bugs). Must comfortably exceed the largest payload
/// (8 KiB) + header.
const SEG_BYTES: u64 = 32 * 1024;

// ---------------------------------------------------------------------------
// Deterministic PRNG (splitmix64) — no dev-dependency on `rand`.
// ---------------------------------------------------------------------------

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed)
    }
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next_u64() % n
        }
    }
    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }
    fn alnum(&mut self, len: usize) -> String {
        const CS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
        (0..len)
            .map(|_| CS[self.below(CS.len() as u64) as usize] as char)
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Oracle model
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum RecStatus {
    /// 2xx ack observed — must survive every crash, byte-identical, in order.
    Acked,
    /// Cancelled / in-flight at crash / staged-at-crash — may be present
    /// (whole) or absent, never torn.
    Maybe,
}

struct Rec {
    wire: Vec<u8>,
    status: RecStatus,
    seq: u64,
}

struct SModel {
    name: String,
    json: bool,
    file_base: u64,
    file_path: PathBuf,
    id: u64,
    recs: Vec<Rec>,
    next_seq: u64,
    closed: bool,
    deleted: bool,
    has_children: bool,
    /// Any `Maybe` rec not yet resolved by a recovery (blocks forking, whose
    /// offset must be a known record boundary).
    unsettled: bool,
    /// Logical tail known fsynced into the data file (checkpoint or recovery
    /// repair). Data-file faults may only touch bytes at/after this point.
    floor: u64,
}

impl SModel {
    /// Record-boundary offsets (logical): file_base, then after each rec.
    /// Only meaningful when `!unsettled` (every rec known present).
    fn boundaries(&self) -> Vec<u64> {
        let mut v = vec![self.file_base];
        let mut acc = self.file_base;
        for r in &self.recs {
            acc += r.wire.len() as u64;
            v.push(acc);
        }
        v
    }
}

// ---------------------------------------------------------------------------
// Request builders (same shapes as e2e_tests.rs)
// ---------------------------------------------------------------------------

fn put_req(path: &str, content_type: &str, extra: &[(&str, &str)]) -> Req {
    let mut headers = vec![("content-type".to_string(), content_type.to_string())];
    for (k, v) in extra {
        headers.push((k.to_string(), v.to_string()));
    }
    Req {
        method: Method::Put,
        path: path.to_string(),
        query: None,
        headers,
        body: Bytes::new(),
    }
}

fn post_req(path: &str, content_type: &str, body: &[u8], extra: &[(&str, &str)]) -> Req {
    let mut headers = vec![("content-type".to_string(), content_type.to_string())];
    for (k, v) in extra {
        headers.push((k.to_string(), v.to_string()));
    }
    Req {
        method: Method::Post,
        path: path.to_string(),
        query: None,
        headers,
        body: Bytes::copy_from_slice(body),
    }
}

fn delete_req(path: &str) -> Req {
    Req {
        method: Method::Delete,
        path: path.to_string(),
        query: None,
        headers: vec![],
        body: Bytes::new(),
    }
}

fn fork_offset(bytes: u64) -> String {
    format!("{:016}_{:016}", 0, bytes)
}

const OCTET: &str = "application/octet-stream";
const JSON_CT: &str = "application/json";

// ---------------------------------------------------------------------------
// Simulation driver
// ---------------------------------------------------------------------------

struct Sim {
    seed: u64,
    rng: Rng,
    dir: PathBuf,
    shards_n: usize,
    models: Vec<SModel>,
    name_ctr: u64,
    gen: u64,
    log: Vec<String>,
}

impl Sim {
    fn note(&mut self, s: String) {
        self.log.push(s);
    }

    fn fail(&self, msg: String) -> ! {
        let tail: Vec<&String> = self.log.iter().rev().take(40).collect();
        let mut trace = String::new();
        for l in tail.into_iter().rev() {
            trace.push_str(l);
            trace.push('\n');
        }
        panic!(
            "\n=== SIM ORACLE VIOLATION ===\nseed={} gen={} dir={}\n{}\n--- last steps ---\n{}",
            self.seed,
            self.gen,
            self.dir.display(),
            msg,
            trace
        );
    }

    /// Build the next record for stream `mi` and return (payload, wire).
    /// `wire` is the exact on-disk/read-surface byte image (JSON gets the `,`
    /// delimiter `encode_wire` appends).
    fn make_record(&mut self, mi: usize) -> (Vec<u8>, Vec<u8>) {
        let seq = self.models[mi].next_seq;
        self.models[mi].next_seq += 1;
        let r = self.rng.below(100);
        let fill_len = if r < 60 {
            self.rng.below(120) as usize
        } else if r < 90 {
            120 + self.rng.below(800) as usize
        } else if r < 99 {
            1024 + self.rng.below(4096) as usize
        } else {
            8192
        };
        let filler = self.rng.alnum(fill_len);
        let name = self.models[mi].name.clone();
        if self.models[mi].json {
            let payload = format!("{{\"s\":\"{name}\",\"i\":\"{seq:08}\",\"p\":\"{filler}\"}}").into_bytes();
            let mut wire = payload.clone();
            wire.push(b',');
            (payload, wire)
        } else {
            let payload = format!("{name}#{seq:08}|{filler}|").into_bytes();
            (payload.clone(), payload)
        }
    }

    fn push_rec(&mut self, mi: usize, wire: Vec<u8>, status: RecStatus) {
        let seq = self.models[mi].next_seq - 1;
        if status == RecStatus::Maybe {
            self.models[mi].unsettled = true;
        }
        self.models[mi].recs.push(Rec { wire, status, seq });
    }

    fn pick(&mut self, pred: impl Fn(&SModel) -> bool) -> Option<usize> {
        let idxs: Vec<usize> = self
            .models
            .iter()
            .enumerate()
            .filter(|(_, m)| pred(m))
            .map(|(i, _)| i)
            .collect();
        if idxs.is_empty() {
            None
        } else {
            Some(idxs[self.rng.below(idxs.len() as u64) as usize])
        }
    }
}

/// Boot the exact main.rs WAL startup sequence for `dir` (spec §9).
fn boot(
    dir: &std::path::Path,
    shards: Option<usize>,
    shards_n: usize,
) -> (Arc<Store>, Arc<WalSet>, Vec<CommitterHandle>) {
    let walset = WalSet::open_with_segment_size(dir, shards, shards_n, SEG_BYTES)
        .expect("WalSet::open must succeed");
    let store = Arc::new(
        Store::new_with_tier(dir.to_path_buf(), TierConfig::default()).expect("Store::new"),
    );
    crate::wal::recovery::recover(&store, &walset)
        .expect("recovery must not error on in-model faults");
    walset.reset_after_recovery().expect("reset_after_recovery");
    store
        .wal
        .set(Arc::clone(&walset))
        .unwrap_or_else(|_| panic!("WAL already attached"));
    let mut committers = Vec::new();
    for shard in walset.shards() {
        committers.push(shard.spawn_committer());
    }
    (store, walset, committers)
}

// ---------------------------------------------------------------------------
// Oracle verification
// ---------------------------------------------------------------------------

fn escape_snippet(b: &[u8]) -> String {
    b.iter()
        .take(120)
        .map(|&c| {
            if (0x20..0x7f).contains(&c) {
                (c as char).to_string()
            } else {
                format!("\\x{c:02x}")
            }
        })
        .collect()
}

/// Match the recovered file bytes against the model. Returns per-rec presence.
/// Greedy in-issue-order pass (Acked must match; Maybe may skip), then a
/// permutation pass for the crash-tail: leftover bytes must be some ordering of
/// skipped Maybe wires. Errors describe the violation.
fn match_stream(model: &SModel, bytes: &[u8]) -> Result<Vec<bool>, String> {
    let mut present = vec![false; model.recs.len()];
    let mut cursor = 0usize;
    let mut skipped: Vec<usize> = Vec::new();
    for (i, rec) in model.recs.iter().enumerate() {
        if bytes[cursor..].starts_with(&rec.wire) {
            cursor += rec.wire.len();
            present[i] = true;
        } else {
            match rec.status {
                RecStatus::Acked => {
                    return Err(format!(
                        "LOST/CORRUPT ACKED record seq={} ({} bytes) at file cursor {}.\n\
                         expected: {}\n\
                         found:    {}",
                        rec.seq,
                        rec.wire.len(),
                        cursor,
                        escape_snippet(&rec.wire),
                        escape_snippet(&bytes[cursor.min(bytes.len())..])
                    ));
                }
                RecStatus::Maybe => skipped.push(i),
            }
        }
    }
    // Crash-tail permutation: consume any remaining bytes as whole skipped
    // Maybe records, in any order.
    while cursor < bytes.len() {
        let mut matched = false;
        for &i in &skipped {
            if !present[i] && bytes[cursor..].starts_with(&model.recs[i].wire) {
                cursor += model.recs[i].wire.len();
                present[i] = true;
                matched = true;
                break;
            }
        }
        if !matched {
            return Err(format!(
                "TORN/FOREIGN bytes at file cursor {} ({} bytes remain of {} total):\n{}",
                cursor,
                bytes.len() - cursor,
                bytes.len(),
                escape_snippet(&bytes[cursor..])
            ));
        }
    }
    Ok(present)
}

/// Full post-recovery oracle over every model. Updates each model to the
/// settled post-recovery truth (present Maybe → Acked; absent Maybe dropped;
/// floor = recovered frontier, which recovery fdatasync'd).
fn verify_recovery(sim: &mut Sim, store: &Arc<Store>) {
    for mi in 0..sim.models.len() {
        let (name, deleted) = (sim.models[mi].name.clone(), sim.models[mi].deleted);
        if deleted {
            if let Some(st) = store.get(&name) {
                let soft = st.shared.read().unwrap().soft_deleted;
                if !soft {
                    sim.fail(format!("stream {name}: DELETED stream resurrected after recovery"));
                }
            }
            continue;
        }
        let Some(st) = store.get(&name) else {
            sim.fail(format!("stream {name}: acked-created stream MISSING after recovery"));
        };
        let bytes = std::fs::read(&st.file_path).unwrap_or_else(|e| {
            sim.fail(format!("stream {name}: cannot read data file after recovery: {e}"))
        });

        // File/base/tail consistency.
        let (file_base, durable_tail, tail) = {
            let s = st.shared.read().unwrap();
            (s.file_base, s.durable_tail, s.tail)
        };
        if file_base != sim.models[mi].file_base {
            sim.fail(format!(
                "stream {name}: file_base changed across recovery: expected {}, got {file_base}",
                sim.models[mi].file_base
            ));
        }
        if tail != file_base + bytes.len() as u64 {
            sim.fail(format!(
                "stream {name}: Shared.tail {tail} != file_base {file_base} + file_len {}",
                bytes.len()
            ));
        }
        if durable_tail != tail {
            sim.fail(format!(
                "stream {name}: durable_tail {durable_tail} != tail {tail} after recovery"
            ));
        }
        let watch_tail = st.tail();
        if watch_tail.bytes != tail {
            sim.fail(format!(
                "stream {name}: watch tail {} != Shared.tail {tail} after recovery",
                watch_tail.bytes
            ));
        }

        // Closed-ness durability.
        if sim.models[mi].closed && !watch_tail.closed {
            sim.fail(format!(
                "stream {name}: close was ACKED but stream recovered open"
            ));
        }

        // Content: acked ⊆ recovered ⊆ issued, in order, whole records only.
        let present = match match_stream(&sim.models[mi], &bytes) {
            Ok(p) => p,
            Err(e) => sim.fail(format!("stream {name}: {e}")),
        };

        // JSON read-surface validity.
        if sim.models[mi].json && !bytes.is_empty() {
            let text = String::from_utf8(bytes.clone()).unwrap_or_else(|_| {
                sim.fail(format!("stream {name}: JSON stream contains non-UTF8 bytes"))
            });
            let wrapped = format!("[{}]", text.trim_end_matches(','));
            if let Err(e) = serde_json::from_str::<serde_json::Value>(&wrapped) {
                sim.fail(format!(
                    "stream {name}: recovered JSON read surface invalid: {e}\n{}",
                    escape_snippet(&bytes)
                ));
            }
        }

        // Settle the model to post-recovery truth.
        let m = &mut sim.models[mi];
        let mut kept = Vec::new();
        for (i, mut r) in std::mem::take(&mut m.recs).into_iter().enumerate() {
            if present[i] {
                r.status = RecStatus::Acked; // durable now (recovery fdatasync'd the repair)
                kept.push(r);
            }
        }
        m.recs = kept;
        m.unsettled = false;
        m.floor = file_base + bytes.len() as u64;
        m.id = st.id;
        m.file_path = st.file_path.clone();
    }
}

// ---------------------------------------------------------------------------
// Fault injection (crash-time, constrained to the fault model)
// ---------------------------------------------------------------------------

/// Data-file power-loss faults: any byte at/after the stream's fsynced floor
/// may be truncated away, scribbled, or the file zero-extended (size-metadata
/// committed before data pages).
fn inject_data_file_faults(sim: &mut Sim) {
    for mi in 0..sim.models.len() {
        if sim.models[mi].deleted || !sim.rng.chance(35) {
            continue;
        }
        let path = sim.models[mi].file_path.clone();
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        let len = meta.len();
        let floor_pos = sim.models[mi].floor.saturating_sub(sim.models[mi].file_base);
        let kind = sim.rng.below(3);
        let name = sim.models[mi].name.clone();
        match kind {
            0 => {
                // Truncate to a random point in [floor_pos, len].
                if len <= floor_pos {
                    continue;
                }
                let to = floor_pos + sim.rng.below(len - floor_pos + 1);
                let f = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
                f.set_len(to).unwrap();
                sim.note(format!("FAULT data-trunc {name}: {len} -> {to} (floor_pos {floor_pos})"));
            }
            1 => {
                // Scribble garbage over a random subrange of [floor_pos, len).
                if len <= floor_pos {
                    continue;
                }
                let start = floor_pos + sim.rng.below(len - floor_pos);
                let max = (len - start).min(256);
                let glen = 1 + sim.rng.below(max) as usize;
                let garbage: Vec<u8> = (0..glen).map(|_| sim.rng.next_u64() as u8).collect();
                use std::io::{Seek, SeekFrom, Write};
                let mut f = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
                f.seek(SeekFrom::Start(start)).unwrap();
                f.write_all(&garbage).unwrap();
                sim.note(format!(
                    "FAULT data-scribble {name}: [{start}, {}) of len {len} (floor_pos {floor_pos})",
                    start + glen as u64
                ));
            }
            _ => {
                // Zero-fill a subrange of the un-fsynced region: the size (inode)
                // update was committed but those data pages never flushed. The
                // file's LENGTH never grows — power loss cannot create bytes
                // beyond the maximum length ever written.
                if len <= floor_pos {
                    continue;
                }
                let start = floor_pos + sim.rng.below(len - floor_pos);
                let zlen = 1 + sim.rng.below(len - start) as usize;
                use std::io::{Seek, SeekFrom, Write};
                let mut f = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
                f.seek(SeekFrom::Start(start)).unwrap();
                f.write_all(&vec![0u8; zlen]).unwrap();
                sim.note(format!(
                    "FAULT data-zero {name}: [{start}, {}) of len {len} (floor_pos {floor_pos})",
                    start + zlen as u64
                ));
            }
        }
    }
}

/// WAL suffix faults: bytes of records with `lsn > durable` were never
/// fdatasync'd (nothing gated on them was acked), so a random suffix of that
/// region may be zeroed (lost pages) or scribbled (torn write).
fn inject_wal_faults(sim: &mut Sim, durable: &[u64]) {
    for (i, &d) in durable.iter().enumerate() {
        if !sim.rng.chance(50) {
            continue;
        }
        let shard_dir = sim.dir.join("wal").join(i.to_string());
        let Ok(rd) = std::fs::read_dir(&shard_dir) else { continue };
        let mut segs: Vec<(u64, PathBuf)> = rd
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                let stem = p.file_stem()?.to_str()?.parse::<u64>().ok()?;
                (p.extension()?.to_str()? == "wal").then_some((stem, p))
            })
            .collect();
        segs.sort();
        let Some((_, seg_path)) = segs.last() else { continue };
        let Ok(bytes) = std::fs::read(seg_path) else { continue };

        // Walk records: find the byte range [fault_from, logical_end) holding
        // records with lsn > durable.
        let mut off = 0usize;
        let mut fault_from: Option<usize> = None;
        loop {
            match decode_at(&bytes, off) {
                Decoded::Record { lsn, total, .. } => {
                    if lsn > d && fault_from.is_none() {
                        fault_from = Some(off);
                    }
                    off += total;
                }
                Decoded::Incomplete | Decoded::Torn => break,
            }
        }
        let logical_end = off;
        let Some(from) = fault_from else { continue };
        if from >= logical_end {
            continue;
        }
        let p = from as u64 + sim.rng.below((logical_end - from) as u64 + 1);
        if p as usize >= logical_end {
            continue;
        }
        use std::io::{Seek, SeekFrom, Write};
        let mut f = std::fs::OpenOptions::new().write(true).open(seg_path).unwrap();
        if sim.rng.chance(50) {
            // Zero from p to the end of the file's logical region (lost pages).
            let zeros = vec![0u8; logical_end - p as usize];
            f.seek(SeekFrom::Start(p)).unwrap();
            f.write_all(&zeros).unwrap();
            sim.note(format!(
                "FAULT wal-zero shard {i}: [{p}, {logical_end}) durable_lsn {d}"
            ));
        } else {
            let glen = 1 + sim.rng.below(64) as usize;
            let garbage: Vec<u8> = (0..glen).map(|_| sim.rng.next_u64() as u8 | 1).collect();
            f.seek(SeekFrom::Start(p)).unwrap();
            f.write_all(&garbage).unwrap();
            sim.note(format!(
                "FAULT wal-scribble shard {i}: [{p}, {}) durable_lsn {d}",
                p + glen as u64
            ));
        }
        f.sync_all().unwrap();
    }
}

// ---------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------

async fn ack_append(sim: &mut Sim, store: &Arc<Store>, mi: usize) {
    let (payload, wire) = sim.make_record(mi);
    let m = &sim.models[mi];
    let ct = if m.json { JSON_CT } else { OCTET };
    let name = m.name.clone();
    let resp = handlers::handle(Arc::clone(store), post_req(&name, ct, &payload, &[])).await;
    if !(200..300).contains(&resp.status) {
        sim.fail(format!(
            "append to open stream {name} rejected with {} (payload {} bytes)",
            resp.status,
            payload.len()
        ));
    }
    sim.note(format!("append {name} seq={} {}B acked", sim.models[mi].next_seq - 1, wire.len()));
    sim.push_rec(mi, wire, RecStatus::Acked);
}

async fn cancelled_append(sim: &mut Sim, store: &Arc<Store>, mi: usize) {
    let (payload, wire) = sim.make_record(mi);
    let m = &sim.models[mi];
    let ct = if m.json { JSON_CT } else { OCTET };
    let name = m.name.clone();
    let req = post_req(&name, ct, &payload, &[]);
    let jh = tokio::spawn(handlers::handle(Arc::clone(store), req));
    for _ in 0..sim.rng.below(4) {
        tokio::task::yield_now().await;
    }
    jh.abort();
    match jh.await {
        Ok(resp) if (200..300).contains(&resp.status) => {
            sim.note(format!("append {name} cancelled-but-acked ({}B)", wire.len()));
            sim.push_rec(mi, wire, RecStatus::Acked);
        }
        Ok(resp) => {
            sim.note(format!("append {name} cancelled, status {}", resp.status));
            sim.push_rec(mi, wire, RecStatus::Maybe);
        }
        Err(_) => {
            sim.note(format!("append {name} cancelled mid-flight ({}B) -> maybe", wire.len()));
            sim.push_rec(mi, wire, RecStatus::Maybe);
        }
    }
}

async fn run_generation(sim: &mut Sim, store: &Arc<Store>, walset: &Arc<WalSet>, steps: u64) {
    for _ in 0..steps {
        let op = sim.rng.below(100);
        match op {
            // ---- create ----
            _ if op < 8 && sim.models.len() < 20 => {
                let json = sim.rng.chance(40);
                let name = format!("sim-{}", sim.name_ctr);
                sim.name_ctr += 1;
                let ct = if json { JSON_CT } else { OCTET };
                let resp = handlers::handle(Arc::clone(store), put_req(&name, ct, &[])).await;
                if !(200..300).contains(&resp.status) {
                    sim.fail(format!("create {name} rejected: {}", resp.status));
                }
                let st = store.get(&name).unwrap_or_else(|| {
                    sim.fail(format!("create {name} acked but store.get is None"))
                });
                sim.note(format!("create {name} json={json}"));
                sim.models.push(SModel {
                    name,
                    json,
                    file_base: 0,
                    file_path: st.file_path.clone(),
                    id: st.id,
                    recs: Vec::new(),
                    next_seq: 0,
                    closed: false,
                    deleted: false,
                    has_children: false,
                    unsettled: false,
                    floor: 0,
                });
            }
            // ---- cancelled append (network drop) ----
            _ if op < 14 => {
                if let Some(mi) = sim.pick(|m| !m.deleted && !m.closed) {
                    cancelled_append(sim, store, mi).await;
                }
            }
            // ---- close ----
            _ if op < 18 => {
                if let Some(mi) = sim.pick(|m| !m.deleted && !m.closed) {
                    let name = sim.models[mi].name.clone();
                    let ct = if sim.models[mi].json { JSON_CT } else { OCTET };
                    let resp = handlers::handle(
                        Arc::clone(store),
                        post_req(&name, ct, b"", &[("stream-closed", "true")]),
                    )
                    .await;
                    if !(200..300).contains(&resp.status) {
                        sim.fail(format!("close {name} rejected: {}", resp.status));
                    }
                    sim.note(format!("close {name}"));
                    sim.models[mi].closed = true;
                }
            }
            // ---- fork ----
            _ if op < 22 && sim.models.len() < 20 => {
                if let Some(pi) = sim.pick(|m| !m.deleted && !m.unsettled) {
                    let bounds = sim.models[pi].boundaries();
                    let at = bounds[sim.rng.below(bounds.len() as u64) as usize];
                    let parent = sim.models[pi].name.clone();
                    let json = sim.models[pi].json;
                    let ct = if json { JSON_CT } else { OCTET };
                    let name = format!("sim-{}", sim.name_ctr);
                    sim.name_ctr += 1;
                    let resp = handlers::handle(
                        Arc::clone(store),
                        put_req(
                            &name,
                            ct,
                            &[
                                ("stream-forked-from", parent.as_str()),
                                ("stream-fork-offset", &fork_offset(at)),
                            ],
                        ),
                    )
                    .await;
                    if !(200..300).contains(&resp.status) {
                        sim.fail(format!(
                            "fork {name} from {parent}@{at} rejected: {}",
                            resp.status
                        ));
                    }
                    let st = store.get(&name).unwrap_or_else(|| {
                        sim.fail(format!("fork {name} acked but store.get is None"))
                    });
                    let fb = st.shared.read().unwrap().file_base;
                    if fb != at {
                        sim.fail(format!("fork {name}: file_base {fb} != fork offset {at}"));
                    }
                    sim.note(format!("fork {name} from {parent}@{at}"));
                    sim.models[pi].has_children = true;
                    sim.models.push(SModel {
                        name,
                        json,
                        file_base: at,
                        file_path: st.file_path.clone(),
                        id: st.id,
                        recs: Vec::new(),
                        next_seq: 0,
                        closed: false,
                        deleted: false,
                        has_children: false,
                        unsettled: false,
                        floor: at,
                    });
                }
            }
            // ---- delete ----
            _ if op < 24 => {
                if let Some(mi) = sim.pick(|m| !m.deleted && !m.has_children) {
                    let name = sim.models[mi].name.clone();
                    let resp = handlers::handle(Arc::clone(store), delete_req(&name)).await;
                    if !(200..300).contains(&resp.status) {
                        sim.fail(format!("delete {name} rejected: {}", resp.status));
                    }
                    sim.note(format!("delete {name}"));
                    sim.models[mi].deleted = true;
                }
            }
            // ---- checkpoint ----
            _ if op < 30 => {
                let si = sim.rng.below(sim.shards_n as u64) as usize;
                let shard = Arc::clone(&walset.shards()[si]);
                shard.checkpoint().await.unwrap_or_else(|e| {
                    sim.fail(format!("checkpoint shard {si} failed: {e}"))
                });
                let tails = shard.read_durable_tails();
                for m in &mut sim.models {
                    if let Some(&t) = tails.get(&m.id) {
                        if t > m.floor {
                            m.floor = t;
                        }
                    }
                }
                sim.note(format!("checkpoint shard {si} ({} tails)", tails.len()));
            }
            // ---- live tail sanity ----
            // The reader-visible tail (durable_tail) may lawfully LAG the file
            // length: a cancelled append leaves bytes in the file whose publish
            // never ran (healed monotonically by the next acked append, or
            // exposed by crash recovery). It must never EXCEED the file though.
            _ if op < 33 => {
                if let Some(mi) = sim.pick(|m| !m.deleted) {
                    let name = sim.models[mi].name.clone();
                    if let Some(st) = store.get(&name) {
                        let len = std::fs::metadata(&st.file_path).map(|m| m.len()).unwrap_or(0);
                        let tail = st.tail().bytes;
                        let fb = sim.models[mi].file_base;
                        if tail > fb + len {
                            sim.fail(format!(
                                "stream {name}: live tail {tail} > file_base {fb} + file_len {len} \
                                 (published tail covers bytes the file does not have)"
                            ));
                        }
                    }
                }
            }
            // ---- plain acked append ----
            _ => {
                if let Some(mi) = sim.pick(|m| !m.deleted && !m.closed) {
                    ack_append(sim, store, mi).await;
                } else {
                    // Everything closed/deleted: force a create next loop.
                }
            }
        }
    }

    // In-flight-at-crash appends: spawned over the real path, never awaited —
    // the runtime drop (the crash) aborts them at whatever point they reached.
    let inflight = sim.rng.below(3);
    for _ in 0..inflight {
        if let Some(mi) = sim.pick(|m| !m.deleted && !m.closed) {
            let (payload, wire) = sim.make_record(mi);
            let ct = if sim.models[mi].json { JSON_CT } else { OCTET };
            let name = sim.models[mi].name.clone();
            sim.note(format!("in-flight append {name} ({}B) at crash", wire.len()));
            sim.push_rec(mi, wire, RecStatus::Maybe);
            let req = post_req(&name, ct, &payload, &[]);
            let store2 = Arc::clone(store);
            tokio::spawn(async move {
                let _ = handlers::handle(store2, req).await;
            });
        }
    }
    if inflight > 0 {
        // Let the spawned appends progress a random amount before the crash.
        for _ in 0..sim.rng.below(6) {
            tokio::task::yield_now().await;
        }
    }
}

/// After the crash (runtime dropped, committers stopped): stage 0..=2 records
/// that reached the data file's page cache + the WAL staging buffer but whose
/// WAL bytes were never fdatasync'd — the classic torn-append shape. These are
/// exactly the bytes `inject_wal_faults` is then allowed to tear.
fn stage_torn_appends(sim: &mut Sim, store: &Arc<Store>, walset: &Arc<WalSet>) {
    let n = sim.rng.below(3);
    for _ in 0..n {
        let Some(mi) = sim.pick(|m| !m.deleted && !m.closed) else { return };
        let (_, wire) = sim.make_record(mi);
        let name = sim.models[mi].name.clone();
        let Some(st) = store.get(&name) else { continue };
        let cur_len = std::fs::metadata(&st.file_path).map(|m| m.len()).unwrap_or(0);
        let offset = sim.models[mi].file_base + cur_len;
        {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(&st.file_path)
                .unwrap();
            f.write_all(&wire).unwrap();
        }
        let shard = walset.shard_for(st.id);
        shard
            .reserve_and_stage(RecordKind::Append, st.id, offset, &wire)
            .unwrap();
        sim.note(format!(
            "staged-at-crash append {name} @{offset} ({}B, never fdatasync'd)",
            wire.len()
        ));
        sim.push_rec(mi, wire, RecStatus::Maybe);
    }
}

// ---------------------------------------------------------------------------
// Seed runner + test entry
// ---------------------------------------------------------------------------

fn env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn run_one_seed(seed: u64, gens: u64, steps: u64) {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dir = std::env::temp_dir().join(format!(
        "ds-wal-sim-{seed}-{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&dir);

    let mut rng = Rng::new(seed);
    let shards_n = 1 + (rng.below(3) as usize); // 1..=3 shards
    let mut sim = Sim {
        seed,
        rng,
        dir: dir.clone(),
        shards_n,
        models: Vec::new(),
        name_ctr: 0,
        gen: 0,
        log: Vec::new(),
    };

    for g in 0..=gens {
        sim.gen = g;
        sim.note(format!("--- generation {g} boot ---"));
        // Forensics: snapshot the pre-boot (post-crash, post-fault) disk state
        // so a violation can be inspected before recovery/reset mutate it.
        if std::env::var("DS_SIM_SNAPSHOT").is_ok() && g > 0 {
            let snap = dir.with_file_name(format!(
                "{}-preboot-gen{g}",
                dir.file_name().unwrap().to_str().unwrap()
            ));
            let _ = std::fs::remove_dir_all(&snap);
            let _ = std::process::Command::new("cp")
                .arg("-R")
                .arg(&dir)
                .arg(&snap)
                .status();
            eprintln!("[sim] snapshot: {}", snap.display());
        }
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let last = g == gens;
        let (store, walset, committers) = rt.block_on(async {
            let (store, walset, committers) = if g == 0 {
                boot(&dir, Some(sim.shards_n), sim.shards_n)
            } else {
                boot(&dir, None, sim.shards_n)
            };
            // Oracle over the recovered state (trivially empty on gen 0).
            verify_recovery(&mut sim, &store);
            if !last {
                run_generation(&mut sim, &store, &walset, steps).await;
            }
            (store, walset, committers)
        });
        if last {
            for h in committers {
                h.stop();
            }
            drop(store);
            drop(walset);
            drop(rt);
            break;
        }

        // ---- CRASH ----
        // Dropping the runtime aborts every in-flight task (requests, meta
        // flushes) at its current await point; blocking writes already
        // submitted finish first (a legal pre-crash ordering).
        drop(rt);
        // The committer threads are the "disk": stop + join them (their final
        // drain fsync is a no-op for anything the oracle relies on).
        for h in committers {
            h.stop();
        }
        // Durable frontier per shard, BEFORE staging the torn tail below —
        // everything at/below this is fdatasync'd and must survive faults.
        let durable: Vec<u64> = walset.shards().iter().map(|s| s.durable_lsn_now()).collect();
        // Stage page-cache-only appends (data file + WAL staging, no fsync).
        if sim.rng.chance(60) {
            stage_torn_appends(&mut sim, &store, &walset);
        }
        drop(store);
        drop(walset);

        // ---- POWER-LOSS FAULTS ----
        if sim.rng.chance(55) {
            inject_data_file_faults(&mut sim);
        }
        if sim.rng.chance(55) {
            inject_wal_faults(&mut sim, &durable);
        }
    }

    let _ = std::fs::remove_dir_all(&dir);
}

/// Forensic helper: `DS_DUMP_DIR=<data-dir> cargo test wal_forensic_dump -- --ignored --nocapture`
/// decodes every WAL segment (lsn, kind, stream_id, stream_offset, len) and
/// lists per-stream file sizes, for inspecting a failing sim snapshot.
#[test]
#[ignore]
fn wal_forensic_dump() {
    let dir = PathBuf::from(std::env::var("DS_DUMP_DIR").expect("set DS_DUMP_DIR"));
    for entry in std::fs::read_dir(dir.join("streams")).unwrap().flatten() {
        let p = entry.path();
        if p.extension().is_none() {
            eprintln!("stream file {:?}: {} bytes", p.file_name().unwrap(), p.metadata().unwrap().len());
        }
    }
    let wal_root = dir.join("wal");
    for sh in std::fs::read_dir(&wal_root).unwrap().flatten() {
        let sp = sh.path();
        if !sp.is_dir() {
            continue;
        }
        let mut segs: Vec<(u64, PathBuf)> = std::fs::read_dir(&sp)
            .unwrap()
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                let stem = p.file_stem()?.to_str()?.parse::<u64>().ok()?;
                (p.extension()?.to_str()? == "wal").then_some((stem, p))
            })
            .collect();
        segs.sort();
        let ckpt = std::fs::read_to_string(sp.join("checkpoint")).unwrap_or_default();
        let tails = std::fs::read_to_string(sp.join("tails")).unwrap_or_default();
        eprintln!("== shard {:?} checkpoint={} tails={}", sp.file_name().unwrap(), ckpt.trim(), tails.trim());
        for (start, seg) in segs {
            let bytes = std::fs::read(&seg).unwrap();
            eprintln!("-- segment {start}.wal ({} bytes)", bytes.len());
            let mut off = 0usize;
            loop {
                match decode_at(&bytes, off) {
                    Decoded::Record { lsn, kind, stream_id, stream_offset, len, total, .. } => {
                        eprintln!(
                            "   off={off:<8} lsn={lsn:<6} kind={kind:?} stream={stream_id} s_off={stream_offset} len={len}"
                        );
                        off += total;
                    }
                    Decoded::Incomplete => {
                        eprintln!("   off={off:<8} <Incomplete — clean end>");
                        break;
                    }
                    Decoded::Torn => {
                        eprintln!("   off={off:<8} <TORN>");
                        break;
                    }
                }
            }
        }
    }
}

/// Forensic helper: run `replay_from_checkpoint(0)` over DS_DUMP_DIR's shards
/// via the real WalSet::open path and print every record the walk yields.
#[test]
#[ignore]
fn wal_forensic_replay() {
    let dir = PathBuf::from(std::env::var("DS_DUMP_DIR").expect("set DS_DUMP_DIR"));
    let walset = WalSet::open_with_segment_size(&dir, None, 1, SEG_BYTES).unwrap();
    for (i, shard) in walset.shards().iter().enumerate() {
        let mut n = 0usize;
        shard
            .replay_from_checkpoint(0, |kind, sid, soff, payload| {
                n += 1;
                eprintln!("shard {i}: {kind:?} stream={sid} s_off={soff} len={}", payload.len());
            })
            .unwrap();
        eprintln!("shard {i}: {n} records replayed");
    }
}

/// Seeded randomized crash/recovery simulation. Fast deterministic defaults for
/// CI; scale with DS_SIM_SEEDS / DS_SIM_SEED0 / DS_SIM_GENS / DS_SIM_STEPS for
/// a long local hunt.
#[test]
fn crash_recovery_randomized_simulation() {
    let _guard = DurabilityGuard::wal();
    let seeds = env_u64("DS_SIM_SEEDS", 4);
    let seed0 = env_u64("DS_SIM_SEED0", 0x0001_5EED);
    let gens = env_u64("DS_SIM_GENS", 3);
    let steps = env_u64("DS_SIM_STEPS", 100);
    for k in 0..seeds {
        let seed = seed0 + k;
        eprintln!("[sim] seed {seed} ({}/{seeds})", k + 1);
        run_one_seed(seed, gens, steps);
    }
}
