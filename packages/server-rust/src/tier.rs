// Hot/cold tiering: fixed-size sealed segments + a per-stream manifest.
//
// This module is ALWAYS compiled, but is INACTIVE unless tiering is enabled at
// runtime (`--tier s3|local`). With tiering off (the default) no stream ever
// seals, the manifest stays empty, and the read/append paths behave exactly as
// the single-contiguous-file server always has — byte-for-byte unchanged. The
// only feature-gated piece is the S3 `BlobStore` adapter (see `blobstore.rs`);
// everything here is plain Rust with no heavy dependencies.
//
// Design (mirrors the stratovolt Cloudflare Worker model, ported to fd-backed
// storage):
//   - A stream's live tail lives in its contiguous data file, exactly as today.
//   - When the unsealed tail crosses `segment_bytes` (default 8 MiB), the prefix
//     up to a safe boundary is sealed into an immutable, CDN-friendly *segment*.
//     For JSON streams the boundary must land on a value boundary (a top-level
//     `,` that is not inside a string) so a sealed segment is independently
//     wrappable as `[ … ]` — ported from stratovolt's `findNthJsonValueEnd`.
//   - A sealed segment is copied to a separate chunk file on disk, then (when a
//     remote tier is configured) offloaded to object storage. Once the upload is
//     verified and the manifest entry is durably flipped to `Remote`, the local
//     chunk file is `unlink`ed — safe even with in-flight reads, since Unix keeps
//     an open fd readable after unlink.
//   - The manifest is an ordered list of sealed segments plus a contiguous
//     `sealed_offset` watermark; logical offsets below it resolve to a segment
//     (Local fd or Remote key), at/above it to the live data file.

use std::fs::OpenOptions;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::store::{write_meta_sync, Segment, Store, StreamState};

/// Default seal boundary: 8 MiB. A CDN-friendly immutable object size — large
/// enough to amortise per-object overhead, small enough to cache and range-read.
pub const DEFAULT_SEGMENT_BYTES: u64 = 8 * 1024 * 1024;

/// Default live-file compaction threshold: 64 MiB of reclaimable sealed prefix.
/// Compaction rewrites the (bounded) hot tail once per threshold, so a larger
/// value lowers write-amplification at the cost of more redundant local disk
/// between compactions. `0` disables.
pub const DEFAULT_COMPACT_BYTES: u64 = 64 * 1024 * 1024;

/// Where a sealed segment's bytes currently live.
#[derive(Clone, Debug)]
pub enum Placement {
    /// A separate immutable chunk file on local disk (path).
    Local(PathBuf),
    /// An object in the configured BlobStore (key).
    Remote(String),
}

/// One immutable sealed segment of a stream. `logical_start` is the stream-wide
/// logical offset where the segment begins; `len` is its byte length. Segments
/// are contiguous and ordered: `segments[i].logical_start + segments[i].len ==
/// segments[i+1].logical_start`, and the first starts at the stream's
/// `base_offset` (0 for roots; the fork point for forks — fork inheritance below
/// `base_offset` still resolves through the parent chain, unchanged).
#[derive(Clone, Debug)]
pub struct SegmentEntry {
    pub logical_start: u64,
    pub len: u64,
    pub placement: Placement,
    /// True once the bytes are durably in the remote tier (mirrors `placement`
    /// being `Remote`; kept for clarity / recovery reconciliation).
    pub remote: bool,
}

impl SegmentEntry {
    pub fn logical_end(&self) -> u64 {
        self.logical_start + self.len
    }
}

/// Per-stream sealing/offload manifest. Lives in `StreamState` behind a Mutex
/// and is persisted in the `.meta` sidecar. Empty (and untouched) when tiering
/// is off.
#[derive(Default)]
pub struct Manifest {
    pub segments: Vec<SegmentEntry>,
    /// Contiguous watermark: every byte in `[base_offset, sealed_offset)` is
    /// covered by a sealed segment. Bytes at/above it are still in the live data
    /// file. (Stored absolute/logical, not file-local.)
    pub sealed_offset: u64,
    /// True while an offload pass is in flight, so we never launch two at once.
    pub offloading: bool,
    /// Set on hard delete: seal/offload passes bail out instead of staging new
    /// chunk files or uploading objects, so `gc_remote_segments` can reclaim a
    /// final, stable set of segments without racing an in-flight pass.
    pub deleted: bool,
}

// ---------------- JSON value-boundary scanning ----------------
//
// Ported from stratovolt `findNthJsonValueEnd` (buffer-utils.ts). The data file
// for a JSON stream is the contiguous wire form `value1,value2,value3,` (every
// value followed by a `,`). To seal a prefix we must cut on a top-level comma
// that is NOT inside a JSON string and NOT inside a nested object/array — so the
// sealed segment is a whole number of values and can be wrapped `[ … ]`.

