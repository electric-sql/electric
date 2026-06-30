// Stream store: per-stream state, contiguous wire-byte data files, coalesced fsync.
//
// On-disk layout: the data file contains exactly the wire bytes of the stream
// payload, contiguously.
//   - binary streams: raw payload bytes as POSTed
//   - JSON streams:   each message followed by a `,` separator
// A catch-up read is then a literal byte range of the file (JSON responses
// wrap the range as `[` + range-minus-trailing-comma + `]`).

use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::os::fd::AsRawFd;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use tokio::sync::{watch, Mutex as AsyncMutex};

pub const MAX_SAFE_INT: u64 = (1u64 << 53) - 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tail {
    pub bytes: u64,
    pub closed: bool,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ProducerState {
    pub epoch: u64,
    pub last_seq: u64,
}

#[derive(Clone, Debug)]
pub struct StreamConfig {
    pub content_type: String,
    pub ttl_seconds: Option<u64>,
    pub expires_at: Option<SystemTime>,
    pub expires_at_raw: Option<String>,
    pub create_closed: bool,
    /// Fork identity (requested values, for idempotent re-PUT comparison).
    pub forked_from: Option<String>,
    pub fork_offset_raw: Option<String>,
    pub fork_sub_offset: Option<u64>,
}

pub struct Shared {
    /// Writer-facing logical tail (file_base + bytes written to this stream's own
    /// file). Advanced under the appender lock the instant bytes hit the page
    /// cache, so it can be AHEAD of what is durable. NOT what readers observe —
    /// see `durable_tail`.
    pub tail: u64,
    /// Reader-observable tail: advanced only AFTER the appended bytes are durable
    /// (in `wal` mode, after the WAL `fdatasync`; in `memory` mode, immediately —
    /// the page-cache write IS the ack). `tail()` reports this so a live/catch-up
    /// reader never observes (and acts on) bytes a crash could roll back
    /// (PROTOCOL.md §4.1) — the same durability-before-visibility ordering the
    /// close path applies via `closed_durable`. On recovery it equals the
    /// reconciled durable tail (durable by definition).
    pub durable_tail: u64,
    /// Logical offset of the live data file's first byte. Equals `base_offset`
    /// until the first compaction, then advances to the sealed watermark as the
    /// redundant sealed prefix is reclaimed. Live-region reads map
    /// `file_pos = logical - file_base`. Distinct from `base_offset`, the
    /// immutable fork point. Invariant: base_offset ≤ file_base ≤ sealed_offset ≤ tail.
    pub file_base: u64,
    /// Shared handle to the live data file for lock-free positioned reads. Held
    /// here (not on `StreamState`) so compaction can swap it together with
    /// `file_base` under one `shared.write()`, giving concurrent readers a
    /// consistent (file, file_base) pair.
    pub file: Arc<File>,
    /// Writer-facing close intent: set under the appender lock the instant a
    /// close is accepted (so subsequent appends are rejected) and persisted to
    /// the sidecar. NOT what readers observe — see `closed_durable`.
    pub closed: bool,
    /// Reader-observable EOF: set only AFTER the closure is durable (under `strict`,
    /// the data fsync + meta fsync; under `fast`, the meta fsync — the data fsync
    /// is skipped). `tail()` reports this so a reader never observes EOF for a
    /// closure a crash could roll back (PROTOCOL.md §4.1). On recovery it equals the
    /// persisted `closed` (durable by definition). Caveat (fast): the *closedness*
    /// never rolls back, but the closed *position* can shrink on an OS/power crash
    /// (the un-synced tail is lost; recovered `tail` = on-disk size). The full
    /// strict-only position-monotonicity guarantee holds only under `strict`.
    pub closed_durable: bool,
    /// Producer that closed the stream (producer_id, epoch, seq), for idempotent re-close.
    pub closed_by: Option<(String, u64, u64)>,
    pub producers: HashMap<String, ProducerState>,
    pub last_seq_header: Option<String>,
    pub last_access: SystemTime,
    /// Number of live forks reading through this stream.
    pub ref_count: u32,
    /// Deleted while forks still reference it: direct ops 410, path blocked.
    pub soft_deleted: bool,
}

pub struct Appender {
    pub file: Arc<File>,
    pub written: u64,
}

/// macOS uses fcntl(F_FULLFSYNC) for a true flush-to-platter (power-loss
/// durable), accepting slower fsyncs in macOS dev; the no-loss guarantee holds
/// on every platform. On Linux use fdatasync.
///
/// Returns the fsync result: a failure (e.g. EIO writeback error) MUST be
/// surfaced to the caller so an append is never acked as durable when the data
/// did not reach stable storage.
/// BENCH-ONLY: whether `DS_BENCH_FAST_FSYNC` requests plain `fsync` over
/// `F_FULLFSYNC` on macOS (see [`barrier_fsync`]). Read once and cached — the env
/// is fixed for the process lifetime.
#[cfg(target_os = "macos")]
fn fast_fsync_enabled() -> bool {
    use std::sync::OnceLock;
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("DS_BENCH_FAST_FSYNC").is_some())
}

pub(crate) fn barrier_fsync(file: &File) -> std::io::Result<()> {
    let fd = file.as_raw_fd();
    #[cfg(target_os = "macos")]
    unsafe {
        // BENCH-ONLY escape hatch (NOT for production durability): when
        // `DS_BENCH_FAST_FSYNC` is set, use a plain `fsync` instead of
        // `F_FULLFSYNC`. On macOS `F_FULLFSYNC` forces a true drive-cache barrier
        // (~tens of ms even on a RAM disk), which dominates the commit path and
        // masks the per-shard LOCK contention this build is meant to study. Plain
        // `fsync` on a RAM disk is ~free, reproducing the cheap-fsync (Linux +
        // NVMe) regime where the lock is the bottleneck. Never set this where data
        // must survive power loss.
        if fast_fsync_enabled() {
            return if libc::fsync(fd) == 0 {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            };
        }
        // Force a true flush to platter; fall back to a plain fsync. Only error
        // if the final fallback also fails.
        if libc::fcntl(fd, libc::F_FULLFSYNC) == 0 {
            return Ok(());
        }
        // Preserve the F_FULLFSYNC cause before falling back; on double failure the
        // fallback fsync's errno alone would mislead durability diagnostics.
        let fullfsync_err = std::io::Error::last_os_error();
        if libc::fsync(fd) == 0 {
            return Ok(());
        }
        Err(std::io::Error::other(format!(
            "F_FULLFSYNC failed ({fullfsync_err}); fallback fsync also failed ({})",
            std::io::Error::last_os_error()
        )))
    }
    #[cfg(not(target_os = "macos"))]
    unsafe {
        if libc::fdatasync(fd) == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }
}

pub struct StreamState {
    pub id: u64,
    pub path: String,
    pub config: StreamConfig,
    pub is_json: bool,
    pub file_path: PathBuf,
    /// Logical offset where this stream's own file starts (fork point; 0 for roots).
    /// Immutable for the stream's lifetime; offsets below it route to `parent`.
    /// The live data file's *physical* start is `Shared::file_base`, which may
    /// advance past `base_offset` as compaction reclaims the sealed prefix.
    pub base_offset: u64,
    /// Fork source: ranges below base_offset are read through this chain.
    pub parent: Option<Arc<StreamState>>,
    pub appender: AsyncMutex<Appender>,
    pub shared: RwLock<Shared>,
    pub tail_tx: watch::Sender<Tail>,
    /// True while a debounced meta flush is pending.
    pub meta_dirty: AtomicBool,
    /// Serializes sidecar writes for this stream. Concurrent writers (append
    /// flush, close, tiering offload flip, delete) otherwise race on the shared
    /// `.meta.tmp` file and can reorder their renames, letting a stale non-durable
    /// flush clobber a durable manifest flip. Held across capture+write+rename so
    /// the last writer persists the freshest captured state.
    pub meta_lock: StdMutex<()>,
    /// Most recently appended wire chunk, kept resident so caught-up live
    /// readers (SSE / long-poll) and immediate catch-up reads are served from
    /// memory — one read+encode shared across all subscribers — instead of a
    /// per-subscriber file read. `(start, bytes)` covers `[start, start+len)`.
    /// Only populated for chunks up to the tail-cache cap (large appends fall back
    /// to file reads / sendfile). See set_last_chunk / tail_chunk_slice.
    /// `RwLock` (not `Mutex`) so concurrent readers fanning out over the same
    /// just-appended tail share it without serializing on a lock.
    pub last_chunk: RwLock<Option<(u64, bytes::Bytes)>>,
    /// Hot/cold tiering state: the per-stream sealing manifest. Always present;
    /// empty and inert unless tiering is enabled (`--tier`). See tier.rs.
    pub tier: crate::tier::TierState,
    /// Remote tier handle, cloned from the Store. None when tiering is off, so
    /// the read path stays a pure local-fd path in the default build.
    pub blobstore: Option<crate::blobstore::SharedBlobStore>,
    /// In-flight live-file compaction intent. `Some` only during a compaction
    /// pass (between the intent meta-write and its clear). Persisted by
    /// `Meta::capture` so a crash mid-compaction is recoverable. See tier.rs.
    pub compaction: StdMutex<Option<PendingCompaction>>,
    /// Reactor-served SSE subscribers of this stream (Linux). `None` while the
    /// stream has none — the common case — so idle streams cost only the lock +
    /// a null pointer; the list (and its allocation) exist only while subscribers
    /// are attached. See sse_reactor.rs.
    #[cfg(target_os = "linux")]
    pub sse_subs: StdMutex<Option<Box<StreamSubs>>>,
}

/// Reactor subscriber list for one stream — populated only while subscribers are
/// attached (kept behind `Option<Box<…>>` so idle streams pay nothing).
#[cfg(target_os = "linux")]
pub struct StreamSubs {
    pub subs: Vec<SubHandle>,
}

