// Stream store: per-stream state, contiguous wire-byte data files, coalesced fsync.
//
// On-disk layout: the data file contains exactly the wire bytes of the stream
// payload, contiguously.
//   - binary streams: raw payload bytes as POSTed
//   - JSON streams:   each message followed by a `,` separator
// A catch-up read is then a literal byte range of the file (JSON responses
// wrap the range as `[` + range-minus-trailing-comma + `]`).

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::os::fd::AsRawFd;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
#[cfg(feature = "telemetry")]
use std::sync::atomic::AtomicUsize;
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
    /// Logical tail offset (base_offset + bytes written to this stream's own file).
    pub tail: u64,
    pub closed: bool,
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

struct SyncInner {
    synced: u64,
    in_flight: bool,
}

/// Decrements the pending-appender counter on drop, covering every exit path of
/// `sync_to` (including the early `synced >= target` return). Telemetry-only:
/// the counter exists solely to feed the group-commit batch-size metric, so it
/// is compiled out (no atomic on the append hot path) in a default build.
#[cfg(feature = "telemetry")]
struct PendingGuard<'a>(&'a AtomicUsize);

#[cfg(feature = "telemetry")]
impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

/// Coalesces fsyncs: concurrent appenders share one in-flight barrier-fsync,
/// mirroring the Node server's FileHandlePool.fsyncFile leader/follower scheme.
pub struct SyncCoalescer {
    inner: StdMutex<SyncInner>,
    tx: watch::Sender<u64>,
    /// Appenders currently inside `sync_to` (incremented on entry, decremented
    /// on return). The leader snapshots this when it starts a barrier-fsync to
    /// record how many appends coalesced into the one fsync — the group-commit
    /// health signal (`ds.append.fsync.batch_size`). Telemetry-only: gated out of
    /// default builds so the contended atomic never touches the append hot path.
    #[cfg(feature = "telemetry")]
    pending: AtomicUsize,
}

impl SyncCoalescer {
    fn new() -> Self {
        let (tx, _rx) = watch::channel(0u64);
        SyncCoalescer {
            inner: StdMutex::new(SyncInner {
                synced: 0,
                in_flight: false,
            }),
            tx,
            #[cfg(feature = "telemetry")]
            pending: AtomicUsize::new(0),
        }
    }

    /// Wait until at least `target` bytes are durable, issuing a sync if needed.
    pub async fn sync_to(&self, file: Arc<File>, stream: &StreamState, target: u64) {
        // Count this caller as a pending appender for the whole call, so the
        // leader's batch-size snapshot reflects everyone waiting on a fsync.
        // Telemetry-only — no atomic on the append path in a default build.
        #[cfg(feature = "telemetry")]
        self.pending.fetch_add(1, Ordering::AcqRel);
        #[cfg(feature = "telemetry")]
        let _guard = PendingGuard(&self.pending);
        loop {
            let lead = {
                let mut s = self.inner.lock().unwrap();
                if s.synced >= target {
                    return;
                }
                if s.in_flight {
                    false
                } else {
                    s.in_flight = true;
                    true
                }
            };
            if lead {
                // Snapshot the coalesced batch size at the moment we commit to a
                // fsync: every appender currently in `sync_to` (including this
                // leader) folds into this one barrier-fsync. (Telemetry-only.)
                #[cfg(feature = "telemetry")]
                let batch = self.pending.load(Ordering::Acquire) as u64;
                #[cfg(not(feature = "telemetry"))]
                let batch = 0u64;
                // Sync covers everything written at the time the fsync starts
                // (file-local bytes: logical tail minus the fork base).
                let covers = stream.shared.read().unwrap().tail - stream.base_offset;
                let f = file.clone();
                let t = crate::telemetry::Timer::start();
                let _ = tokio::task::spawn_blocking(move || barrier_fsync(&f)).await;
                crate::telemetry::record_fsync(t.elapsed_secs(), batch);
                {
                    let mut s = self.inner.lock().unwrap();
                    s.synced = s.synced.max(covers);
                    s.in_flight = false;
                    self.tx.send_replace(s.synced);
                }
            } else {
                let mut rx = self.tx.subscribe();
                // Re-check state after subscribing to avoid missed wakeups.
                {
                    let s = self.inner.lock().unwrap();
                    if s.synced >= target {
                        return;
                    }
                }
                let _ = rx.changed().await;
            }
        }
    }
}