const QUOTE: u8 = b'"';
const BACKSLASH: u8 = b'\\';
const OPEN_BRACE: u8 = b'{';
const CLOSE_BRACE: u8 = b'}';
const OPEN_BRACKET: u8 = b'[';
const CLOSE_BRACKET: u8 = b']';
const COMMA: u8 = b',';

/// Given the contiguous JSON wire bytes `data` (`value,value,…,`), return the
/// largest cut length `k <= limit` such that `data[..k]` ends exactly on a
/// top-level value separator (`,`) — i.e. a whole number of values. Returns 0 if
/// no such boundary exists at or before `limit` (e.g. a single value larger than
/// `limit`, in which case the caller should wait for it to complete rather than
/// split mid-value).
///
/// The scan is a byte-level state machine that ignores commas/brackets/braces
/// inside JSON strings and honours backslash escapes, exactly like stratovolt's
/// boundary finder. It tracks the last in-bounds top-level comma seen.
pub fn last_json_value_boundary(data: &[u8], limit: u64) -> u64 {
    let limit = (limit as usize).min(data.len());
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escape = false;
    let mut last_boundary: usize = 0;
    let mut pos = 0usize;
    while pos < data.len() {
        let b = data[pos];
        if escape {
            escape = false;
            pos += 1;
            continue;
        }
        if in_string {
            if b == BACKSLASH {
                escape = true;
            } else if b == QUOTE {
                in_string = false;
            }
            pos += 1;
            continue;
        }
        match b {
            QUOTE => in_string = true,
            OPEN_BRACE | OPEN_BRACKET => depth += 1,
            CLOSE_BRACE | CLOSE_BRACKET => {
                if depth > 0 {
                    depth -= 1;
                }
            }
            COMMA if depth == 0 => {
                // `data[..pos+1]` ends just past this top-level comma — a clean
                // value boundary. Record it if still within the limit.
                let boundary = pos + 1;
                if boundary <= limit {
                    last_boundary = boundary;
                } else {
                    // We've passed the limit; no further in-bounds boundary can
                    // be larger, so stop.
                    break;
                }
            }
            _ => {}
        }
        pos += 1;
    }
    last_boundary as u64
}

// ---------------- runtime tiering config ----------------

/// Tier backend selection.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TierKind {
    Off,
    /// Local-filesystem BlobStore (a chunk directory) — for testing offload
    /// without S3.
    Local,
    /// S3-compatible object storage (feature `tier`).
    S3,
}

/// Parsed tiering configuration, built from CLI flags + env in main.rs and held
/// by the Store. When `kind == Off`, nothing seals and this is inert.
#[derive(Clone, Debug)]
pub struct TierConfig {
    pub kind: TierKind,
    pub segment_bytes: u64,
    /// Live-file compaction threshold: once a stream's reclaimable sealed prefix
    /// (`sealed_offset − file_base`) reaches this many bytes, the live data file
    /// is rewritten to drop that redundant prefix. `0` disables compaction.
    pub compact_bytes: u64,
    pub key_prefix: String,
    // S3 connection (only meaningful when kind == S3).
    pub endpoint: Option<String>,
    pub region: Option<String>,
    pub bucket: Option<String>,
    pub path_style: bool,
    pub allow_http: bool,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    /// Directory for the local BlobStore (kind == Local) and for staged sealed
    /// chunk files before offload (all kinds). Defaults to `<data_dir>/cold`.
    pub local_dir: Option<PathBuf>,
}

impl Default for TierConfig {
    fn default() -> Self {
        TierConfig {
            kind: TierKind::Off,
            segment_bytes: DEFAULT_SEGMENT_BYTES,
            compact_bytes: DEFAULT_COMPACT_BYTES,
            key_prefix: String::new(),
            endpoint: None,
            region: None,
            bucket: None,
            path_style: true,
            allow_http: false,
            access_key_id: None,
            secret_access_key: None,
            local_dir: None,
        }
    }
}

impl TierConfig {
    pub fn enabled(&self) -> bool {
        self.kind != TierKind::Off
    }
}

/// Stream-level sealing state, kept inside `StreamState` (always present; only
/// mutated when tiering is enabled). Behind a Mutex so the offload background
/// task and the append path coordinate.
pub struct TierState {
    pub manifest: Mutex<Manifest>,
}

impl Default for TierState {
    fn default() -> Self {
        TierState {
            manifest: Mutex::new(Manifest::default()),
        }
    }
}