/// Locates one reactor subscriber: which shard owns it, its slab key, and the
/// slot generation (so a stale wake for a freed/reused slot is ignored).
#[cfg(target_os = "linux")]
#[derive(Clone, Copy)]
pub struct SubHandle {
    pub shard: u16,
    pub key: u32,
    pub gen: u32,
}

/// Crash-recovery intent for a live-file compaction in progress. While set, the
/// live data file is being swapped from `[old_file_base, tail)` to
/// `[new_file_base, tail)`; because compaction holds the appender lock end to
/// end, `tail` is frozen, so on boot the on-disk file ends at `tail` whichever
/// side of the rename the crash fell on. Recovery sets
/// `file_base = tail - file_size`, which resolves to the correct base for either
/// file. See `recover_one_inner`.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct PendingCompaction {
    pub new_file_base: u64,
    pub tail: u64,
}

/// Default resident tail-chunk cap (bytes). macOS has **no `sendfile`** — reads
/// fall back to positioned `pread`, so the in-memory tail cache is the read
/// fast-path and is **ON by default** there (64 KiB). Linux serves reads
/// zero-copy via `sendfile`, so the cache is **OFF by default** (`0`); enable /
/// tune with `--tail-cache-bytes`.
#[cfg(target_os = "macos")]
pub const DEFAULT_TAIL_CACHE_BYTES: usize = 64 * 1024;
#[cfg(not(target_os = "macos"))]
pub const DEFAULT_TAIL_CACHE_BYTES: usize = 0;

/// Resident tail-chunk cap in bytes (process-global; set once at startup from
/// `--tail-cache-bytes`). `0` disables the cache — every read resolves to the
/// file (`sendfile` / `pread`). Appends larger than the cap are not cached.
static TAIL_CACHE_BYTES: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(DEFAULT_TAIL_CACHE_BYTES);

/// Set the resident tail-cache cap (bytes). `0` disables the cache.
pub fn set_tail_cache_bytes(n: usize) {
    TAIL_CACHE_BYTES.store(n, Ordering::Relaxed);
}
/// Current resident tail-cache cap (bytes). `0` = disabled.
pub fn tail_cache_bytes() -> usize {
    TAIL_CACHE_BYTES.load(Ordering::Relaxed)
}

impl StreamState {
    /// Open a fresh `O_WRONLY` fd on the data file for positioned splice writes.
    ///
    /// The shared `Appender.file` is opened `O_APPEND`, which `splice(2)` rejects
    /// as a target (it ignores the supplied offset). The zero-copy append path
    /// therefore opens its own non-`O_APPEND` write fd and positions every write
    /// explicitly (`pwrite` for the buffered prefix, `splice` with an offset for
    /// the socket relay). Called under the appender lock, so no other writer can
    /// move the logical tail underneath it.
    #[cfg(target_os = "linux")]
    pub fn open_splice_fd(&self) -> std::io::Result<std::fs::File> {
        // O_RDWR (not O_WRONLY): this same fd is the positioned-WRITE target for the
        // socket→file splice AND the READ source for the file→WAL relay splice, so it
        // must be readable. (Not O_APPEND — splice rejects O_APPEND targets.)
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&self.file_path)
    }

    /// Record the just-appended wire chunk as the resident tail. `start` is the
    /// logical offset where `bytes` begins. Chunks larger than the tail-cache cap
    /// (or any append when the cache is disabled) are not cached (the entry is
    /// cleared so a stale chunk is never served).
    pub fn set_last_chunk(&self, start: u64, bytes: bytes::Bytes) {
        let cap = tail_cache_bytes();
        let mut g = self.last_chunk.write().unwrap();
        *g = if cap > 0 && bytes.len() <= cap {
            Some((start, bytes))
        } else {
            None
        };
    }

    /// Return the resident bytes for `[want_start, want_end)` iff the cached
    /// tail chunk fully covers that range; otherwise None (caller reads the
    /// file). Cheap: `Bytes::slice` is a refcount bump, no copy.
    pub fn tail_chunk_slice(&self, want_start: u64, want_end: u64) -> Option<bytes::Bytes> {
        // Cache disabled (cap 0) → straight to the file path, no lock taken.
        if want_end <= want_start || tail_cache_bytes() == 0 {
            return None;
        }
        let g = self.last_chunk.read().unwrap();
        let (cstart, cbytes) = g.as_ref()?;
        let cend = cstart + cbytes.len() as u64;
        if *cstart <= want_start && want_end <= cend {
            let a = (want_start - cstart) as usize;
            let b = (want_end - cstart) as usize;
            Some(cbytes.slice(a..b))
        } else {
            None
        }
    }

    pub fn tail(&self) -> Tail {
        let s = self.shared.read().unwrap();
        Tail {
            // Readers observe bytes only once they are durable, and EOF only once
            // the closure is durable.
            bytes: s.durable_tail,
            closed: s.closed_durable,
        }
    }

    pub fn touch(&self) {
        let mut s = self.shared.write().unwrap();
        s.last_access = SystemTime::now();
    }

    pub fn is_expired(&self) -> bool {
        let now = SystemTime::now();
        if let Some(exp) = self.config.expires_at {
            if now > exp {
                return true;
            }
        }
        if let Some(ttl) = self.config.ttl_seconds {
            let last = self.shared.read().unwrap().last_access;
            if now > last + Duration::from_secs(ttl) {
                return true;
            }
        }
        false
    }

    pub fn etag(&self, start: u64, end: u64, closed: bool) -> String {
        if closed {
            format!("\"{}:{}:{}:c\"", self.id, start, end)
        } else {
            format!("\"{}:{}:{}\"", self.id, start, end)
        }
    }
}

pub struct Store {
    pub streams: DashMap<String, Arc<StreamState>>,
    pub data_dir: PathBuf,
    next_id: AtomicU64,
    /// Hot/cold tiering config (Off by default → fully inert).
    pub tier_config: crate::tier::TierConfig,
    /// Remote object-storage backend, present only when tiering is enabled.
    pub blobstore: Option<crate::blobstore::SharedBlobStore>,
    /// The sharded write-ahead log, present only under `--durability wal`. Empty
    /// for `strict`/`fast`, which keeps the WAL inert and those paths unchanged.
    ///
    /// A `OnceLock` (not a plain `Option`) so it can be attached **once**,
    /// post-construction, on the already-`Arc`-wrapped `Store`: `new_with_tier`
    /// runs the sidecar recover pass before the WAL is built, then main.rs builds
    /// the `WalSet`, runs WAL recovery, and `set`s it here — all before serving.
    /// The hot-path read (`store.wal.get()`) is lock-free.
    pub wal: std::sync::OnceLock<Arc<crate::wal::walset::WalSet>>,
}

pub enum CreateResult {
    Created(Arc<StreamState>),
    Exists(Arc<StreamState>),
    Conflict,
}