/// On macOS Node (libuv) implements fdatasync as fcntl(F_BARRIERFSYNC); match it
/// so durability cost is comparable. On Linux use fdatasync.
fn barrier_fsync(file: &File) {
    let fd = file.as_raw_fd();
    #[cfg(target_os = "macos")]
    unsafe {
        if libc::fcntl(fd, libc::F_BARRIERFSYNC) != 0 && libc::fcntl(fd, libc::F_FULLFSYNC) != 0 {
            libc::fsync(fd);
        }
    }
    #[cfg(not(target_os = "macos"))]
    unsafe {
        libc::fdatasync(fd);
    }
}

pub struct StreamState {
    pub id: u64,
    pub path: String,
    pub config: StreamConfig,
    pub is_json: bool,
    pub file_path: PathBuf,
    /// Shared handle to the data file for lock-free positioned reads.
    pub file: Arc<File>,
    /// Logical offset where this stream's own file starts (fork point; 0 for roots).
    pub base_offset: u64,
    /// Fork source: ranges below base_offset are read through this chain.
    pub parent: Option<Arc<StreamState>>,
    pub appender: AsyncMutex<Appender>,
    pub shared: RwLock<Shared>,
    pub tail_tx: watch::Sender<Tail>,
    pub sync: SyncCoalescer,
    /// True while a debounced meta flush is pending.
    pub meta_dirty: AtomicBool,
    /// Most recently appended wire chunk, kept resident so caught-up live
    /// readers (SSE / long-poll) and immediate catch-up reads are served from
    /// memory — one read+encode shared across all subscribers — instead of a
    /// per-subscriber file read. `(start, bytes)` covers `[start, start+len)`.
    /// Only populated for chunks up to `TAIL_CHUNK_MAX` (large appends fall back
    /// to file reads / sendfile). See set_last_chunk / tail_chunk_slice.
    pub last_chunk: std::sync::Mutex<Option<(u64, bytes::Bytes)>>,
}

/// Upper bound on the resident tail chunk (bytes). Larger appends are served
/// from the file (streamed / sendfile) rather than held in memory — this keeps
/// the cache to the small live-tail appends it is meant to de-duplicate and
/// avoids large in-memory copies on engines that must own the write buffer.
pub const TAIL_CHUNK_MAX: usize = 256 * 1024;

impl StreamState {
    /// Record the just-appended wire chunk as the resident tail. `start` is the
    /// logical offset where `bytes` begins. Chunks larger than `TAIL_CHUNK_MAX`
    /// are not cached (the entry is cleared so a stale chunk is never served).
    pub fn set_last_chunk(&self, start: u64, bytes: bytes::Bytes) {
        let mut g = self.last_chunk.lock().unwrap();
        *g = if bytes.len() <= TAIL_CHUNK_MAX {
            Some((start, bytes))
        } else {
            None
        };
    }