impl TierState {
    /// Rebuild a TierState from persisted manifest entries. `segments_dir` is
    /// where local chunk files live (used to reconstruct `Local` paths).
    pub fn from_meta(
        metas: &[crate::store::MetaSegment],
        sealed_offset: u64,
        segments_dir: &std::path::Path,
    ) -> TierState {
        let segments = metas
            .iter()
            .map(|m| {
                let (placement, remote) = match (&m.remote_key, &m.local_file) {
                    (Some(key), _) => (Placement::Remote(key.clone()), true),
                    (None, Some(name)) => (Placement::Local(segments_dir.join(name)), false),
                    // Corrupt entry (neither) — treat as a missing local file so
                    // reconcile flags it; keep a placeholder path.
                    (None, None) => (Placement::Local(segments_dir.join("__missing__")), false),
                };
                SegmentEntry {
                    logical_start: m.logical_start,
                    len: m.len,
                    placement,
                    remote,
                }
            })
            .collect();
        TierState {
            manifest: Mutex::new(Manifest {
                segments,
                sealed_offset,
                offloading: false,
                deleted: false,
            }),
        }
    }
}

// ============================================================================
// Hot/cold tiering lifecycle + placement-aware read resolver.
//
// These operate on `crate::store::{Store, StreamState, Segment}` (all pub) and
// were relocated here from store.rs so all tiering logic lives in one module.
// The lifecycle methods are a second inherent `impl Store` block; store.rs
// re-exports the read resolver (resolve_range / into_local_segments).
// ============================================================================

/// The object key for a sealed segment of a stream: `<prefix><stream-file>/<16-digit logical_start>`.
/// Keying by the unique data-file name (which embeds the stream id) namespaces
/// every stream incarnation / fork separately, mirroring stratovolt's
/// `{streamId}/{streamHash}/{chunkSeq}`.
fn segment_key(prefix: &str, st: &StreamState, logical_start: u64) -> String {
    let fname = st
        .file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("stream");
    format!("{prefix}{fname}/{logical_start:016}")
}

/// Local staged chunk-file name for a sealed segment.
fn segment_file_name(st: &StreamState, logical_start: u64) -> String {
    let fname = st
        .file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("stream");
    format!("{fname}.seg.{logical_start:016}")
}

impl Store {
    /// On boot, re-enqueue any sealed-but-not-yet-offloaded segments (placement
    /// still Local while a remote tier is configured) and log hard errors for
    /// Remote segments whose object has gone missing.
    pub(crate) fn reconcile_manifest_on_boot(&self, st: &Arc<StreamState>) {
        if !self.tier_config.enabled() {
            return;
        }
        let has_local = {
            let m = st.tier.manifest.lock().unwrap();
            m.segments.iter().any(|s| !s.remote)
        };
        if has_local {
            // A crash left segments staged locally; offload them.
            let store = self.clone_for_task();
            let stc = st.clone();
            tokio::spawn(async move {
                store.offload_pending(&stc).await;
            });
        }
    }

    /// A lightweight clone of just what an offload background task needs.
    fn clone_for_task(&self) -> TierTask {
        TierTask {
            tier_config: self.tier_config.clone(),
            blobstore: self.blobstore.clone(),
        }
    }

    /// Seal as many full `segment_bytes`-sized prefixes off the live tail as are
    /// available, copying each to a chunk file and (if a remote tier is
    /// configured) offloading it. The live file is not reclaimed (see the note in
    /// `seal_loop`). Runs after an append's durability ack — never on the ack path
    /// itself. No-op when tiering is off.
    pub async fn maybe_seal(self: &Arc<Self>, st: &Arc<StreamState>) {
        if !self.tier_config.enabled() {
            return;
        }
        // Only one sealing pass per stream at a time, and never after a hard
        // delete (the GC pass owns the segments now).
        {
            let mut m = st.tier.manifest.lock().unwrap();
            if m.offloading || m.deleted {
                return;
            }
            m.offloading = true;
        }
        let res = self.seal_loop(st).await;
        // Reclaim the redundant sealed prefix from the live file once it crosses
        // the threshold. Inside the same guarded window as sealing, so the two
        // never touch the live file or `file_base` concurrently.
        let compact_res = if res.is_ok() {
            self.maybe_compact(st).await
        } else {
            Ok(())
        };
        {
            let mut m = st.tier.manifest.lock().unwrap();
            m.offloading = false;
        }
        if let Err(e) = res {
            tracing::warn!(stream = %st.path, error = %e, "tier seal pass failed; will retry on next append");
        }
        if let Err(e) = compact_res {
            tracing::warn!(stream = %st.path, error = %e, "tier compaction failed; will retry on next append");
        }
    }

    /// If the reclaimable sealed prefix (`sealed_offset − file_base`) has reached
    /// the configured `compact_bytes`, rewrite the live data file to drop it.
    /// Called inside the seal guard, so it is mutually exclusive with sealing.
    /// No-op when `compact_bytes == 0` or nothing is reclaimable.
    async fn maybe_compact(self: &Arc<Self>, st: &Arc<StreamState>) -> std::io::Result<()> {
        let threshold = self.tier_config.compact_bytes;
        if threshold == 0 {
            return Ok(());
        }
        // Separate acquisitions (never nest manifest+shared — see seal_loop note).
        let sealed = st.tier.manifest.lock().unwrap().sealed_offset.max(st.base_offset);
        let file_base = st.shared.read().unwrap().file_base;
        if sealed <= file_base || sealed - file_base < threshold {
            return Ok(());
        }
        self.compact_one(st, sealed).await
    }