impl Store {
    /// Build a Store with an explicit tiering configuration. When
    /// `tier.kind == Off` (the default) this is identical to `new`: no
    /// blobstore, no sealing, single contiguous file per stream.
    pub fn new_with_tier(
        data_dir: PathBuf,
        tier_config: crate::tier::TierConfig,
    ) -> std::io::Result<Self> {
        let streams_dir = data_dir.join("streams");
        std::fs::create_dir_all(&streams_dir)?;
        // Stream data can be sensitive; keep the data dir owner-only (best-effort).
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&data_dir, std::fs::Permissions::from_mode(0o700));
        }
        // Intentional u128→u64 truncation: this is only an id seed, and it is
        // masked by `& MAX_SAFE_INT` below. Non-panicking on a pre-1970 clock
        // (unlike `.unwrap()`), matching the `unix_secs` helper's discipline.
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        let blobstore = build_blobstore(&tier_config, &data_dir)?;
        let store = Store {
            streams: DashMap::new(),
            data_dir,
            next_id: AtomicU64::new(seed & MAX_SAFE_INT),
            tier_config,
            blobstore,
            wal: std::sync::OnceLock::new(),
        };
        store.recover(&streams_dir)?;
        Ok(store)
    }

    /// Directory holding staged sealed chunk files (separate from `streams/` so
    /// recovery's data-file scan never trips over them).
    pub fn segments_dir(&self) -> PathBuf {
        self.data_dir.join("segments")
    }

    /// Rebuild stream state from data files + metadata sidecars. The data file
    /// is the source of truth for content (tail = base_offset + file size, a
    /// property of the contiguous wire-byte layout); the sidecar provides
    /// everything else. Orphan files (crash between create and meta write) are
    /// discarded.
    fn recover(&self, streams_dir: &std::path::Path) -> std::io::Result<()> {
        let mut metas: HashMap<String, (Meta, PathBuf)> = HashMap::new();
        let mut data_files: Vec<PathBuf> = Vec::new();
        for entry in std::fs::read_dir(streams_dir)? {
            let p = entry?.path();
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.ends_with(".meta.tmp") {
                let _ = std::fs::remove_file(&p);
            } else if name.ends_with(".compact.tmp") {
                // A compaction temp file. It belongs to its data file and is
                // handled by `recover_one_inner` (promoted when it holds the
                // durable residual for a pending intent, else removed there). Do
                // NOT treat it as an orphan data file — that would delete the
                // durable residual before recovery can promote it.
            } else if name.ends_with(".meta") {
                let data_path = PathBuf::from(p.as_os_str().to_str().unwrap().trim_end_matches(".meta"));
                if data_path.exists() {
                    if let Ok(bytes) = std::fs::read(&p) {
                        if let Ok(meta) = serde_json::from_slice::<Meta>(&bytes) {
                            metas.insert(meta.path.clone(), (meta, data_path));
                            continue;
                        }
                    }
                }
                let _ = std::fs::remove_file(&p);
            } else {
                data_files.push(p);
            }
        }
        // Drop orphan data files (no usable sidecar).
        for p in data_files {
            if !metas.values().any(|(_, dp)| *dp == p) {
                let _ = std::fs::remove_file(&p);
            }
        }
        let mut max_id = 0u64;
        let paths: Vec<String> = metas.keys().cloned().collect();
        // `visiting` tracks the active recursion stack to break cyclic
        // forked_from chains in corrupt sidecars (would otherwise overflow the
        // stack on boot). It self-empties between top-level calls.
        let mut visiting = HashSet::new();
        for path in paths {
            self.recover_one(&path, &metas, &mut visiting);
        }
        for (m, _) in metas.values() {
            max_id = max_id.max(m.id);
        }
        // Keep ids unique across restarts (they feed ETags).
        let cur = self.next_id.load(Ordering::Relaxed);
        self.next_id.store(cur.max(max_id + 1), Ordering::Relaxed);
        Ok(())
    }

    fn recover_one(
        &self,
        path: &str,
        metas: &HashMap<String, (Meta, PathBuf)>,
        visiting: &mut HashSet<String>,
    ) -> Option<Arc<StreamState>> {
        if let Some(existing) = self.streams.get(path) {
            return Some(existing.clone());
        }
        // Break a cyclic forked_from chain (corrupt sidecar) instead of recursing
        // forever. Removed on the way out so shared parents still resolve above.
        if !visiting.insert(path.to_string()) {
            return None;
        }
        let result = self.recover_one_inner(path, metas, visiting);
        visiting.remove(path);
        result
    }

    fn recover_one_inner(
        &self,
        path: &str,
        metas: &HashMap<String, (Meta, PathBuf)>,
        visiting: &mut HashSet<String>,
    ) -> Option<Arc<StreamState>> {
        let (meta, data_path) = metas.get(path)?;
        // Fork parents must be linked first (chains are acyclic; a parent always
        // outlives its forks, so a missing parent means corruption — skip).
        let parent = match &meta.forked_from {
            Some(src) => match self.recover_one(src, metas, visiting) {
                Some(p) => Some(p),
                // Nothing inherited → the fork stands alone; otherwise the
                // chain is broken (corruption) and the stream is skipped.
                None if meta.base_offset == 0 => None,
                None => return None,
            },
            None => None,
        };
        // A `pending_compaction` intent means a compaction crashed mid-flight. The
        // temp file (`compact.tmp`) holds the fsynced full residual `[cut, tail)`
        // (step 1's `sync_all` is NOT gated by fast), persisted durably BEFORE
        // the intent (`tier.rs`). So when the intent is durable, an intact temp is
        // the source of truth — finish the swap by promoting it. We must NOT trust
        // `p.tail - old_file_size` against the OLD live file: under `fast` the
        // old file's tail was never fsynced, so its on-disk size can be short,
        // which would both over-report `tail` AND skew `file_base` (C3).
        let tmp_path = data_path.with_extension("compact.tmp");
        if let Some(p) = &meta.pending_compaction {
            let want_residual = p.tail.checked_sub(p.new_file_base);
            let tmp_len = std::fs::metadata(&tmp_path).ok().map(|m| m.len());
            if let (Some(want), Some(have)) = (want_residual, tmp_len) {
                if have == want {
                    // Crash before the rename: promote the durable temp into place
                    // (idempotent — completes step 3). Now the live file IS the full
                    // residual regardless of the short un-synced old file.
                    let _ = std::fs::rename(&tmp_path, data_path);
                    let _ = fsync_parent_dir(data_path);
                }
                // else: a partial temp (intent not yet covering it) — fall through
                // and treat as post-rename (live file authoritative).
            }
        }
        // Remove any temp not promoted above (post-rename leftover, or a partial).
        let _ = std::fs::remove_file(&tmp_path);
        let file = Arc::new(
            OpenOptions::new()
                .read(true)
                .append(true)
                .open(data_path)
                .ok()?,
        );
        let written = file.metadata().ok()?.len();
        // `file_base` is the live file's logical start. With a `pending_compaction`
        // intent and the durable temp promoted above, the live file IS the full
        // residual `[new_file_base, tail)` — so `file_base = new_file_base`, derived
        // from the durable cut and NOT from `tail - file_size` (a short un-synced
        // file can't skew the mapping). If the temp was already gone (post-rename)
        // the live file is likewise the residual, detected by its size matching
        // `tail - new_file_base`. Only if neither holds (a full pre-rename old file
        // with no recoverable temp — not reachable once the intent is durable,
        // since the temp is fsynced first) do we fall back to the old
        // `tail - file_size` mapping. Without an intent, trust the persisted
        // `file_base` (defaulting to `base_offset` for pre-compaction sidecars).
        let (file_base, tail) = match meta.pending_compaction {
            Some(p) if written == p.tail.saturating_sub(p.new_file_base) => {
                // Live file is the residual (temp promoted, or crash after rename).
                (p.new_file_base, p.tail)
            }
            Some(p) if p.tail >= written => {
                // Fallback: a full old file still in place with no durable temp.
                (p.tail - written, p.tail)
            }
            Some(p) => (p.new_file_base, p.new_file_base + written),
            _ => {
                let fb = meta.file_base.unwrap_or(meta.base_offset);
                (fb, fb + written)
            }
        };
        let (tail_tx, _) = watch::channel(Tail {
            bytes: tail,
            closed: meta.closed,
        });
        let state = Arc::new(StreamState {
            id: meta.id,
            path: path.to_string(),
            is_json: is_json_content_type(&meta.content_type),
            file_path: data_path.clone(),
            base_offset: meta.base_offset,
            parent,
            appender: AsyncMutex::new(Appender { file: file.clone(), written }),
            shared: RwLock::new(Shared {
                tail,
                // Recovered/opened tail is durable by definition.
                durable_tail: tail,
                file_base,
                file,
                closed: meta.closed,
                closed_durable: meta.closed,
                closed_by: meta.closed_by.clone(),
                producers: meta.producers.clone(),
                last_seq_header: meta.last_seq_header.clone(),
                last_access: UNIX_EPOCH + Duration::from_secs(meta.last_access_unix),
                ref_count: meta.ref_count,
                soft_deleted: meta.soft_deleted,
            }),
            tail_tx,
            meta_dirty: AtomicBool::new(false),
            meta_lock: StdMutex::new(()),
            last_chunk: RwLock::new(None),
            tier: crate::tier::TierState::from_meta(
                &meta.segments,
                meta.sealed_offset,
                &self.segments_dir(),
            ),
            blobstore: self.blobstore.clone(),
            // A `pending_compaction` intent is re-derived deterministically from
            // the file size each boot (see `file_base` above), so the in-memory
            // cell starts clear; the next meta write persists the cleared marker.
            compaction: StdMutex::new(None),
            #[cfg(target_os = "linux")]
            sse_subs: StdMutex::new(None),
            config: StreamConfig {
                content_type: meta.content_type.clone(),
                ttl_seconds: meta.ttl_seconds,
                expires_at: meta
                    .expires_at_unix
                    .map(|s| UNIX_EPOCH + Duration::from_secs(s)),
                expires_at_raw: meta.expires_at_raw.clone(),
                create_closed: meta.create_closed,
                forked_from: meta.forked_from.clone(),
                fork_offset_raw: meta.fork_offset_raw.clone(),
                fork_sub_offset: meta.fork_sub_offset,
            },
        });
        // Re-enqueue any sealed-but-not-yet-offloaded segments left by a crash
        // mid-offload (placement still Local while a remote tier is configured).
        self.reconcile_manifest_on_boot(&state);
        self.streams.insert(path.to_string(), state.clone());
        Some(state)
    }

    /// Look up a stream. Expired streams are removed (or soft-deleted when forks
    /// still reference them). Soft-deleted entries ARE returned — callers decide
    /// between 410 (direct ops) and 409 (PUT re-create / fork source).
    pub fn get(&self, path: &str) -> Option<Arc<StreamState>> {
        let st = self.streams.get(path)?.clone();
        if st.shared.read().unwrap().soft_deleted {
            return Some(st);
        }
        if st.is_expired() {
            self.delete_or_soft_delete(&st);
            return None;
        }
        Some(st)
    }

    /// Hard-delete when nothing references the stream; soft-delete otherwise.
    pub fn delete_or_soft_delete(&self, st: &Arc<StreamState>) {
        let soft = {
            let mut s = st.shared.write().unwrap();
            if s.ref_count > 0 {
                s.soft_deleted = true;
                true
            } else {
                false
            }
        };
        if soft {
            let st2 = st.clone();
            tokio::task::spawn_blocking(move || {
                let _ = write_meta_sync(&st2, true);
            });
        } else {
            self.streams
                .remove_if(&st.path, |_, v| Arc::ptr_eq(v, st));
            // Reclaim this stream's offloaded segments (remote objects + any
            // staged local chunk files) — safe only here, on a true hard delete
            // with no remaining fork references.
            self.gc_remote_segments(st);
            let fp = st.file_path.clone();
            tokio::task::spawn_blocking(move || {
                let _ = std::fs::remove_file(meta_path(&fp));
                let _ = std::fs::remove_file(fp);
            });
            self.release_parent(st);
        }
    }

    /// Decrement the parent's fork refcount; cascade-collect soft-deleted parents
    /// whose last fork just went away.
    pub fn release_parent(&self, st: &Arc<StreamState>) {
        let mut cur = st.parent.clone();
        while let Some(parent) = cur {
            let gone = {
                let mut s = parent.shared.write().unwrap();
                s.ref_count = s.ref_count.saturating_sub(1);
                s.soft_deleted && s.ref_count == 0
            };
            if !gone {
                // Persist the decremented refcount.
                let p2 = parent.clone();
                tokio::task::spawn_blocking(move || {
                    let _ = write_meta_sync(&p2, true);
                });
                break;
            }
            self.streams
                .remove_if(&parent.path, |_, v| Arc::ptr_eq(v, &parent));
            self.gc_remote_segments(&parent);
            let fp = parent.file_path.clone();
            tokio::task::spawn_blocking(move || {
                let _ = std::fs::remove_file(meta_path(&fp));
                let _ = std::fs::remove_file(fp);
            });
            cur = parent.parent.clone();
        }
    }

    pub fn create(
        &self,
        path: &str,
        config: StreamConfig,
        parent: Option<Arc<StreamState>>,
        base_offset: u64,
    ) -> std::io::Result<CreateResult> {
        use dashmap::mapref::entry::Entry;
        // Fast path: existing stream → config comparison.
        if let Some(existing) = self.get(path) {
            if existing.shared.read().unwrap().soft_deleted {
                return Ok(CreateResult::Conflict);
            }
            return Ok(if config_matches(&existing, &config) {
                CreateResult::Exists(existing)
            } else {
                CreateResult::Conflict
            });
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let fname = format!("{}~{}", encode_path(path), id);
        let file_path = self.data_dir.join("streams").join(fname);
        let file = Arc::new(
            OpenOptions::new()
                .create(true)
                .read(true)
                .append(true)
                .open(&file_path)?,
        );
        let is_json = is_json_content_type(&config.content_type);
        let closed = config.create_closed;
        let (tail_tx, _) = watch::channel(Tail {
            bytes: base_offset,
            closed,
        });
        let state = Arc::new(StreamState {
            id,
            path: path.to_string(),
            is_json,
            file_path,
            base_offset,
            parent: parent.clone(),
            appender: AsyncMutex::new(Appender { file: file.clone(), written: 0 }),
            shared: RwLock::new(Shared {
                tail: base_offset,
                durable_tail: base_offset,
                file_base: base_offset,
                file,
                closed,
                closed_durable: closed,
                closed_by: None,
                producers: HashMap::new(),
                last_seq_header: None,
                last_access: SystemTime::now(),
                ref_count: 0,
                soft_deleted: false,
            }),
            tail_tx,
            meta_dirty: AtomicBool::new(false),
            meta_lock: StdMutex::new(()),
            last_chunk: RwLock::new(None),
            tier: crate::tier::TierState::default(),
            blobstore: self.blobstore.clone(),
            compaction: StdMutex::new(None),
            #[cfg(target_os = "linux")]
            sse_subs: StdMutex::new(None),
            config,
        });
        match self.streams.entry(path.to_string()) {
            Entry::Occupied(e) => {
                // Lost a race; compare against the winner.
                let existing = e.get().clone();
                let fp = state.file_path.clone();
                let _ = std::fs::remove_file(fp);
                if existing.shared.read().unwrap().soft_deleted {
                    return Ok(CreateResult::Conflict);
                }
                Ok(if config_matches(&existing, &state.config) {
                    CreateResult::Exists(existing)
                } else {
                    CreateResult::Conflict
                })
            }
            Entry::Vacant(v) => {
                v.insert(state.clone());
                // Take the fork reference only once insertion has succeeded, so
                // rejected/raced creates never leak a refcount on the source.
                if let Some(p) = &parent {
                    p.shared.write().unwrap().ref_count += 1;
                    write_meta_sync(p, true)?;
                }
                write_meta_sync(&state, true)?;
                Ok(CreateResult::Created(state))
            }
        }
    }
}