    /// Return the resident bytes for `[want_start, want_end)` iff the cached
    /// tail chunk fully covers that range; otherwise None (caller reads the
    /// file). Cheap: `Bytes::slice` is a refcount bump, no copy.
    pub fn tail_chunk_slice(&self, want_start: u64, want_end: u64) -> Option<bytes::Bytes> {
        if want_end <= want_start {
            return None;
        }
        let g = self.last_chunk.lock().unwrap();
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
            bytes: s.tail,
            closed: s.closed,
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
    pub subs: std::sync::OnceLock<Arc<crate::subs::SubsManager>>,
    next_id: AtomicU64,
}

pub enum CreateResult {
    Created(Arc<StreamState>),
    Exists(Arc<StreamState>),
    Conflict,
}

impl Store {
    pub fn new(data_dir: PathBuf) -> std::io::Result<Self> {
        let streams_dir = data_dir.join("streams");
        std::fs::create_dir_all(&streams_dir)?;
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64;
        let store = Store {
            streams: DashMap::new(),
            data_dir,
            subs: std::sync::OnceLock::new(),
            next_id: AtomicU64::new(seed & MAX_SAFE_INT),
        };
        store.recover(&streams_dir)?;
        Ok(store)
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
        for path in paths {
            self.recover_one(&path, &metas);
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
    ) -> Option<Arc<StreamState>> {
        if let Some(existing) = self.streams.get(path) {
            return Some(existing.clone());
        }
        let (meta, data_path) = metas.get(path)?;
        // Fork parents must be linked first (chains are acyclic; a parent always
        // outlives its forks, so a missing parent means corruption — skip).
        let parent = match &meta.forked_from {
            Some(src) => match self.recover_one(src, metas) {
                Some(p) => Some(p),
                // Nothing inherited → the fork stands alone; otherwise the
                // chain is broken (corruption) and the stream is skipped.
                None if meta.base_offset == 0 => None,
                None => return None,
            },
            None => None,
        };
        let file = Arc::new(
            OpenOptions::new()
                .read(true)
                .append(true)
                .open(data_path)
                .ok()?,
        );
        let written = file.metadata().ok()?.len();
        let tail = meta.base_offset + written;
        let (tail_tx, _) = watch::channel(Tail {
            bytes: tail,
            closed: meta.closed,
        });
        let state = Arc::new(StreamState {
            id: meta.id,
            path: path.to_string(),
            is_json: is_json_content_type(&meta.content_type),
            file_path: data_path.clone(),
            file: file.clone(),
            base_offset: meta.base_offset,
            parent,
            appender: AsyncMutex::new(Appender { file, written }),
            shared: RwLock::new(Shared {
                tail,
                closed: meta.closed,
                closed_by: meta.closed_by.clone(),
                producers: meta.producers.clone(),
                last_seq_header: meta.last_seq_header.clone(),
                last_access: UNIX_EPOCH + Duration::from_secs(meta.last_access_unix),
                ref_count: meta.ref_count,
                soft_deleted: meta.soft_deleted,
            }),
            tail_tx,
            sync: SyncCoalescer::new(),
            meta_dirty: AtomicBool::new(false),
            last_chunk: std::sync::Mutex::new(None),
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
            file: file.clone(),
            base_offset,
            parent: parent.clone(),
            appender: AsyncMutex::new(Appender { file, written: 0 }),
            shared: RwLock::new(Shared {
                tail: base_offset,
                closed,
                closed_by: None,
                producers: HashMap::new(),
                last_seq_header: None,
                last_access: SystemTime::now(),
                ref_count: 0,
                soft_deleted: false,
            }),
            tail_tx,
            sync: SyncCoalescer::new(),
            meta_dirty: AtomicBool::new(false),
            last_chunk: std::sync::Mutex::new(None),
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

/// Read all `segments` plus framing (`prefix`/`suffix`) into one contiguous
/// buffer. Returns empty bytes if any positioned read fails (e.g. the file was
/// removed mid-read). Shared by the buffered read paths (hyper engine, SSE
/// batches, small inline reads).
pub fn materialize_segments(segments: &[Segment], prefix: &[u8], suffix: &[u8]) -> bytes::Bytes {
    use bytes::BytesMut;
    use std::os::unix::fs::FileExt;
    let data_len: usize = segments.iter().map(|s| s.len as usize).sum();
    let total = prefix.len() + data_len + suffix.len();
    let mut buf = BytesMut::zeroed(total);
    buf[..prefix.len()].copy_from_slice(prefix);
    let mut at = prefix.len();
    for seg in segments {
        let n = seg.len as usize;
        if seg.file.read_exact_at(&mut buf[at..at + n], seg.file_start).is_err() {
            return bytes::Bytes::new();
        }
        at += n;
    }
    buf[at..].copy_from_slice(suffix);
    buf.freeze()
}

/// Resolve a logical byte range to physical file segments, walking the fork
/// parent chain for ranges below `base_offset`. Source data past the fork
/// point is never included (capped at base_offset).
pub fn collect_segments(st: &Arc<StreamState>, start: u64, end: u64, out: &mut Vec<Segment>) {
    if end <= start {
        return;
    }
    if start < st.base_offset {
        if let Some(p) = &st.parent {
            collect_segments(p, start, end.min(st.base_offset), out);
        }
    }
    if end > st.base_offset {
        let s = start.max(st.base_offset) - st.base_offset;
        let e = end - st.base_offset;
        out.push(Segment {
            file: st.file.clone(),
            file_start: s,
            len: e - s,
        });
    }
}

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
    Ok(())
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
        Some(c) if c >= interval => c + 1,
        _ => interval,
    }
}