    /// Rewrite the live data file from `[old_file_base, tail)` to `[cut, tail)`,
    /// reclaiming the redundant sealed prefix `[old_file_base, cut)` (which is
    /// already served from chunk files / remote objects via `resolve_range`).
    /// Holds the appender lock for the whole pass so `tail` is frozen; crash-safe
    /// via a `pending_compaction` intent persisted before the destructive rename
    /// (see `recover_one_inner`). The redundant prefix is reclaimed regardless of
    /// Local/Remote placement — every offset below `cut` is segment-backed.
    async fn compact_one(self: &Arc<Self>, st: &Arc<StreamState>, cut: u64) -> std::io::Result<()> {
        let mut ap = st.appender.lock().await;
        let (old_base, tail, old_file) = {
            let s = st.shared.read().unwrap();
            (s.file_base, s.tail, s.file.clone())
        };
        // Re-check under the appender lock: nothing to reclaim, or an inconsistent
        // watermark (sealed should never exceed the frozen tail).
        if cut <= old_base || cut > tail {
            return Ok(());
        }
        let residual = tail - cut; // hot-tail bytes to keep
        let read_from = cut - old_base; // file-local offset of the residual
        let tmp_path = st.file_path.with_extension("compact.tmp");
        let live_path = st.file_path.clone();

        // 1) Write the residual tail to a temp file; fsync the file + its dir.
        {
            let of = old_file.clone();
            let tp = tmp_path.clone();
            tokio::task::spawn_blocking(move || -> std::io::Result<()> {
                use std::io::Write;
                use std::os::unix::fs::FileExt;
                let mut buf = vec![0u8; residual as usize];
                of.read_exact_at(&mut buf, read_from)?;
                let mut f = std::fs::File::create(&tp)?;
                f.write_all(&buf)?;
                f.sync_all()?;
                crate::store::fsync_parent_dir(&tp)
            })
            .await
            .map_err(std::io::Error::other)??;
        }

        // 2) Persist the compaction intent BEFORE the destructive rename, so a
        //    crash anywhere after this is recoverable (tail is frozen).
        *st.compaction.lock().unwrap() = Some(crate::store::PendingCompaction {
            new_file_base: cut,
            tail,
        });
        {
            let stc = st.clone();
            tokio::task::spawn_blocking(move || write_meta_sync(&stc, true))
                .await
                .map_err(std::io::Error::other)??;
        }

        // 3) Atomic content swap, made crash-durable. In-flight readers keep the
        //    old fd (the old inode stays readable until they drop it).
        {
            let tp = tmp_path.clone();
            let lp = live_path.clone();
            tokio::task::spawn_blocking(move || -> std::io::Result<()> {
                std::fs::rename(&tp, &lp)?;
                crate::store::fsync_parent_dir(&lp)
            })
            .await
            .map_err(std::io::Error::other)??;
        }

        // 4) Open the compacted file and publish (file, file_base) for readers as
        //    one consistent swap; repoint the appender's write handle. Under the
        //    appender lock, so no append observes a half-swapped state.
        let new_file = Arc::new(
            OpenOptions::new()
                .read(true)
                .append(true)
                .open(&live_path)?,
        );
        {
            let mut s = st.shared.write().unwrap();
            s.file = new_file.clone();
            s.file_base = cut;
        }
        ap.file = new_file;
        ap.written = residual;

        // 5) Clear the intent durably; the live file now matches `file_base`.
        *st.compaction.lock().unwrap() = None;
        {
            let stc = st.clone();
            tokio::task::spawn_blocking(move || write_meta_sync(&stc, true))
                .await
                .map_err(std::io::Error::other)??;
        }
        Ok(())
    }