fn config_matches(existing: &StreamState, requested: &StreamConfig) -> bool {
    let ex = &existing.config;
    let closed_now = existing.shared.read().unwrap().closed;
    media_type(&ex.content_type) == media_type(&requested.content_type)
        && ex.ttl_seconds == requested.ttl_seconds
        && ex.expires_at_raw == requested.expires_at_raw
        && ex.forked_from == requested.forked_from
        && ex.fork_offset_raw == requested.fork_offset_raw
        && ex.fork_sub_offset.unwrap_or(0) == requested.fork_sub_offset.unwrap_or(0)
        // PUT without Stream-Closed against a closed stream is a conflict.
        && (requested.create_closed == closed_now)
}

pub fn media_type(ct: &str) -> String {
    ct.split(';').next().unwrap_or("").trim().to_ascii_lowercase()
}

pub fn is_json_content_type(ct: &str) -> bool {
    media_type(ct) == "application/json"
}

fn encode_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for c in path.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
            out.push(c);
        } else {
            out.push('+');
        }
    }
    if out.len() > 120 {
        out.truncate(120);
    }
    out
}

/// A physical read: `len` bytes starting at `file_start` in `file`.
pub struct Segment {
    pub file: Arc<File>,
    pub file_start: u64,
    pub len: u64,
}

impl Segment {
    /// Exclusive end byte position in the file (`file_start + len`).
    pub fn file_end(&self) -> u64 {
        self.file_start + self.len
    }
}

/// Read all `segments` into one contiguous buffer. Returns empty bytes if any
/// positioned read fails (e.g. the file was removed mid-read). Shared by the
/// buffered read paths (SSE batches, small inline reads).
pub fn materialize_segments(segments: &[Segment]) -> bytes::Bytes {
    use bytes::BytesMut;
    use std::os::unix::fs::FileExt;
    let total: usize = segments.iter().map(|s| s.len as usize).sum();
    let mut buf = BytesMut::zeroed(total);
    let mut at = 0;
    for seg in segments {
        let n = seg.len as usize;
        if seg.file.read_exact_at(&mut buf[at..at + n], seg.file_start).is_err() {
            return bytes::Bytes::new();
        }
        at += n;
    }
    buf.freeze()
}

// ---------------- hot/cold tiering: sealing, offload, resolution, GC ----------------

/// Build the configured remote blobstore, if any. Off → None. Local → a
/// filesystem-backed blobstore under `<data_dir>/cold` (or the configured dir).
/// S3 → the object_store adapter (feature `tier` only).
fn build_blobstore(
    cfg: &crate::tier::TierConfig,
    data_dir: &std::path::Path,
) -> std::io::Result<Option<crate::blobstore::SharedBlobStore>> {
    use crate::tier::TierKind;
    match cfg.kind {
        TierKind::Off => Ok(None),
        TierKind::Local => {
            let dir = cfg
                .local_dir
                .clone()
                .unwrap_or_else(|| data_dir.join("cold"));
            let bs = crate::blobstore::LocalFsBlobStore::new(dir)?;
            Ok(Some(Arc::new(bs)))
        }
        TierKind::S3 => {
            #[cfg(feature = "tier")]
            {
                let bs = crate::blobstore::S3BlobStore::new(cfg)?;
                Ok(Some(Arc::new(bs)))
            }
            #[cfg(not(feature = "tier"))]
            {
                let _ = cfg;
                Err(std::io::Error::other(
                    "--tier s3 requires building with `--features tier`",
                ))
            }
        }
    }
}

// The hot/cold tiering lifecycle (sealing, offload, GC, boot reconcile) and the
// placement-aware read resolver live in `tier.rs`. Re-export the read API here so
// callers keep a single `store::` facade for resolving a logical range.
pub use crate::tier::{into_local_segments, resolve_range, ResolvedSlice};


// ---------------- metadata persistence & recovery ----------------

/// On-disk metadata sidecar (`<data file>.meta`). Create/close/delete write it
/// synchronously with fsync; producer/access updates flush debounced without
/// fsync (documented guarantee: after a crash, producer dedup state may lag the
/// data file — producers should bump their epoch on restart, per PROTOCOL.md).
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Meta {
    pub id: u64,
    pub path: String,
    pub content_type: String,
    pub ttl_seconds: Option<u64>,
    pub expires_at_unix: Option<u64>,
    pub expires_at_raw: Option<String>,
    pub create_closed: bool,
    pub forked_from: Option<String>,
    pub fork_offset_raw: Option<String>,
    pub fork_sub_offset: Option<u64>,
    pub base_offset: u64,
    pub closed: bool,
    pub closed_by: Option<(String, u64, u64)>,
    pub producers: HashMap<String, ProducerState>,
    pub last_seq_header: Option<String>,
    pub last_access_unix: u64,
    pub ref_count: u32,
    pub soft_deleted: bool,
    /// Hot/cold tiering manifest. Empty for streams that never sealed (the
    /// default). `#[serde(default)]` keeps sidecars written by the pre-tiering
    /// server fully forward/backward compatible.
    #[serde(default)]
    pub segments: Vec<MetaSegment>,
    #[serde(default)]
    pub sealed_offset: u64,
    /// Logical start of the live data file (compaction watermark). `None` in
    /// pre-compaction sidecars → recovery falls back to `base_offset`, so old
    /// sidecars stay fully compatible.
    #[serde(default)]
    pub file_base: Option<u64>,
    /// Set only while a compaction is mid-flight; drives crash recovery. Cleared
    /// once the rewrite + swap completes durably.
    #[serde(default)]
    pub pending_compaction: Option<PendingCompaction>,
}

/// Serialized form of a sealed-segment manifest entry.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct MetaSegment {
    pub logical_start: u64,
    pub len: u64,
    /// When set, the segment is offloaded to the remote tier under this key.
    /// When None, it is still a local chunk file (path derived from the stream's
    /// data file + index, see segment_file_path).
    pub remote_key: Option<String>,
    /// File name of the local chunk file (relative to the segments dir) when not
    /// yet remote. None once offloaded.
    pub local_file: Option<String>,
}

