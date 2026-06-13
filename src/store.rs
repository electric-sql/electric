// Stream store: per-stream state, contiguous wire-byte data files, coalesced fsync.
//
// On-disk layout (per research notes/rust-server-research.md): the data file
// contains exactly the wire bytes of the stream payload, contiguously.
//   - binary streams: raw payload bytes as POSTed
//   - JSON streams:   each message followed by a `,` separator
// A catch-up read is then a literal byte range of the file (JSON responses
// wrap the range as `[` + range-minus-trailing-comma + `]`).

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::os::fd::AsRawFd;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
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

#[derive(Clone, Debug)]
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
}

pub struct Shared {
    pub tail: u64,
    pub closed: bool,
    /// Producer that closed the stream (producer_id, epoch, seq), for idempotent re-close.
    pub closed_by: Option<(String, u64, u64)>,
    pub producers: HashMap<String, ProducerState>,
    pub last_seq_header: Option<String>,
    pub last_access: SystemTime,
}

pub struct Appender {
    pub file: Arc<File>,
    pub written: u64,
}

struct SyncInner {
    synced: u64,
    in_flight: bool,
}

/// Coalesces fsyncs: concurrent appenders share one in-flight barrier-fsync,
/// mirroring the Node server's FileHandlePool.fsyncFile leader/follower scheme.
pub struct SyncCoalescer {
    inner: StdMutex<SyncInner>,
    tx: watch::Sender<u64>,
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
        }
    }

    /// Wait until at least `target` bytes are durable, issuing a sync if needed.
    pub async fn sync_to(&self, file: Arc<File>, stream: &StreamState, target: u64) {
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
                // Sync covers everything written at the time the fsync starts.
                let covers = stream.shared.read().unwrap().tail;
                let f = file.clone();
                let _ = tokio::task::spawn_blocking(move || barrier_fsync(&f)).await;
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
    pub appender: AsyncMutex<Appender>,
    pub shared: RwLock<Shared>,
    pub tail_tx: watch::Sender<Tail>,
    pub sync: SyncCoalescer,
}

impl StreamState {
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
    next_id: AtomicU64,
}

pub enum CreateResult {
    Created(Arc<StreamState>),
    Exists(Arc<StreamState>),
    Conflict,
}

impl Store {
    pub fn new(data_dir: PathBuf) -> std::io::Result<Self> {
        std::fs::create_dir_all(data_dir.join("streams"))?;
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64;
        Ok(Store {
            streams: DashMap::new(),
            data_dir,
            next_id: AtomicU64::new(seed & MAX_SAFE_INT),
        })
    }

    pub fn get(&self, path: &str) -> Option<Arc<StreamState>> {
        let st = self.streams.get(path)?.clone();
        if st.is_expired() {
            drop(st);
            self.remove(path);
            return None;
        }
        Some(st)
    }

    pub fn remove(&self, path: &str) -> bool {
        if let Some((_, st)) = self.streams.remove(path) {
            let fp = st.file_path.clone();
            tokio::task::spawn_blocking(move || {
                let _ = std::fs::remove_file(fp);
            });
            true
        } else {
            false
        }
    }

    pub fn create(&self, path: &str, config: StreamConfig) -> std::io::Result<CreateResult> {
        use dashmap::mapref::entry::Entry;
        // Fast path: existing stream → config comparison.
        if let Some(existing) = self.get(path) {
            return Ok(if config_matches(&existing, &config) {
                CreateResult::Exists(existing)
            } else {
                CreateResult::Conflict
            });
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let fname = format!("{}~{}", encode_path(path), id);
        let file_path = self.data_dir.join("streams").join(fname);
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .append(true)
            .open(&file_path)?;
        let is_json = is_json_content_type(&config.content_type);
        let closed = config.create_closed;
        let (tail_tx, _) = watch::channel(Tail {
            bytes: 0,
            closed,
        });
        let state = Arc::new(StreamState {
            id,
            path: path.to_string(),
            is_json,
            file_path,
            appender: AsyncMutex::new(Appender {
                file: Arc::new(file),
                written: 0,
            }),
            shared: RwLock::new(Shared {
                tail: 0,
                closed,
                closed_by: None,
                producers: HashMap::new(),
                last_seq_header: None,
                last_access: SystemTime::now(),
            }),
            tail_tx,
            sync: SyncCoalescer::new(),
            config,
        });
        match self.streams.entry(path.to_string()) {
            Entry::Occupied(e) => {
                // Lost a race; compare against the winner.
                let existing = e.get().clone();
                let fp = state.file_path.clone();
                let _ = std::fs::remove_file(fp);
                Ok(if config_matches(&existing, &state.config) {
                    CreateResult::Exists(existing)
                } else {
                    CreateResult::Conflict
                })
            }
            Entry::Vacant(v) => {
                v.insert(state.clone());
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