    async fn seal_loop(self: &Arc<Self>, st: &Arc<StreamState>) -> std::io::Result<()> {
        let seg_bytes = self.tier_config.segment_bytes;
        let seg_dir = self.segments_dir();
        std::fs::create_dir_all(&seg_dir)?;
        loop {
            // Determine the next sealable prefix: bytes in the live data file
            // between the current sealed watermark and the tail, capped at one
            // segment. We need the appender lock briefly to read a consistent
            // (written) length and the file-local region.
            // Acquire manifest and shared SEPARATELY (never nested): `write_meta_sync`'s
            // `Meta::capture` holds shared.read() then takes manifest.lock(), so holding
            // them in the opposite order here would deadlock under a queued shared writer
            // (std RwLock is writer-preferring). These are heuristic reads; the seal cut is
            // re-derived consistently below.
            let sealed_offset = {
                let m = st.tier.manifest.lock().unwrap();
                // Hard delete arrived mid-pass: stop staging/uploading and let
                // `gc_remote_segments` reclaim from here.
                if m.deleted {
                    return Ok(());
                }
                m.sealed_offset.max(st.base_offset)
            };
            let (tail, file_base, file) = {
                let s = st.shared.read().unwrap();
                (s.tail, s.file_base, s.file.clone())
            };
            let unsealed = tail.saturating_sub(sealed_offset);
            if unsealed < seg_bytes {
                return Ok(());
            }
            // Candidate cut length within the live file region [sealed, tail).
            let file_lo = sealed_offset - file_base; // file-local start of unsealed
            let want = seg_bytes;
            // Read the candidate region from the live file to find the boundary.
            let region_len = want.min(unsealed);
            let region = tokio::task::spawn_blocking(move || {
                use std::os::unix::fs::FileExt;
                let mut buf = vec![0u8; region_len as usize];
                file.read_exact_at(&mut buf, file_lo).map(|_| buf)
            })
            .await
            .map_err(std::io::Error::other)??;

            // For JSON streams the cut MUST land on a value boundary so the
            // sealed segment is a whole number of values (wrappable as [ … ]).
            let cut = if st.is_json {
                let b = crate::tier::last_json_value_boundary(&region, region_len);
                if b == 0 {
                    // No value boundary within a whole segment — a single value
                    // larger than segment_bytes. Wait for more / accept the
                    // oversize value later; nothing to seal now.
                    return Ok(());
                }
                b
            } else {
                region_len
            };

            let seg_start = sealed_offset;
            let seg_len = cut;
            let payload = bytes::Bytes::from(region[..cut as usize].to_vec());

            // 1) Stage the sealed bytes to a separate chunk file (fsynced).
            let file_name = segment_file_name(st, seg_start);
            let chunk_path = seg_dir.join(&file_name);
            {
                let cp = chunk_path.clone();
                let pl = payload.clone();
                tokio::task::spawn_blocking(move || -> std::io::Result<()> {
                    use std::io::Write;
                    let tmp = cp.with_extension("tmp");
                    {
                        let mut f = std::fs::File::create(&tmp)?;
                        f.write_all(&pl)?;
                        f.sync_all()?;
                    }
                    std::fs::rename(&tmp, &cp)?;
                    // Make the chunk-file rename crash-durable before the manifest
                    // (persisted next) records it as Local at this path.
                    crate::store::fsync_parent_dir(&cp)
                })
                .await
                .map_err(std::io::Error::other)??;
            }

            // 2) Record the sealed segment in the manifest (Local) and advance
            //    the watermark, then persist it durably — so a crash never loses
            //    the segment's placement.
            {
                let mut m = st.tier.manifest.lock().unwrap();
                m.segments.push(crate::tier::SegmentEntry {
                    logical_start: seg_start,
                    len: seg_len,
                    placement: crate::tier::Placement::Local(chunk_path.clone()),
                    remote: false,
                });
                m.sealed_offset = seg_start + seg_len;
            }
            let stc = st.clone();
            tokio::task::spawn_blocking(move || write_meta_sync(&stc, true))
                .await
                .map_err(std::io::Error::other)??;

            // NOTE: the live data file's sealed region is intentionally NOT
            // reclaimed here. A sealed segment is served from its chunk file /
            // remote object (resolve_range routes sealed offsets there), so the
            // live file's copy is redundant — but hole-punching it races with the
            // engines' in-flight lazy reads (sendfile / Body::FileRange) into the
            // just-sealed tail, which would then read zeros from the freed blocks.
            // Safe reclaim needs read/punch coordination (epoch/refcount) or
            // compaction; that is a planned follow-up. Until then the live file
            // retains the sealed prefix (extra disk; the no-corruption guarantee
            // and the no-race guarantee both hold).

            // 3) Offload to the remote tier (upload → head verify → flip
            //    Local→Remote durably → unlink the chunk file).
            self.offload_one(st, seg_start, payload).await?;
        }
    }