fn unix_secs(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

impl Meta {
    fn capture(st: &StreamState) -> Meta {
        let s = st.shared.read().unwrap();
        Meta {
            id: st.id,
            path: st.path.clone(),
            content_type: st.config.content_type.clone(),
            ttl_seconds: st.config.ttl_seconds,
            expires_at_unix: st.config.expires_at.map(unix_secs),
            expires_at_raw: st.config.expires_at_raw.clone(),
            create_closed: st.config.create_closed,
            forked_from: st.config.forked_from.clone(),
            fork_offset_raw: st.config.fork_offset_raw.clone(),
            fork_sub_offset: st.config.fork_sub_offset,
            base_offset: st.base_offset,
            closed: s.closed,
            closed_by: s.closed_by.clone(),
            producers: s.producers.clone(),
            last_seq_header: s.last_seq_header.clone(),
            last_access_unix: unix_secs(s.last_access),
            ref_count: s.ref_count,
            soft_deleted: s.soft_deleted,
            segments: {
                let m = st.tier.manifest.lock().unwrap();
                m.segments
                    .iter()
                    .map(|seg| match &seg.placement {
                        crate::tier::Placement::Local(p) => MetaSegment {
                            logical_start: seg.logical_start,
                            len: seg.len,
                            remote_key: None,
                            local_file: p
                                .file_name()
                                .and_then(|n| n.to_str())
                                .map(|s| s.to_string()),
                        },
                        crate::tier::Placement::Remote(key) => MetaSegment {
                            logical_start: seg.logical_start,
                            len: seg.len,
                            remote_key: Some(key.clone()),
                            local_file: None,
                        },
                    })
                    .collect()
            },
            sealed_offset: st.tier.manifest.lock().unwrap().sealed_offset,
            file_base: Some(s.file_base),
            pending_compaction: *st.compaction.lock().unwrap(),
        }
    }
}

pub fn meta_path(file_path: &std::path::Path) -> PathBuf {
    let mut p = file_path.as_os_str().to_owned();
    p.push(".meta");
    PathBuf::from(p)
}

/// Write the metadata sidecar. `durable` forces an fsync (create/close/delete).
pub fn write_meta_sync(st: &StreamState, durable: bool) -> std::io::Result<()> {
    // Serialize per stream so concurrent writers don't race on the temp file or
    // reorder renames (a stale flush must not clobber a durable manifest flip).
    let _g = st.meta_lock.lock().unwrap_or_else(|e| e.into_inner());
    let meta = Meta::capture(st);
    let bytes = serde_json::to_vec(&meta).expect("meta serializes");
    let tmp = meta_path(&st.file_path).with_extension("meta.tmp");
    let final_path = meta_path(&st.file_path);
    {
        use std::io::Write;
        let mut f = File::create(&tmp)?;
        f.write_all(&bytes)?;
        if durable {
            f.sync_all()?;
        }
    }
    std::fs::rename(&tmp, &final_path)?;
    // A rename is crash-durable only once the parent dir entry is fsynced.
    if durable {
        fsync_parent_dir(&final_path)?;
    }
    Ok(())
}

/// fsync the directory containing `path`, making a prior create/rename in that
/// directory crash-durable. A POSIX directory fd supports fsync; `sync_all`
/// issues it.
pub(crate) fn fsync_parent_dir(path: &std::path::Path) -> std::io::Result<()> {
    match path.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => File::open(dir)?.sync_all(),
        _ => Ok(()),
    }
}

impl StreamState {
    /// Schedule a debounced, non-durable meta flush (producer/access updates).
    pub fn schedule_meta_flush(self: &Arc<Self>) {
        if self
            .meta_dirty
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return; // flush already scheduled
        }
        let st = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            st.meta_dirty.store(false, Ordering::Release);
            let _ = tokio::task::spawn_blocking(move || write_meta_sync(&st, false)).await;
        });
    }
}

// ---------------- offsets ----------------

pub const READ_SEQ: u64 = 0;

pub fn format_offset(bytes: u64) -> String {
    format!("{:016}_{:016}", READ_SEQ, bytes)
}

pub enum ParsedOffset {
    Start,
    Now,
    At(u64),
}

pub fn parse_offset(raw: Option<&str>) -> Result<ParsedOffset, ()> {
    match raw {
        None => Ok(ParsedOffset::Start),
        Some("-1") => Ok(ParsedOffset::Start),
        Some("now") => Ok(ParsedOffset::Now),
        Some(s) => {
            let (a, b) = s.split_once('_').ok_or(())?;
            if a.len() != 16 || b.len() != 16 {
                return Err(());
            }
            if !a.bytes().all(|c| c.is_ascii_digit()) || !b.bytes().all(|c| c.is_ascii_digit()) {
                return Err(());
            }
            let _seq: u64 = a.parse().map_err(|_| ())?;
            let bytes: u64 = b.parse().map_err(|_| ())?;
            Ok(ParsedOffset::At(bytes))
        }
    }
}

// ---------------- cursor (CDN collapsing) ----------------

/// Protocol epoch: Oct 9 2024 00:00:00 UTC, 20s intervals.
const CURSOR_EPOCH_UNIX: u64 = 1_728_432_000;
const CURSOR_INTERVAL_SECS: u64 = 20;

pub fn compute_cursor(client_cursor: Option<u64>) -> u64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let interval = now.saturating_sub(CURSOR_EPOCH_UNIX) / CURSOR_INTERVAL_SECS;
    match client_cursor {
        // Client is at/ahead of the current interval: advance by random jitter
        // (§10.1, 1–3600s i.e. 1–180 intervals) so collapsed waiters don't all
        // re-request in lockstep. Entropy from the sub-second clock (no rng dep).
        Some(c) if c >= interval => {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.subsec_nanos())
                .unwrap_or(0);
            c + 1 + (nanos % 180) as u64
        }
        _ => interval,
    }
}

// ---------------- tiering integration tests ----------------

#[cfg(test)]
mod tier_tests {
    use super::*;
    use crate::tier::{TierConfig, TierKind};

    fn tmp_dir(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "ds-tier-test-{tag}-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    fn local_tier(dir: &std::path::Path, segment_bytes: u64) -> TierConfig {
        TierConfig {
            kind: TierKind::Local,
            segment_bytes,
            local_dir: Some(dir.join("cold")),
            ..Default::default()
        }
    }

    /// Append raw wire bytes to a stream the same way the handler does: write to
    /// the appender file, bump `written` + `tail`. (Test-only shortcut around the
    /// HTTP handler.)
    async fn append_wire(st: &Arc<StreamState>, wire: &[u8]) {
        use std::io::Write;
        let mut ap = st.appender.lock().await;
        (&*ap.file).write_all(wire).unwrap();
        ap.written += wire.len() as u64;
        let mut s = st.shared.write().unwrap();
        let tail = s.file_base + ap.written;
        s.tail = tail;
        // Test shortcut: treat the write as immediately durable/visible.
        s.durable_tail = tail;
    }

    /// Read a logical range back through the placement-aware resolver, exactly as
    /// the handler's mixed-range path does, and return the materialized bytes.
    async fn read_logical(st: &Arc<StreamState>, start: u64, end: u64) -> Vec<u8> {
        let mut slices = Vec::new();
        resolve_range(st, start, end, &mut slices);
        let mut out = Vec::new();
        for sl in slices {
            match sl {
                ResolvedSlice::Local(seg) => {
                    let b = tokio::task::spawn_blocking(move || {
                        materialize_segments(&[seg])
                    })
                    .await
                    .unwrap();
                    out.extend_from_slice(&b);
                }
                ResolvedSlice::Remote { key, offset, len } => {
                    let bs = st.blobstore.clone().unwrap();
                    let b = bs.get_range(&key, offset, len).await.unwrap();
                    out.extend_from_slice(&b);
                }
            }
        }
        out
    }

    /// Test mirror of the handler gate: is `[start, end)` served entirely from
    /// local fds (the live data file and/or sealed chunk files), with no remote
    /// slice? Equivalent to `into_local_segments(resolve_range(..)).is_ok()`.
    fn all_local(st: &Arc<StreamState>, start: u64, end: u64) -> bool {
        let mut slices = Vec::new();
        resolve_range(st, start, end, &mut slices);
        into_local_segments(slices).is_ok()
    }