    /// Upload one sealed segment, verify, flip the manifest entry to Remote
    /// durably, then unlink the local chunk file. If no blobstore is configured
    /// (which cannot happen when enabled), this is a no-op leaving it Local.
    async fn offload_one(
        self: &Arc<Self>,
        st: &Arc<StreamState>,
        seg_start: u64,
        payload: bytes::Bytes,
    ) -> std::io::Result<()> {
        let Some(bs) = &self.blobstore else {
            return Ok(());
        };
        // Hard delete arrived: don't upload an object the GC pass would have to
        // chase (it deletes by deterministic key, but skipping the put avoids the
        // orphan window entirely).
        if st.tier.manifest.lock().unwrap().deleted {
            return Ok(());
        }
        let key = segment_key(&self.tier_config.key_prefix, st, seg_start);
        let len = payload.len() as u64;
        // Upload.
        bs.put(&key, payload).await?;
        // Verify size before we ever delete the local copy.
        match bs.head(&key).await? {
            Some(sz) if sz == len => {}
            other => {
                return Err(std::io::Error::other(format!(
                    "tier: head verify failed for {key}: expected {len}, got {other:?}"
                )));
            }
        }
        // Flip the manifest entry Local→Remote and capture the local path.
        let local_path = {
            let mut m = st.tier.manifest.lock().unwrap();
            let mut path = None;
            for seg in m.segments.iter_mut() {
                if seg.logical_start == seg_start {
                    if let crate::tier::Placement::Local(p) = &seg.placement {
                        path = Some(p.clone());
                    }
                    seg.placement = crate::tier::Placement::Remote(key.clone());
                    seg.remote = true;
                    break;
                }
            }
            path
        };
        // Persist the flip durably BEFORE unlinking the local file (so recovery
        // never sees a Local entry whose file we already removed).
        let stc = st.clone();
        tokio::task::spawn_blocking(move || write_meta_sync(&stc, true))
            .await
            .map_err(std::io::Error::other)??;
        // Now the local chunk file is reclaimable. unlink is safe even with
        // in-flight reads (open fds stay valid after unlink on Unix).
        if let Some(p) = local_path {
            let _ = tokio::fs::remove_file(&p).await;
        }
        Ok(())
    }

    /// Delete every remote object backing a hard-deleted stream's sealed
    /// segments. Called only on hard delete (ref_count == 0).
    pub fn gc_remote_segments(&self, st: &Arc<StreamState>) {
        if !self.tier_config.enabled() {
            return;
        }
        // Mark the stream deleted FIRST (synchronously, before serving stops
        // referencing it): any in-flight or future seal/offload pass sees this and
        // bails (see `maybe_seal`/`seal_loop`/`offload_one`), so the snapshot below
        // is final and we never race a concurrent stage/upload.
        st.tier.manifest.lock().unwrap().deleted = true;

        let bs = self.blobstore.clone();
        let prefix = self.tier_config.key_prefix.clone();
        let seg_dir = self.segments_dir();
        // Deterministic on-disk prefix for this stream's chunk files
        // (`<fname>.seg.<start>`), used as a GC backstop for chunks staged on disk
        // but not yet in the manifest snapshot.
        let file_prefix = format!(
            "{}.seg.",
            st.file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("stream")
        );
        let st = st.clone();
        tokio::spawn(async move {
            // Wait out any pass that was already inside its offloading window so we
            // don't snapshot/delete while it is mid-upload or mid-stage. It bails
            // quickly on `deleted`; the bound stops a wedged pass from blocking GC
            // forever (deterministic-key deletion below still reclaims either way).
            for _ in 0..1000 {
                if !st.tier.manifest.lock().unwrap().offloading {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(2)).await;
            }
            // Snapshot the final segment set. Delete EVERY segment's remote object
            // by its deterministic key — this covers an object that was uploaded
            // just before a pass bailed but not yet flipped to `Remote` (a plain
            // `Remote`-only filter would miss it and orphan it). Deleting a key that
            // was never uploaded is a harmless no-op.
            let (keys, local_paths): (Vec<String>, Vec<std::path::PathBuf>) = {
                let m = st.tier.manifest.lock().unwrap();
                let keys = m
                    .segments
                    .iter()
                    .map(|s| segment_key(&prefix, &st, s.logical_start))
                    .collect();
                let local = m
                    .segments
                    .iter()
                    .filter_map(|s| match &s.placement {
                        crate::tier::Placement::Local(p) => Some(p.clone()),
                        crate::tier::Placement::Remote(_) => None,
                    })
                    .collect();
                (keys, local)
            };
            // Remote deletes (only when a blobstore is configured)…
            if let Some(bs) = bs {
                for k in keys {
                    let _ = bs.delete(&k).await;
                }
            }
            // …and unlink any still-staged local chunk files (reclaimed even for a
            // local-only tier, which has no blobstore).
            for p in local_paths {
                let _ = tokio::fs::remove_file(&p).await;
            }
            // Backstop sweep: remove any chunk file of this stream the manifest
            // snapshot missed — e.g. a chunk staged on disk before it was recorded
            // when a seal pass was cut short, or a leftover `.tmp` write.
            if let Ok(mut rd) = tokio::fs::read_dir(&seg_dir).await {
                while let Ok(Some(entry)) = rd.next_entry().await {
                    if entry
                        .file_name()
                        .to_str()
                        .is_some_and(|n| n.starts_with(&file_prefix))
                    {
                        let _ = tokio::fs::remove_file(entry.path()).await;
                    }
                }
            }
        });
    }
}

/// Helper bundle for background offload tasks that outlive the Store borrow.
struct TierTask {
    tier_config: crate::tier::TierConfig,
    blobstore: Option<crate::blobstore::SharedBlobStore>,
}

impl TierTask {
    async fn offload_pending(&self, st: &Arc<StreamState>) {
        let Some(bs) = &self.blobstore else {
            return;
        };
        // Share the per-stream offloading guard with maybe_seal so boot
        // reconcile and an append-triggered seal can't flip/unlink the same
        // segment concurrently. (boot one-shot, so the simple set/clear is fine.)
        {
            let mut m = st.tier.manifest.lock().unwrap();
            if m.offloading || m.deleted {
                return;
            }
            m.offloading = true;
        }
        let pending: Vec<(u64, std::path::PathBuf)> = {
            let m = st.tier.manifest.lock().unwrap();
            m.segments
                .iter()
                .filter(|s| !s.remote)
                .filter_map(|s| match &s.placement {
                    crate::tier::Placement::Local(p) => Some((s.logical_start, p.clone())),
                    _ => None,
                })
                .collect()
        };
        for (start, path) in pending {
            // Hard delete arrived mid-backlog: stop uploading (GC owns reclaim now)
            // and fall through to clear `offloading`, so the GC bounded wait sees
            // offloading==false promptly instead of timing out and racing our puts.
            if st.tier.manifest.lock().unwrap().deleted {
                break;
            }
            let payload = match tokio::fs::read(&path).await {
                Ok(b) => bytes::Bytes::from(b),
                Err(_) => continue,
            };
            let key = segment_key(&self.tier_config.key_prefix, st, start);
            let len = payload.len() as u64;
            if bs.put(&key, payload).await.is_err() {
                continue;
            }
            if !matches!(bs.head(&key).await, Ok(Some(sz)) if sz == len) {
                continue;
            }
            {
                let mut m = st.tier.manifest.lock().unwrap();
                for seg in m.segments.iter_mut() {
                    if seg.logical_start == start {
                        seg.placement = crate::tier::Placement::Remote(key.clone());
                        seg.remote = true;
                    }
                }
            }
            let stc = st.clone();
            let _ = tokio::task::spawn_blocking(move || write_meta_sync(&stc, true)).await;
            let _ = tokio::fs::remove_file(&path).await;
        }
        st.tier.manifest.lock().unwrap().offloading = false;
    }
}

/// A placement-resolved slice of a logical range: either a local file segment
/// (the live data file OR an immutable sealed chunk file — both served
/// zero-copy) or a remote object range (fetched via the BlobStore).
pub enum ResolvedSlice {
    Local(Segment),
    Remote { key: String, offset: u64, len: u64 },
}

/// If every resolved slice is `Local` (the live data file and/or sealed chunk
/// files — all served zero-copy from an fd), consume them into a `Vec<Segment>`
/// for a `Body::FileRange`; otherwise (any `Remote` slice) hand the slices back
/// so the caller streams them. This is the single fast-path gate: with tiering
/// off `resolve_range` yields exactly one live-file slice, so the default build's
/// behaviour is byte-for-byte the old `FileRange` path.
pub fn into_local_segments(slices: Vec<ResolvedSlice>) -> Result<Vec<Segment>, Vec<ResolvedSlice>> {
    if slices.iter().all(|s| matches!(s, ResolvedSlice::Local(_))) {
        Ok(slices
            .into_iter()
            .map(|s| match s {
                ResolvedSlice::Local(seg) => seg,
                ResolvedSlice::Remote { .. } => unreachable!("checked all-Local above"),
            })
            .collect())
    } else {
        Err(slices)
    }
}

/// Resolve `[start, end)` to ordered placement-aware slices, walking the fork
/// chain and the per-stream manifest. The single read resolver: the live data
/// file and inherited fork ranges become `Local` slices, sealed regions route to
/// their chunk file (`Local`) or remote object (`Remote`). With tiering off it
/// yields one `Local` live-file slice — the old zero-copy path, unchanged.
pub fn resolve_range(st: &Arc<StreamState>, start: u64, end: u64, out: &mut Vec<ResolvedSlice>) {
    if end <= start {
        return;
    }
    // Inherited fork range below this stream's base resolves through the parent.
    if start < st.base_offset {
        if let Some(p) = &st.parent {
            resolve_range(p, start, end.min(st.base_offset), out);
        }
    }
    if end <= st.base_offset {
        return;
    }
    let lo = start.max(st.base_offset);
    let sealed_offset = {
        let m = st.tier.manifest.lock().unwrap();
        m.sealed_offset.max(st.base_offset)
    };
    // Sealed region: [lo, min(end, sealed_offset)) is covered by manifest segs.
    if lo < sealed_offset {
        let sealed_end = end.min(sealed_offset);
        resolve_sealed(st, lo, sealed_end, out);
    }
    // Live region: [max(lo, sealed_offset), end) is in the live data file.
    let live_lo = lo.max(sealed_offset);
    if end > live_lo {
        // Read the live file handle and its base as a consistent pair — compaction
        // swaps both together under `shared.write()`, so a torn read here would
        // map to the wrong file position.
        let (file, file_base) = {
            let s = st.shared.read().unwrap();
            (s.file.clone(), s.file_base)
        };
        out.push(ResolvedSlice::Local(Segment {
            file,
            file_start: live_lo - file_base,
            len: end - live_lo,
        }));
    }
}