    #[tokio::test]
    async fn round_trip_through_cold_storage() {
        let dir = tmp_dir("roundtrip");
        let store = Arc::new(
            Store::new_with_tier(dir.clone(), local_tier(&dir, 64 * 1024)).unwrap(),
        );
        let cfg = StreamConfig {
            content_type: "application/octet-stream".into(),
            ttl_seconds: None,
            expires_at: None,
            expires_at_raw: None,
            create_closed: false,
            forked_from: None,
            fork_offset_raw: None,
            fork_sub_offset: None,
        };
        let st = match store.create("s/cold", cfg, None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };

        // Build a deterministic payload > 2 segments.
        let total = 200 * 1024usize;
        let payload: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
        // Append in chunks.
        for chunk in payload.chunks(8 * 1024) {
            append_wire(&st, chunk).await;
        }

        // Force sealing/offload.
        store.maybe_seal(&st).await;

        // The manifest should now hold remote segments covering a prefix.
        let (sealed, n_remote, n_local) = {
            let m = st.tier.manifest.lock().unwrap();
            (
                m.sealed_offset,
                m.segments.iter().filter(|s| s.remote).count(),
                m.segments.iter().filter(|s| !s.remote).count(),
            )
        };
        assert!(sealed >= 64 * 1024, "expected sealed prefix, got {sealed}");
        assert!(n_remote >= 1, "expected offloaded segments");
        assert_eq!(n_local, 0, "all sealed segments should be offloaded");

        // Full catch-up read must be byte-identical, spanning cold + hot.
        let got = read_logical(&st, 0, total as u64).await;
        assert_eq!(got, payload, "full round-trip mismatch");

        // A read spanning the hot/cold boundary returns identical bytes.
        let mid = sealed - 100;
        let got2 = read_logical(&st, mid, sealed + 100).await;
        assert_eq!(got2, payload[mid as usize..(sealed + 100) as usize]);

        // A cold (offloaded) range has a remote slice → not all-local; the hot
        // tail is served entirely from the live data file → all-local.
        assert!(!all_local(&st, 0, sealed));
        assert!(all_local(&st, sealed, total as u64));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn compaction_reclaims_live_file() {
        // With compaction on, once the reclaimable sealed prefix crosses
        // `compact_bytes` the live data file is rewritten to hold only the hot
        // tail `[sealed_offset, tail)`; reads of the full history stay exact.
        let dir = tmp_dir("compact-reclaim");
        let mut cfg = local_tier(&dir, 64 * 1024); // 64 KiB segments
        cfg.compact_bytes = 128 * 1024; // compact once ≥128 KiB is reclaimable
        let store = Arc::new(Store::new_with_tier(dir.clone(), cfg).unwrap());
        let scfg = StreamConfig {
            content_type: "application/octet-stream".into(),
            ttl_seconds: None,
            expires_at: None,
            expires_at_raw: None,
            create_closed: false,
            forked_from: None,
            fork_offset_raw: None,
            fork_sub_offset: None,
        };
        let st = match store.create("s/compact", scfg, None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };

        // 500 KiB → seals 7×64 KiB (448 KiB), leaving a 52 KiB hot tail.
        let total = 500 * 1024usize;
        let payload: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
        for chunk in payload.chunks(8 * 1024) {
            append_wire(&st, chunk).await;
        }

        store.maybe_seal(&st).await; // seals + offloads + compacts

        let (sealed, n_segs) = {
            let m = st.tier.manifest.lock().unwrap();
            (m.sealed_offset, m.segments.len())
        };
        let (tail, file_base) = {
            let s = st.shared.read().unwrap();
            (s.tail, s.file_base)
        };
        assert!(sealed >= 128 * 1024, "expected a reclaimable sealed prefix, got {sealed}");
        assert_eq!(file_base, sealed, "file_base advanced to the sealed watermark");

        let live_size = std::fs::metadata(&st.file_path).unwrap().len();
        assert_eq!(live_size, tail - sealed, "live file holds only the hot tail");
        assert!(
            live_size < total as u64,
            "live file ({live_size}) must be smaller than the full stream ({total})"
        );

        // Full catch-up read is byte-identical across the compacted (cold) prefix
        // and the live tail.
        let got = read_logical(&st, 0, total as u64).await;
        assert_eq!(got, payload, "round-trip after compaction");

        // A read spanning the cold/hot boundary is exact.
        let mid = sealed - 100;
        let got2 = read_logical(&st, mid, sealed + 100).await;
        assert_eq!(got2, payload[mid as usize..(sealed + 100) as usize]);

        // Compaction never touches the manifest.
        assert!(n_segs >= 1, "manifest still lists the sealed segments");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn compaction_respects_threshold() {
        // Below `compact_bytes` the live file is left intact (file_base unmoved),
        // and reads remain exact — compaction is purely a reclaim, never required
        // for correctness.
        let dir = tmp_dir("compact-threshold");
        let mut cfg = local_tier(&dir, 64 * 1024);
        cfg.compact_bytes = 10 * 1024 * 1024; // 10 MiB — far above this stream
        let store = Arc::new(Store::new_with_tier(dir.clone(), cfg).unwrap());
        let scfg = StreamConfig {
            content_type: "application/octet-stream".into(),
            ttl_seconds: None,
            expires_at: None,
            expires_at_raw: None,
            create_closed: false,
            forked_from: None,
            fork_offset_raw: None,
            fork_sub_offset: None,
        };
        let st = match store.create("s/nothresh", scfg, None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };
        let total = 200 * 1024usize;
        let payload: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
        for chunk in payload.chunks(8 * 1024) {
            append_wire(&st, chunk).await;
        }
        store.maybe_seal(&st).await;

        let file_base = st.shared.read().unwrap().file_base;
        assert_eq!(file_base, 0, "below threshold → no compaction");
        let live_size = std::fs::metadata(&st.file_path).unwrap().len();
        assert_eq!(live_size, total as u64, "live file retains the full stream");

        let got = read_logical(&st, 0, total as u64).await;
        assert_eq!(got, payload, "reads exact without compaction");

        let _ = std::fs::remove_dir_all(&dir);
    }

    fn octet_cfg() -> StreamConfig {
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

    #[tokio::test]
    async fn recovery_after_real_compaction() {
        // A cleanly-compacted stream reopens with the persisted file_base, the
        // compacted (small) live file, the right tail, and exact full read-back.
        let dir = tmp_dir("compact-recover");
        let total = 500 * 1024usize;
        let payload: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
        let (sealed, tail) = {
            let mut cfg = local_tier(&dir, 64 * 1024);
            cfg.compact_bytes = 128 * 1024;
            let store = Arc::new(Store::new_with_tier(dir.clone(), cfg).unwrap());
            let st = match store.create("s/cr", octet_cfg(), None, 0).unwrap() {
                CreateResult::Created(s) => s,
                _ => panic!("create failed"),
            };
            for chunk in payload.chunks(8 * 1024) {
                append_wire(&st, chunk).await;
            }
            store.maybe_seal(&st).await; // compacts
            let sealed = st.tier.manifest.lock().unwrap().sealed_offset;
            let tail = st.shared.read().unwrap().tail;
            (sealed, tail)
        };

        let mut cfg = local_tier(&dir, 64 * 1024);
        cfg.compact_bytes = 128 * 1024;
        let store2 = Arc::new(Store::new_with_tier(dir.clone(), cfg).unwrap());
        let st = store2.get("s/cr").expect("stream recovered");
        let (rtail, rfb) = {
            let s = st.shared.read().unwrap();
            (s.tail, s.file_base)
        };
        assert_eq!(rtail, tail, "tail recovered");
        assert_eq!(rfb, sealed, "file_base recovered to the sealed watermark");
        let live_size = std::fs::metadata(&st.file_path).unwrap().len();
        assert_eq!(live_size, tail - sealed, "compacted live file recovered");
        let got = read_logical(&st, 0, total as u64).await;
        assert_eq!(got, payload, "post-compaction-recovery read exact");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Simulate a crash mid-compaction: persist the `pending_compaction` intent,
    /// then leave the live file either as the original full file (`simulate_renamed
    /// == false`, crash before the rename) or rewritten to just the hot tail
    /// (`true`, crash after the rename). Recovery must reconstruct the right
    /// `file_base` from `pending.tail - file_size` in both cases and read exact.
    async fn recover_with_pending_intent(tag: &str, simulate_renamed: bool) {
        let dir = tmp_dir(tag);
        let total = 300 * 1024usize;
        let payload: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
        let (sealed, tail, file_path) = {
            let mut cfg = local_tier(&dir, 64 * 1024);
            cfg.compact_bytes = 0; // no auto-compaction; we craft the crash state
            let store = Arc::new(Store::new_with_tier(dir.clone(), cfg).unwrap());
            let st = match store.create("s/pend", octet_cfg(), None, 0).unwrap() {
                CreateResult::Created(s) => s,
                _ => panic!("create failed"),
            };
            for chunk in payload.chunks(8 * 1024) {
                append_wire(&st, chunk).await;
            }
            store.maybe_seal(&st).await; // seals, no compaction
            let sealed = st.tier.manifest.lock().unwrap().sealed_offset;
            let tail = st.shared.read().unwrap().tail;
            // Persist the compaction intent as if a compaction had started.
            *st.compaction.lock().unwrap() = Some(PendingCompaction {
                new_file_base: sealed,
                tail,
            });
            let stc = st.clone();
            tokio::task::spawn_blocking(move || write_meta_sync(&stc, true))
                .await
                .unwrap()
                .unwrap();
            (sealed, tail, st.file_path.clone())
        };
        if simulate_renamed {
            // Crash after the rename: the live file already holds only [sealed,tail).
            let full = std::fs::read(&file_path).unwrap();
            std::fs::write(&file_path, &full[sealed as usize..]).unwrap();
        }

        let mut cfg = local_tier(&dir, 64 * 1024);
        cfg.compact_bytes = 0;
        let store2 = Arc::new(Store::new_with_tier(dir.clone(), cfg).unwrap());
        let st = store2.get("s/pend").expect("stream recovered");
        let rtail = st.shared.read().unwrap().tail;
        assert_eq!(rtail, tail, "tail recovered to the frozen value ({tag})");
        let got = read_logical(&st, 0, total as u64).await;
        assert_eq!(got, payload, "pending-intent recovery read exact ({tag})");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn recovery_pending_intent_before_rename() {
        recover_with_pending_intent("pend-before", false).await;
    }

    #[tokio::test]
    async fn recovery_pending_intent_after_rename() {
        recover_with_pending_intent("pend-after", true).await;
    }

    /// C3 regression: under `fast`, a crash *after* the compaction intent is
    /// persisted but *before* the rename leaves the OLD live file in place with an
    /// un-fsynced (and thus possibly short) tail, while the fsynced `compact.tmp`
    /// holds the full residual `[cut, tail)`. Recovery must prefer the durable temp
    /// file — trusting `p.tail` against the short old file skews `file_base` and
    /// over-reports the tail. Asserts no offset skew: the recovered live region
    /// maps `[cut, tail)` exactly and the full logical range reads byte-identical.
    #[tokio::test]
    async fn recovery_pending_intent_prefers_fsynced_temp_when_old_file_short() {
        let dir = tmp_dir("pend-fast-short");
        let total = 300 * 1024usize;
        let payload: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
        let (sealed, tail, file_path) = {
            let mut cfg = local_tier(&dir, 64 * 1024);
            cfg.compact_bytes = 0; // craft the crash state by hand
            let store = Arc::new(Store::new_with_tier(dir.clone(), cfg).unwrap());
            let st = match store.create("s/pend", octet_cfg(), None, 0).unwrap() {
                CreateResult::Created(s) => s,
                _ => panic!("create failed"),
            };
            for chunk in payload.chunks(8 * 1024) {
                append_wire(&st, chunk).await;
            }
            store.maybe_seal(&st).await; // seals, no compaction
            let sealed = st.tier.manifest.lock().unwrap().sealed_offset;
            let tail = st.shared.read().unwrap().tail;
            // compact step 1: write the FULL residual [sealed, tail) to compact.tmp
            // and fsync it (the temp fsync is NOT gated by fast).
            let residual = std::fs::read(&st.file_path).unwrap()[sealed as usize..].to_vec();
            let tmp = st.file_path.with_extension("compact.tmp");
            {
                use std::io::Write;
                let mut f = std::fs::File::create(&tmp).unwrap();
                f.write_all(&residual).unwrap();
                f.sync_all().unwrap();
            }
            // compact step 2: persist the intent durably.
            *st.compaction.lock().unwrap() = Some(PendingCompaction {
                new_file_base: sealed,
                tail,
            });
            let stc = st.clone();
            tokio::task::spawn_blocking(move || write_meta_sync(&stc, true))
                .await
                .unwrap()
                .unwrap();
            (sealed, tail, st.file_path.clone())
        };
        // Crash BEFORE the rename, under fast: the OLD live file is still in
        // place but lost its un-fsynced suffix — simulate by truncating it short
        // (drop the last 16 KiB of the un-synced tail). The temp holds the truth.
        {
            let full = std::fs::read(&file_path).unwrap();
            let short = full.len() - 16 * 1024;
            std::fs::write(&file_path, &full[..short]).unwrap();
        }

        let mut cfg = local_tier(&dir, 64 * 1024);
        cfg.compact_bytes = 0;
        let store2 = Arc::new(Store::new_with_tier(dir.clone(), cfg).unwrap());
        let st = store2.get("s/pend").expect("stream recovered");
        let (rtail, rfb) = {
            let s = st.shared.read().unwrap();
            (s.tail, s.file_base)
        };
        // No offset skew: file_base maps to the sealed watermark (the residual's
        // logical start), and the tail is the frozen full tail — both from the
        // durable temp, not the short old file.
        assert_eq!(rfb, sealed, "file_base recovered to sealed watermark, no skew");
        assert_eq!(rtail, tail, "tail recovered to the frozen full value");
        let live_size = std::fs::metadata(&st.file_path).unwrap().len();
        assert_eq!(live_size, tail - sealed, "live file is the full residual");
        let got = read_logical(&st, 0, total as u64).await;
        assert_eq!(got, payload, "full read exact after fast crash-before-rename");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn fork_reads_compacted_parent() {
        // A fork inherits its parent's history below the fork point. After the
        // parent is compacted (its sealed prefix dropped from the live file), the
        // fork must still read that history — resolve_range routes the parent's
        // sealed offsets to the manifest, not the (now-absent) live-file copy.
        let dir = tmp_dir("fork-compact");
        let total = 500 * 1024usize;
        let payload: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
        let mut cfg = local_tier(&dir, 64 * 1024);
        cfg.compact_bytes = 128 * 1024;
        let store = Arc::new(Store::new_with_tier(dir.clone(), cfg).unwrap());

        let parent = match store.create("s/parent", octet_cfg(), None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create parent failed"),
        };
        for chunk in payload.chunks(8 * 1024) {
            append_wire(&parent, chunk).await;
        }
        store.maybe_seal(&parent).await; // compacts the parent

        let (sealed, ptail) = {
            let m = parent.tier.manifest.lock().unwrap();
            let s = parent.shared.read().unwrap();
            (m.sealed_offset, s.tail)
        };
        assert_eq!(parent.shared.read().unwrap().file_base, sealed, "parent compacted");

        // Fork at the parent's tail: the fork inherits all of [0, ptail).
        let fork = match store
            .create("s/fork", octet_cfg(), Some(parent.clone()), ptail)
            .unwrap()
        {
            CreateResult::Created(s) => s,
            _ => panic!("create fork failed"),
        };

        // Read the parent's full history (incl. its compacted region) via the fork.
        let got = read_logical(&fork, 0, ptail).await;
        assert_eq!(got, payload, "fork reads parent's compacted history exact");

        // A sub-range entirely inside the parent's compacted (sealed) region.
        let got2 = read_logical(&fork, 100, sealed).await;
        assert_eq!(got2, payload[100..sealed as usize], "fork sub-range in cold region");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Regression: sustained concurrent appends + sealing + compaction + meta
    /// writes must not deadlock. A lock-order inversion — seal/compact held
    /// manifest.lock()→shared.read() while `write_meta_sync`'s capture held
    /// shared.read()→manifest.lock(), with appends queuing a shared writer
    /// (std RwLock is writer-preferring) — froze the server under load. This
    /// drives all three actors concurrently and must finish well under the
    /// timeout (a deadlock would hang past it). Multi-thread runtime is required
    /// to reproduce the cross-thread lock cycle.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_append_seal_compact_no_deadlock() {
        let dir = tmp_dir("no-deadlock");
        let mut cfg = local_tier(&dir, 64 * 1024);
        cfg.compact_bytes = 128 * 1024; // compact often, to exercise the swap
        let store = Arc::new(Store::new_with_tier(dir.clone(), cfg).unwrap());
        let st = match store.create("s/cc", octet_cfg(), None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };

        let outcome = tokio::time::timeout(Duration::from_secs(30), async {
            let mut handles = Vec::new();
            // Appenders: each append bumps the tail (shared writer) then drives a
            // seal/compact pass (manifest→shared).
            for _ in 0..6 {
                let s = store.clone();
                let stc = st.clone();
                handles.push(tokio::spawn(async move {
                    let body = vec![b'x'; 6 * 1024];
                    for _ in 0..120 {
                        append_wire(&stc, &body).await;
                        s.maybe_seal(&stc).await;
                    }
                }));
            }
            // Concurrent meta writer (shared→manifest), the opposite lock order.
            let stc = st.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..300 {
                    let s2 = stc.clone();
                    let _ = tokio::task::spawn_blocking(move || write_meta_sync(&s2, false)).await;
                    tokio::task::yield_now().await;
                }
            }));
            for h in handles {
                let _ = h.await;
            }
        })
        .await;

        assert!(
            outcome.is_ok(),
            "concurrent append + seal + compact + meta deadlocked (lock-order regression)"
        );

        // Sanity: the stream is intact and fully readable end to end.
        let tail = st.shared.read().unwrap().tail;
        let got = read_logical(&st, 0, tail).await;
        assert_eq!(got.len() as u64, tail, "full read-back length after concurrent load");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A BlobStore whose uploads always fail — used to leave a sealed segment in
    /// the `Local` (not-yet-offloaded) state.
    struct FailingBlobStore;
    impl crate::blobstore::BlobStore for FailingBlobStore {
        fn put<'a>(
            &'a self,
            _key: &'a str,
            _body: bytes::Bytes,
        ) -> crate::blobstore::BoxFuture<'a, std::io::Result<()>> {
            Box::pin(async { Err(std::io::Error::other("offload disabled (test)")) })
        }
        fn get_range<'a>(
            &'a self,
            _key: &'a str,
            _start: u64,
            _len: u64,
        ) -> crate::blobstore::BoxFuture<'a, std::io::Result<bytes::Bytes>> {
            Box::pin(async { Err(std::io::Error::other("no remote (test)")) })
        }
        fn head<'a>(
            &'a self,
            _key: &'a str,
        ) -> crate::blobstore::BoxFuture<'a, std::io::Result<Option<u64>>> {
            Box::pin(async { Ok(None) })
        }
        fn delete<'a>(&'a self, _key: &'a str) -> crate::blobstore::BoxFuture<'a, std::io::Result<()>> {
            Box::pin(async { Ok(()) })
        }
    }

    #[tokio::test]
    async fn sealed_local_offload_failure_is_readable() {
        // Offload-failure resilience: a sealed segment whose upload fails stays
        // `Local` in the manifest (its bytes in the staged chunk file) and must
        // remain fully readable from local fds — never erroring or reaching for a
        // remote object that was never written. resolve_range routes it to the
        // chunk file, so the range is all-local and reads back byte-identical.
        let dir = tmp_dir("sealed-local");
        let mut store = Store::new_with_tier(dir.clone(), local_tier(&dir, 64 * 1024)).unwrap();
        store.blobstore = Some(Arc::new(FailingBlobStore)); // offload fails → stays Local
        let store = Arc::new(store);
        let cfg = StreamConfig {
            content_type: "application/octet-stream".into(),
            ttl_seconds: None,
            expires_at: None,
            expires_at_raw: None,
            create_closed: false,
            forked_from: None,
            fork_offset_raw: None,
            fork_sub_offset: None,
        };
        let st = match store.create("s/sl", cfg, None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };
        let total = 200 * 1024usize;
        let payload: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
        for chunk in payload.chunks(8 * 1024) {
            append_wire(&st, chunk).await;
        }
        // Seals the first segment to a chunk file; offload fails → it stays Local.
        store.maybe_seal(&st).await;

        let (sealed, n_local, n_remote) = {
            let m = st.tier.manifest.lock().unwrap();
            (
                m.sealed_offset,
                m.segments.iter().filter(|s| !s.remote).count(),
                m.segments.iter().filter(|s| s.remote).count(),
            )
        };
        assert!(sealed > 0, "expected a sealed prefix");
        assert!(n_local > 0, "offload failed → segment should remain Local");
        assert_eq!(n_remote, 0, "no segment should be remote (offload failed)");

        // A failed-offload sealed segment is served entirely from local fds (its
        // chunk file): the range is all-local with no remote slice to fetch.
        assert!(
            all_local(&st, st.base_offset, sealed),
            "a sealed Local segment is served from its chunk file (all-local)"
        );
        // And it reads back byte-identical (from the chunk file, not a missing
        // remote object).
        let got = read_logical(&st, 0, total as u64).await;
        assert_eq!(got, payload, "sealed-Local read must return the staged bytes");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn json_seal_lands_on_value_boundary() {
        let dir = tmp_dir("json");
        // Small segment so a handful of values trigger a seal.
        let store = Arc::new(
            Store::new_with_tier(dir.clone(), local_tier(&dir, 1024)).unwrap(),
        );
        let cfg = StreamConfig {
            content_type: "application/json".into(),
            ttl_seconds: None,
            expires_at: None,
            expires_at_raw: None,
            create_closed: false,
            forked_from: None,
            fork_offset_raw: None,
            fork_sub_offset: None,
        };
        let st = match store.create("s/json", cfg, None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!(),
        };
        assert!(st.is_json);

        // Each value contains commas and brackets INSIDE strings, which must not
        // be treated as boundaries.
        let mut wire = Vec::new();
        let mut values: Vec<String> = Vec::new();
        for i in 0..200 {
            let v = format!(r#"{{"i":{i},"s":"a,b[c]{{d}}","arr":[1,2,3]}}"#);
            wire.extend_from_slice(v.as_bytes());
            wire.push(b',');
            values.push(v);
        }
        for chunk in wire.chunks(128) {
            append_wire(&st, chunk).await;
        }
        store.maybe_seal(&st).await;

        let sealed = st.tier.manifest.lock().unwrap().sealed_offset;
        assert!(sealed > 0, "expected JSON stream to seal");
        // The sealed prefix must end exactly on a value boundary (a `,` right
        // after a complete value) — i.e. wire[sealed-1] == b',' and the prefix
        // parses as a whole number of values.
        assert_eq!(wire[sealed as usize - 1], b',');

        // Reconstruct the sealed prefix and confirm it is exactly the first K
        // complete values + trailing comma.
        let got = read_logical(&st, 0, sealed).await;
        assert_eq!(got, &wire[..sealed as usize]);
        // Wrap as [ … ] (drop trailing comma) and parse as JSON to prove it is a
        // valid, complete array of values.
        let inner = &got[..got.len() - 1];
        let json = format!("[{}]", String::from_utf8_lossy(inner));
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(!parsed.as_array().unwrap().is_empty());

        // Full read is byte-identical.
        let full = read_logical(&st, 0, wire.len() as u64).await;
        assert_eq!(full, wire);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_reads_during_seal_are_consistent() {
        let dir = tmp_dir("concurrent");
        let store = Arc::new(
            Store::new_with_tier(dir.clone(), local_tier(&dir, 32 * 1024)).unwrap(),
        );
        let cfg = StreamConfig {
            content_type: "application/octet-stream".into(),
            ttl_seconds: None,
            expires_at: None,
            expires_at_raw: None,
            create_closed: false,
            forked_from: None,
            fork_offset_raw: None,
            fork_sub_offset: None,
        };
        let st = match store.create("s/conc", cfg, None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!(),
        };
        let total = 256 * 1024usize;
        let payload: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
        for chunk in payload.chunks(8 * 1024) {
            append_wire(&st, chunk).await;
        }

        // Launch readers concurrently with the sealing pass; none must see torn
        // bytes regardless of unlink/hole-punch timing.
        let st2 = st.clone();
        let pl = payload.clone();
        let reader = tokio::spawn(async move {
            for _ in 0..50 {
                let got = read_logical(&st2, 0, total as u64).await;
                assert_eq!(got, pl, "torn read during seal");
                tokio::task::yield_now().await;
            }
        });
        store.maybe_seal(&st).await;
        reader.await.unwrap();

        // After seal, read again — fully served from cold + hot.
        let got = read_logical(&st, 0, total as u64).await;
        assert_eq!(got, payload);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn manifest_survives_recovery() {
        let dir = tmp_dir("recovery");
        {
            let store = Arc::new(
                Store::new_with_tier(dir.clone(), local_tier(&dir, 64 * 1024)).unwrap(),
            );
            let cfg = StreamConfig {
                content_type: "application/octet-stream".into(),
                ttl_seconds: None,
                expires_at: None,
                expires_at_raw: None,
                create_closed: false,
                forked_from: None,
                fork_offset_raw: None,
                fork_sub_offset: None,
            };
            let st = match store.create("s/rec", cfg, None, 0).unwrap() {
                CreateResult::Created(s) => s,
                _ => panic!(),
            };
            let payload: Vec<u8> = (0..200 * 1024).map(|i| (i % 251) as u8).collect();
            for chunk in payload.chunks(8 * 1024) {
                append_wire(&st, chunk).await;
            }
            store.maybe_seal(&st).await;
        }
        // Re-open the store; the manifest must rehydrate from the sidecar and
        // cold reads must still work.
        let store2 = Arc::new(
            Store::new_with_tier(dir.clone(), local_tier(&dir, 64 * 1024)).unwrap(),
        );
        let st = store2.get("s/rec").expect("stream recovered");
        let sealed = st.tier.manifest.lock().unwrap().sealed_offset;
        assert!(sealed >= 64 * 1024, "manifest not recovered");
        let payload: Vec<u8> = (0..200 * 1024).map(|i| (i % 251) as u8).collect();
        let got = read_logical(&st, 0, payload.len() as u64).await;
        assert_eq!(got, payload, "post-recovery cold read mismatch");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Regression for the WAL read-before-durable bug: a reader (via `tail()`)
    /// must observe bytes only once they are DURABLE. During the WAL-fsync window
    /// the writer tail `s.tail` runs ahead of the reader-observable `durable_tail`
    /// (set in `write_wire` vs published in `publish_durable_tail` after the WAL
    /// `fdatasync`). `tail()` must report the durable frontier so a live/catch-up
    /// reader never observes (and acts on) bytes a crash could roll back
    /// (PROTOCOL.md §4.1).
    #[tokio::test]
    async fn reader_tail_tracks_durable_not_writer_tail() {
        let dir = tmp_dir("durable-tail");
        let store =
            Arc::new(Store::new_with_tier(dir.clone(), local_tier(&dir, 64 * 1024)).unwrap());
        let st = match store.create("s/dur", octet_cfg(), None, 0).unwrap() {
            CreateResult::Created(st) => st,
            _ => panic!("expected created"),
        };

        // Fresh stream: writer and durable tails agree at 0.
        assert_eq!(st.tail().bytes, 0);

        // Simulate `write_wire`: bytes hit the page cache and the WRITER tail
        // advances, but durability has NOT been published (WAL fsync pending).
        let wire = b"hello world";
        {
            use std::io::Write;
            let mut ap = st.appender.lock().await;
            (&*ap.file).write_all(wire).unwrap();
            ap.written += wire.len() as u64;
            let mut s = st.shared.write().unwrap();
            s.tail = s.file_base + ap.written;
            // `durable_tail` intentionally NOT advanced — fsync still pending.
        }

        // A reader must NOT observe the not-yet-durable bytes.
        assert_eq!(
            st.tail().bytes,
            0,
            "reader observed bytes before they were durable"
        );

        // Simulate `publish_durable_tail` after the WAL fsync succeeds.
        {
            let mut s = st.shared.write().unwrap();
            s.durable_tail = s.tail;
        }

        // Durable now → reader-visible.
        assert_eq!(st.tail().bytes, wire.len() as u64);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Regression for the hard-delete GC race: after a hard delete, every
    /// offloaded remote object (and any staged local chunk) backing the stream
    /// must be reclaimed — no orphans. Guards `gc_remote_segments` and its
    /// `deleted`-flag coordination with seal/offload.
    #[tokio::test]
    async fn hard_delete_reclaims_offloaded_segments() {
        fn count_files(root: &std::path::Path) -> usize {
            let mut n = 0;
            if let Ok(rd) = std::fs::read_dir(root) {
                for e in rd.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        n += count_files(&p);
                    } else {
                        n += 1;
                    }
                }
            }
            n
        }

        let dir = tmp_dir("gc-reclaim");
        let store =
            Arc::new(Store::new_with_tier(dir.clone(), local_tier(&dir, 64 * 1024)).unwrap());
        let st = match store.create("s/gc", octet_cfg(), None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };

        // Append > 2 segments and offload them to the (local) remote tier.
        let total = 200 * 1024usize;
        let payload: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
        for chunk in payload.chunks(8 * 1024) {
            append_wire(&st, chunk).await;
        }
        store.maybe_seal(&st).await;

        let cold = dir.join("cold");
        assert!(
            count_files(&cold) >= 1,
            "expected offloaded remote objects before delete"
        );

        // Hard delete (ref_count == 0 → hard delete → gc_remote_segments).
        store.delete_or_soft_delete(&st);

        // The GC runs as a detached task — wait for it to reclaim everything.
        let mut waited = 0;
        while count_files(&cold) > 0 && waited < 300 {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            waited += 1;
        }
        assert_eq!(
            count_files(&cold),
            0,
            "orphaned remote objects after hard delete"
        );
        assert_eq!(
            count_files(&dir.join("segments")),
            0,
            "leaked local chunk files after hard delete"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Once a stream is hard-deleted (`deleted` set), a seal pass must bail
    /// without staging new chunk files or manifest entries — otherwise it would
    /// race the GC reclaim and leak. (On the pre-fix code, with no `deleted`
    /// flag, `maybe_seal` would proceed and stage segments here.)
    #[tokio::test]
    async fn seal_bails_after_hard_delete_flag() {
        let dir = tmp_dir("gc-seal-bail");
        let store =
            Arc::new(Store::new_with_tier(dir.clone(), local_tier(&dir, 64 * 1024)).unwrap());
        let st = match store.create("s/gcseal", octet_cfg(), None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };
        // Enough unsealed data for several seals.
        let payload: Vec<u8> = (0..200 * 1024).map(|i| (i % 251) as u8).collect();
        for chunk in payload.chunks(8 * 1024) {
            append_wire(&st, chunk).await;
        }

        // Hard delete arrived before the seal pass runs.
        st.tier.manifest.lock().unwrap().deleted = true;

        // The seal pass must be a no-op now.
        store.maybe_seal(&st).await;

        {
            let m = st.tier.manifest.lock().unwrap();
            assert_eq!(m.segments.len(), 0, "seal staged segments despite deleted");
            assert_eq!(m.sealed_offset, 0, "seal advanced watermark despite deleted");
        }
        let seg_files = std::fs::read_dir(dir.join("segments"))
            .map(|rd| rd.count())
            .unwrap_or(0);
        assert_eq!(seg_files, 0, "seal staged chunk files despite deleted");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