/// Resolve a sealed sub-range `[lo, hi)` (all below sealed_offset) to manifest
/// slices. Segments are contiguous, so we walk them in order.
fn resolve_sealed(st: &Arc<StreamState>, lo: u64, hi: u64, out: &mut Vec<ResolvedSlice>) {
    let m = st.tier.manifest.lock().unwrap();
    let mut cur = lo;
    for seg in &m.segments {
        if seg.logical_end() <= cur || seg.logical_start >= hi {
            continue;
        }
        let s = cur.max(seg.logical_start);
        let e = hi.min(seg.logical_end());
        if e <= s {
            continue;
        }
        let off_in_seg = s - seg.logical_start;
        let len = e - s;
        match &seg.placement {
            Placement::Local(path) => {
                // Open the immutable chunk file fresh; the fd is owned by the
                // returned Segment (Arc<File>). NOTE: this open is deliberately
                // done while holding the manifest lock — it serializes with
                // offload_one's flip(Local→Remote)+unlink (which also takes the
                // lock), so we always open the chunk file *before* it is unlinked
                // (and the fd stays valid after unlink). Do not move the open
                // outside the lock: that reintroduces an open-vs-unlink race.
                if let Ok(f) = OpenOptions::new().read(true).open(path) {
                    out.push(ResolvedSlice::Local(Segment {
                        file: Arc::new(f),
                        file_start: off_in_seg,
                        len,
                    }));
                }
            }
            Placement::Remote(key) => {
                out.push(ResolvedSlice::Remote {
                    key: key.clone(),
                    offset: off_in_seg,
                    len,
                });
            }
        }
        cur = e;
        if cur >= hi {
            break;
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boundary_simple_values() {
        // value,value,value,  (positions of the commas: 1,3,5)
        let data = b"1,2,3,";
        assert_eq!(last_json_value_boundary(data, 6), 6); // after final comma
        assert_eq!(last_json_value_boundary(data, 5), 4); // "1,2," — last comma <=5 is at idx3 -> 4
        assert_eq!(last_json_value_boundary(data, 4), 4);
        assert_eq!(last_json_value_boundary(data, 3), 2); // "1,"
        assert_eq!(last_json_value_boundary(data, 1), 0); // mid "1" -> no boundary
    }

    #[test]
    fn ignores_commas_inside_strings() {
        // "a,b" then ,  — the comma inside the string must NOT be a boundary.
        let data = br#""a,b",2,"#;
        // first top-level comma is at index 5 (after the closing quote)
        assert_eq!(last_json_value_boundary(data, 8), 8);
        assert_eq!(last_json_value_boundary(data, 6), 6); // "\"a,b\","
        assert_eq!(last_json_value_boundary(data, 4), 0); // still inside the string
    }

    #[test]
    fn ignores_escaped_quotes() {
        // "he said \"hi\"" , 2 ,
        let data = br#""he said \"hi\"",2,"#;
        // The escaped quotes do not close the string; first real boundary is the
        // comma after the closing quote.
        let first = last_json_value_boundary(data, data.len() as u64);
        assert_eq!(first, data.len() as u64);
        // A cut in the middle of the string yields no boundary.
        assert_eq!(last_json_value_boundary(data, 10), 0);
    }

    #[test]
    fn ignores_nested_brackets_and_braces() {
        // {"k":[1,2,{"n":3}]},42,
        let data = br#"{"k":[1,2,{"n":3}]},42,"#;
        // The only top-level commas are after the object and after 42.
        let n = data.len();
        assert_eq!(last_json_value_boundary(data, n as u64), n as u64);
        // cut at 19 -> just past the closing '}' of the object, before its comma
        // -> the boundary is the comma at index 19 => 20.
        assert_eq!(last_json_value_boundary(data, 20), 20);
        // cut at 19 -> last top-level comma <=19 is none (object not yet closed
        // by comma) => 0.
        assert_eq!(last_json_value_boundary(data, 19), 0);
    }

    #[test]
    fn single_huge_value_no_boundary() {
        let data = br#"{"big":"xxxxxxxxxxxxxxxxxxxx"},"#;
        // limit before the trailing comma -> no boundary (don't split mid-value).
        assert_eq!(last_json_value_boundary(data, 10), 0);
        // full -> boundary at the end.
        assert_eq!(
            last_json_value_boundary(data, data.len() as u64),
            data.len() as u64
        );
    }

    #[test]
    fn empty_input() {
        assert_eq!(last_json_value_boundary(b"", 0), 0);
        assert_eq!(last_json_value_boundary(b"", 10), 0);
    }
}
