// HTTP protocol handlers for Durable Streams — engine-agnostic (see api.rs).

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use bytes::{BufMut, Bytes, BytesMut};
use serde_json::value::RawValue;
use tokio::sync::mpsc;
use tracing::Instrument;

use crate::api::{Body, Method, Req, Resp};
use crate::store::*;

// ---------- header names ----------
const H_NEXT_OFFSET: &str = "stream-next-offset";
const H_UP_TO_DATE: &str = "stream-up-to-date";
const H_CLOSED: &str = "stream-closed";
const H_CURSOR: &str = "stream-cursor";
const H_TTL: &str = "stream-ttl";
const H_EXPIRES_AT: &str = "stream-expires-at";
const H_SEQ: &str = "stream-seq";
const H_PRODUCER_ID: &str = "producer-id";
const H_PRODUCER_EPOCH: &str = "producer-epoch";
const H_PRODUCER_SEQ: &str = "producer-seq";
const H_PRODUCER_EXPECTED: &str = "producer-expected-seq";
const H_PRODUCER_RECEIVED: &str = "producer-received-seq";
const H_SSE_ENCODING: &str = "stream-sse-data-encoding";
const H_FORKED_FROM: &str = "stream-forked-from";
const H_FORK_OFFSET: &str = "stream-fork-offset";
const H_FORK_SUB_OFFSET: &str = "stream-fork-sub-offset";

static LONG_POLL_TIMEOUT_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(30_000);

pub fn set_long_poll_timeout(ms: u64) {
    LONG_POLL_TIMEOUT_MS.store(ms, std::sync::atomic::Ordering::Relaxed);
}

// ---------- durability mode ----------

/// Server durability mode, chosen at startup via `--durability`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum DurabilityMode {
    /// Durable: ack after the record is durable in the sharded WAL (group-commit fsync).
    #[default]
    Wal,
    /// No WAL, no fsync: ack on the page-cache write. Durability comes from replication
    /// (future). Linux-only (binary appends use zero-copy socket→file).
    Memory,
}

static DURABILITY_MODE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

/// Parse the `--durability` value. `wal` | `memory`; `None` → usage error.
pub fn parse_durability(s: &str) -> Option<DurabilityMode> {
    match s {
        "wal" => Some(DurabilityMode::Wal),
        "memory" => Some(DurabilityMode::Memory),
        _ => None,
    }
}

pub fn set_durability(mode: DurabilityMode) {
    DURABILITY_MODE.store(mode as u8, std::sync::atomic::Ordering::Relaxed);
}

pub fn durability() -> DurabilityMode {
    match DURABILITY_MODE.load(std::sync::atomic::Ordering::Relaxed) {
        1 => DurabilityMode::Memory,
        _ => DurabilityMode::Wal,
    }
}

/// Test-only: serialization lock + RAII guard so parallel tests never race on
/// `DURABILITY_MODE`. Every test that drives the real append path acquires this
/// guard for its entire body; two such tests are then mutually exclusive.
#[cfg(test)]
pub(crate) mod test_support {
    use super::{set_durability, DurabilityMode};
    use std::sync::{Mutex, MutexGuard};

    static MODE_LOCK: Mutex<()> = Mutex::new(());

    pub(crate) struct DurabilityGuard(#[allow(dead_code)] MutexGuard<'static, ()>);

    impl DurabilityGuard {
        pub(crate) fn wal() -> Self {
            let g = MODE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            set_durability(DurabilityMode::Wal);
            DurabilityGuard(g)
        }

        pub(crate) fn memory() -> Self {
            let g = MODE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            set_durability(DurabilityMode::Memory);
            DurabilityGuard(g)
        }
    }

    impl Drop for DurabilityGuard {
        fn drop(&mut self) {
            set_durability(DurabilityMode::Wal);
        }
    }
}

fn long_poll_timeout_dur() -> Duration {
    Duration::from_millis(LONG_POLL_TIMEOUT_MS.load(std::sync::atomic::Ordering::Relaxed))
}

const SSE_MAX_DURATION: Duration = Duration::from_secs(60);
const CACHEABLE: &str = "public, max-age=60, stale-while-revalidate=300";

// ---------- response building ----------

fn full(b: impl Into<Bytes>) -> Body {
    Body::Full(b.into())
}

fn empty() -> Body {
    Body::Empty
}

fn text_response(status: u16, msg: &str) -> Resp {
    let mut r = Resp::new(status);
    r.headers.push(("content-type", "text/plain".to_string()));
    r.body = full(msg.to_string());
    r
}

struct ResponseBuilder {
    resp: Resp,
}

impl ResponseBuilder {
    fn new(status: u16) -> Self {
        ResponseBuilder {
            resp: Resp::new(status),
        }
    }
    fn h(mut self, k: &'static str, v: String) -> Self {
        self.resp.headers.push((k, v));
        self
    }
    fn hs(mut self, k: &'static str, v: &'static str) -> Self {
        self.resp.headers.push((k, v.to_string()));
        self
    }
    fn body(mut self, b: Body) -> Resp {
        self.resp.body = b;
        self.resp
    }
}

// ---------- query parsing ----------

struct Query {
    offset: Option<String>,
    live: Option<String>,
    cursor: Option<u64>,
}

fn parse_query(q: Option<&str>) -> Query {
    let mut out = Query {
        offset: None,
        live: None,
        cursor: None,
    };
    if let Some(q) = q {
        for pair in q.split('&') {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            let v = percent_encoding::percent_decode_str(v)
                .decode_utf8_lossy()
                .to_string();
            match k {
                "offset" => out.offset = Some(v),
                "live" => out.live = Some(v),
                "cursor" => out.cursor = v.parse().ok(),
                _ => {}
            }
        }
    }
    out
}

fn header_str<'a>(req: &'a Req, name: &str) -> Option<&'a str> {
    req.header(name)
}

fn header_is_true(req: &Req, name: &str) -> bool {
    req.header_is_true(name)
}

// ---------- main dispatch ----------

/// Map an HTTP method to a bounded, static label for metrics/spans.
fn method_label(m: Method) -> &'static str {
    match m {
        Method::Get => "GET",
        Method::Put => "PUT",
        Method::Post => "POST",
        Method::Delete => "DELETE",
        Method::Head => "HEAD",
        Method::Options => "OPTIONS",
        Method::Other => "other",
    }
}

/// Bucket a status code into a bounded class label (`2xx`, `4xx`, …).
fn status_class(status: u16) -> &'static str {
    match status / 100 {
        2 => "2xx",
        3 => "3xx",
        4 => "4xx",
        5 => "5xx",
        1 => "1xx",
        _ => "other",
    }
}

/// Coarse route bucket — deliberately NOT the stream id/path (unbounded
/// cardinality). Only the structural shape of the request is recorded.
fn route_label(path: &str) -> &'static str {
    if path == "/health" {
        "/health"
    } else {
        "/<stream>"
    }
}

pub async fn handle(store: Arc<Store>, req: Req) -> Resp {
    let method = method_label(req.method);
    let route = route_label(&req.path);
    // `ds.request` span. Skip everything heavy/unbounded: the store handle, the
    // full Req (bodies/Bytes), and the raw path — only bounded attributes are
    // recorded. The span is always compiled; it is exported only when the
    // `telemetry` feature is on and a subscriber is installed.
    let span = tracing::info_span!("ds.request", http.method = method, route = route, status_class = tracing::field::Empty);
    let resp = dispatch(store, req).instrument(span.clone()).await;
    span.record("status_class", status_class(resp.status));
    crate::telemetry::record_request(method, status_class(resp.status));
    // Constant security headers (nosniff, CORP) are emitted by the engine's
    // response writer — see api::SECURITY_HEADERS — to avoid two String
    // allocations on every response.
    resp
}

async fn dispatch(store: Arc<Store>, req: Req) -> Resp {
    let path = req.path.clone();
    if path == "/health" {
        text_response(200, "ok")
    } else {
        match req.method {
            Method::Put => handle_create(store, req, path).await,
            Method::Post => handle_append(store, req, path).await,
            Method::Get => handle_read(store, req, path).await,
            Method::Head => handle_head(store, path),
            Method::Delete => handle_delete(store, path),
            Method::Options => ResponseBuilder::new(204).body(empty()),
            Method::Other => text_response(405, "method not allowed"),
        }
    }
}

// ---------- PUT (create) ----------

fn parse_ttl(v: &str) -> Result<u64, ()> {
    if v.is_empty() || !v.bytes().all(|c| c.is_ascii_digit()) {
        return Err(());
    }
    if v.len() > 1 && v.starts_with('0') {
        return Err(());
    }
    v.parse().map_err(|_| ())
}

/// Minimal RFC 3339 parser (YYYY-MM-DDTHH:MM:SS[.frac](Z|±hh:mm)).
fn parse_rfc3339(s: &str) -> Result<SystemTime, ()> {
    let b = s.as_bytes();
    if b.len() < 20 {
        return Err(());
    }
    let num = |r: std::ops::Range<usize>| -> Result<i64, ()> {
        let part = s.get(r).ok_or(())?;
        if !part.bytes().all(|c| c.is_ascii_digit()) {
            return Err(());
        }
        part.parse().map_err(|_| ())
    };
    if b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b't') || b[13] != b':' || b[16] != b':'
    {
        return Err(());
    }
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
    // Reject seconds == 60 (leap seconds), matching the reference server's
    // `new Date(...)` which returns Invalid Date for sec >= 60.
    if !(1..=12).contains(&mo) || h > 23 || mi > 59 || sec > 59 {
        return Err(());
    }
    // Per-month day limits, with leap-year February. This rejects impossible
    // calendar dates (e.g. 2021-02-31) instead of silently rolling them over
    // into a different expiry instant.
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let max_day = match mo {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return Err(()),
    };
    if !(1..=max_day).contains(&d) {
        return Err(());
    }
    let mut idx = 19;
    if b.get(idx) == Some(&b'.') {
        idx += 1;
        let start = idx;
        while idx < b.len() && b[idx].is_ascii_digit() {
            idx += 1;
        }
        if idx == start {
            return Err(());
        }
    }
    let tz_offset_secs: i64 = match b.get(idx) {
        Some(b'Z') | Some(b'z') if idx + 1 == b.len() => 0,
        Some(b'+') | Some(b'-') if idx + 6 == b.len() && b[idx + 3] == b':' => {
            let sign = if b[idx] == b'+' { 1 } else { -1 };
            let oh = num(idx + 1..idx + 3)?;
            let om = num(idx + 4..idx + 6)?;
            sign * (oh * 3600 + om * 60)
        }
        _ => return Err(()),
    };
    // Days-from-civil (Howard Hinnant's algorithm).
    let (y2, mo2) = if mo <= 2 { (y - 1, mo + 12) } else { (y, mo) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (mo2 - 3) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let secs = days * 86400 + h * 3600 + mi * 60 + sec - tz_offset_secs;
    if secs < 0 {
        return Err(());
    }
    Ok(SystemTime::UNIX_EPOCH + Duration::from_secs(secs as u64))
}

async fn handle_create(store: Arc<Store>, req: Req, path: String) -> Resp {
    let content_type = header_str(&req, "content-type")
        .unwrap_or("application/octet-stream")
        .to_string();
    let ttl_raw = header_str(&req, H_TTL).map(|s| s.to_string());
    let exp_raw = header_str(&req, H_EXPIRES_AT).map(|s| s.to_string());
    if ttl_raw.is_some() && exp_raw.is_some() {
        return text_response(400, "Stream-TTL conflicts with Stream-Expires-At");
    }
    let ttl_seconds = match &ttl_raw {
        Some(v) => match parse_ttl(v) {
            Ok(t) => Some(t),
            Err(_) => return text_response(400, "invalid Stream-TTL"),
        },
        None => None,
    };
    let expires_at = match &exp_raw {
        Some(v) => match parse_rfc3339(v) {
            Ok(t) => Some(t),
            Err(_) => return text_response(400, "invalid Stream-Expires-At"),
        },
        None => None,
    };
    let create_closed = header_is_true(&req, H_CLOSED);
    let host = header_str(&req, "host").map(|s| s.to_string());

    // ---- fork header parsing & validation ----
    let forked_from = header_str(&req, H_FORKED_FROM).map(|s| s.to_string());
    let fork_offset_raw = header_str(&req, H_FORK_OFFSET).map(|s| s.to_string());
    let sub_offset_raw = header_str(&req, H_FORK_SUB_OFFSET).map(|s| s.to_string());
    if forked_from.is_none() && (fork_offset_raw.is_some() || sub_offset_raw.is_some()) {
        return text_response(
            400,
            "fork headers require Stream-Forked-From",
        );
    }
    let sub_offset: Option<u64> = match &sub_offset_raw {
        None => None,
        Some(v) => {
            if v.is_empty() || !v.bytes().all(|c| c.is_ascii_digit()) {
                return text_response(400, "malformed Stream-Fork-Sub-Offset");
            }
            match v.parse() {
                Ok(n) => Some(n),
                Err(_) => {
                    return text_response(
                        400,
                        "malformed Stream-Fork-Sub-Offset",
                    )
                }
            }
        }
    };
    if sub_offset.unwrap_or(0) > 0 && fork_offset_raw.is_none() {
        return text_response(
            400,
            "Stream-Fork-Sub-Offset requires Stream-Fork-Offset",
        );
    }

    // Resolve the fork source and the fork point (logical byte offset).
    let content_type_hdr = header_str(&req, "content-type").map(|s| s.to_string());
    let mut parent: Option<Arc<StreamState>> = None;
    let mut base_offset: u64 = 0;
    let mut content_type = content_type;
    let mut ttl_seconds = ttl_seconds;
    let mut expires_at = expires_at;
    let mut exp_raw = exp_raw;
    if let Some(src_path) = &forked_from {
        let src = match store.get(src_path) {
            Some(s) => s,
            None => return text_response(404, "fork source not found"),
        };
        if src.shared.read().unwrap().soft_deleted {
            return text_response(409, "fork source is deleted");
        }
        match &content_type_hdr {
            None => content_type = src.config.content_type.clone(),
            Some(ct) => {
                if media_type(ct) != media_type(&src.config.content_type) {
                    return text_response(409, "fork content-type mismatch");
                }
            }
        }
        let src_tail = src.tail().bytes;
        if sub_offset_raw.is_some() && src_tail == 0 {
            return text_response(
                400,
                "sub-offset on empty source stream",
            );
        }
        // Fork-Offset omitted → divergence at the source's current tail.
        let anchor = match parse_offset(fork_offset_raw.as_deref()) {
            Ok(ParsedOffset::Start) if fork_offset_raw.is_none() => src_tail,
            Ok(ParsedOffset::Start) => 0,
            Ok(ParsedOffset::Now) => src_tail,
            Ok(ParsedOffset::At(b)) => {
                if b > src_tail {
                    return text_response(
                        400,
                        "fork offset beyond stream length",
                    );
                }
                b
            }
            Err(_) => return text_response(400, "malformed fork offset"),
        };
        let fork_point = match sub_offset.unwrap_or(0) {
            0 => anchor,
            sub if src.is_json => {
                // Sub-offset counts messages past the anchor; each message ends with ','.
                let data = match read_range_bytes(&src, anchor, src_tail).await {
                    Ok(d) => d,
                    // A short/cold read must not be miscounted as a value boundary.
                    Err(_) => return text_response(503, "fork source read failed"),
                };
                let mut remaining = sub;
                let mut adv = 0u64;
                for (i, b) in data.iter().enumerate() {
                    if *b == b',' {
                        remaining -= 1;
                        if remaining == 0 {
                            adv = i as u64 + 1;
                            break;
                        }
                    }
                }
                if remaining > 0 {
                    return text_response(
                        400,
                        "sub-offset overshoots message count",
                    );
                }
                anchor + adv
            }
            sub => {
                if anchor + sub > src_tail {
                    return text_response(
                        400,
                        "sub-offset overshoots message length",
                    );
                }
                anchor + sub
            }
        };
        // TTL/expiry inheritance: only when the fork specifies neither.
        if ttl_seconds.is_none() && exp_raw.is_none() {
            ttl_seconds = src.config.ttl_seconds;
            expires_at = src.config.expires_at;
            exp_raw = src.config.expires_at_raw.clone();
        }
        base_offset = fork_point;
        parent = Some(src);
    }

    let body = req.body.clone();

    let config = StreamConfig {
        content_type: content_type.clone(),
        ttl_seconds,
        expires_at,
        expires_at_raw: exp_raw,
        create_closed,
        forked_from,
        fork_offset_raw,
        fork_sub_offset: sub_offset,
    };

    let is_json = is_json_content_type(&content_type);
    // Validate / transform initial body before creating.
    let wire: Option<Bytes> = if body.is_empty() {
        None
    } else {
        match encode_wire(&body, is_json, true) {
            Ok(w) => Some(w),
            Err(msg) => return text_response(400, msg),
        }
    };

    // Run create on the blocking pool: it opens the data file and does a durable
    // (fsync) `.meta` write, which would otherwise block an async worker for the
    // whole fsync. Under concurrent stream creation that throttles creates to
    // ~(worker_count / fsync_latency) and times them out (the "stream creation
    // doesn't scale past ~200 PUTs" finding). On the blocking pool many creates
    // fsync concurrently and the async workers stay free to dispatch.
    let result = {
        let store = store.clone();
        match tokio::task::spawn_blocking(move || store.create(&path, config, parent, base_offset))
            .await
        {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => return text_response(500, &e.to_string()),
            Err(_) => return text_response(500, "create task failed"),
        }
    };
    match result {
        CreateResult::Conflict => text_response(409, "stream exists with different configuration"),
        CreateResult::Exists(st) => {
            st.touch();
            let t = st.tail();
            let mut b = ResponseBuilder::new(200)
                .h("content-type", st.config.content_type.clone())
                .h(H_NEXT_OFFSET, format_offset(t.bytes));
            if t.closed {
                b = b.hs(H_CLOSED, "true");
            }
            b.body(empty())
        }
        CreateResult::Created(st) => {
            if let Some(wire) = wire {
                let lock_t0 = crate::telemetry::Timer::start();
                let mut ap = st.appender.lock().await;
                crate::telemetry::record_append_lock_wait(lock_t0.elapsed_secs());
                if write_wire(&st, &mut ap, &wire).is_err() {
                    return text_response(500, "write failed");
                }
                let target = ap.written;
                // Read `file_base` under the appender lock so a concurrent
                // compaction that raises `file_base` + resets `ap.written` together
                // can't desync it from `target`.
                let stream_offset = wal_stream_offset(&st, target, &wire);
                drop(ap);
                if maybe_sync_on_ack(&store, &st, &wire, stream_offset)
                    .await
                    .is_err()
                {
                    return text_response(500, "fsync failed");
                }
            }
            let t = st.tail();
            let mut b = ResponseBuilder::new(201)
                .h("location", format!("http://{}{}", host.as_deref().unwrap_or("localhost"), st.path))
                .h("content-type", st.config.content_type.clone())
                .h(H_NEXT_OFFSET, format_offset(t.bytes));
            if t.closed {
                b = b.hs(H_CLOSED, "true");
            }
            b.body(empty())
        }
    }
}

// ---------- wire encoding (JSON flattening) ----------

/// Convert a request body into the contiguous wire-byte representation.
/// JSON: each message is the raw value followed by a `,`; arrays flatten one level.
fn encode_wire(body: &Bytes, is_json: bool, allow_empty_array: bool) -> Result<Bytes, &'static str> {
    if !is_json {
        return Ok(body.clone());
    }
    let text = std::str::from_utf8(body).map_err(|_| "invalid UTF-8 in JSON body")?;
    let trimmed = text.trim_start();
    if trimmed.starts_with('[') {
        let elems: Vec<&RawValue> =
            serde_json::from_str(text).map_err(|_| "invalid JSON body")?;
        if elems.is_empty() {
            if allow_empty_array {
                return Ok(Bytes::new());
            }
            return Err("empty JSON array append");
        }
        let mut out = BytesMut::with_capacity(body.len());
        for e in &elems {
            out.put_slice(e.get().as_bytes());
            out.put_u8(b',');
        }
        Ok(out.freeze())
    } else {
        let v: &RawValue = serde_json::from_str(text).map_err(|_| "invalid JSON body")?;
        let raw = v.get();
        let mut out = BytesMut::with_capacity(raw.len() + 1);
        out.put_slice(raw.as_bytes());
        out.put_u8(b',');
        Ok(out.freeze())
    }
}

/// Fire a background sealing/offload pass for a stream after a durable append.
/// No-op when tiering is off (checked inside `maybe_seal`); never blocks the
/// append ack — the work runs on a detached task.
fn maybe_seal_bg(store: &Arc<Store>, st: &Arc<StreamState>) {
    if !store.tier_config.enabled() {
        return;
    }
    let store = store.clone();
    let st = st.clone();
    tokio::spawn(async move {
        store.maybe_seal(&st).await;
    });
}

/// Compute the logical pre-append `stream_offset` for the WAL record.
///
/// MUST be called while the caller still holds the appender lock: `file_base`
/// and `target` (`ap.written`) are reset together under that lock on compaction,
/// so reading `file_base` here keeps it consistent with the captured `target`.
fn wal_stream_offset(st: &StreamState, target: u64, wire: &Bytes) -> u64 {
    st.shared.read().unwrap().file_base + target - wire.len() as u64
}

async fn maybe_sync_on_ack(
    store: &Arc<Store>,
    st: &Arc<StreamState>,
    wire: &Bytes,
    stream_offset: u64,
) -> std::io::Result<()> {
    // memory mode: no WAL — the page-cache file write IS the ack. No fsync, no stage.
    if durability() == DurabilityMode::Memory {
        return Ok(());
    }
    let wal = store.wal.get().expect("WAL must be attached before serving");
    let shard = wal.shard_for(st.id);
    // Register the touched per-stream file into the shard's dirty set
    // (spec §7) BEFORE staging the WAL record — see the full ordering note in
    // the WAL spec. Registering first closes the recycle-before-fsync window.
    shard.register_dirty(st.id, Arc::clone(st));
    let lsn = shard.reserve_and_stage(
        crate::wal::codec::RecordKind::Append,
        st.id,
        stream_offset,
        wire,
    )?;
    shard.wait_durable(lsn).await;
    Ok(())
}

fn write_wire(st: &StreamState, ap: &mut Appender, wire: &Bytes) -> std::io::Result<()> {
    use std::io::Write;
    (&*ap.file).write_all(wire)?;
    ap.written += wire.len() as u64;
    let tail;
    let closed;
    {
        let mut s = st.shared.write().unwrap();
        tail = s.file_base + ap.written;
        s.tail = tail;
        s.last_access = SystemTime::now();
        closed = s.closed_durable;
    }
    // Publish the resident chunk BEFORE waking subscribers, so a long-poll/SSE
    // reader woken by the tail update reliably hits the cache (one shared copy)
    // instead of racing ahead and falling back to a file read. The chunk spans
    // [tail - wire.len(), tail).
    st.set_last_chunk(tail - wire.len() as u64, wire.clone());
    st.tail_tx.send_replace(Tail {
        bytes: tail,
        closed,
    });
    Ok(())
}

// ---------- POST (append) ----------

struct ProducerHeaders {
    id: String,
    epoch: u64,
    seq: u64,
}

fn parse_producer_headers(req: &Req) -> Result<Option<ProducerHeaders>, &'static str> {
    let id = header_str(req, H_PRODUCER_ID);
    let epoch = header_str(req, H_PRODUCER_EPOCH);
    let seq = header_str(req, H_PRODUCER_SEQ);
    match (id, epoch, seq) {
        (None, None, None) => Ok(None),
        (Some(id), Some(e), Some(s)) => {
            if id.is_empty() {
                return Err("empty Producer-Id");
            }
            let parse_int = |v: &str| -> Result<u64, &'static str> {
                if v.is_empty() || !v.bytes().all(|c| c.is_ascii_digit()) {
                    return Err("invalid producer header");
                }
                let n: u64 = v.parse().map_err(|_| "invalid producer header")?;
                if n > MAX_SAFE_INT {
                    return Err("producer header out of range");
                }
                Ok(n)
            };
            Ok(Some(ProducerHeaders {
                id: id.to_string(),
                epoch: parse_int(e)?,
                seq: parse_int(s)?,
            }))
        }
        _ => Err("producer headers must all be provided together"),
    }
}

enum ProducerOutcome {
    Accept,
    Duplicate { last_seq: u64 },
    StaleEpoch { current: u64 },
    Gap { expected: u64 },
    BadEpochStart,
}

fn validate_producer(shared: &Shared, p: &ProducerHeaders) -> ProducerOutcome {
    match shared.producers.get(&p.id) {
        None => {
            if p.seq == 0 {
                ProducerOutcome::Accept
            } else {
                ProducerOutcome::Gap { expected: 0 }
            }
        }
        Some(state) => {
            if p.epoch < state.epoch {
                ProducerOutcome::StaleEpoch {
                    current: state.epoch,
                }
            } else if p.epoch > state.epoch {
                if p.seq == 0 {
                    ProducerOutcome::Accept
                } else {
                    ProducerOutcome::BadEpochStart
                }
            } else if p.seq <= state.last_seq {
                ProducerOutcome::Duplicate {
                    last_seq: state.last_seq,
                }
            } else if p.seq == state.last_seq + 1 {
                ProducerOutcome::Accept
            } else {
                ProducerOutcome::Gap {
                    expected: state.last_seq + 1,
                }
            }
        }
    }
}

fn gone() -> Resp {
    text_response(410, "stream is deleted")
}

/// Append outcome, recorded as a bounded metric label on `ds.append.duration`.
#[derive(Clone, Copy)]
enum AppendOutcome {
    Accept,
    Dup,
    Conflict,
    Closed,
}

impl AppendOutcome {
    fn label(self) -> &'static str {
        match self {
            AppendOutcome::Accept => "accept",
            AppendOutcome::Dup => "dup",
            AppendOutcome::Conflict => "conflict",
            AppendOutcome::Closed => "closed",
        }
    }
}

async fn handle_append(store: Arc<Store>, req: Req, path: String) -> Resp {
    let t0 = crate::telemetry::Timer::start();
    // is_json is needed for the metric label even on the not-found path, where we
    // don't have a stream; default to false there.
    let is_json = store.get(&path).map(|s| s.is_json).unwrap_or(false);
    let (resp, outcome) = handle_append_inner(store, req, path).await;
    crate::telemetry::record_append(t0.elapsed_secs(), outcome.label(), is_json);
    resp
}

async fn handle_append_inner(store: Arc<Store>, req: Req, path: String) -> (Resp, AppendOutcome) {
    use AppendOutcome::*;
    macro_rules! ret {
        ($resp:expr, $oc:expr) => {
            return ($resp, $oc)
        };
    }
    let st = match store.get(&path) {
        Some(s) => s,
        None => ret!(text_response(404, "stream not found"), Conflict),
    };
    if st.shared.read().unwrap().soft_deleted {
        ret!(gone(), Conflict);
    }
    let producer = match parse_producer_headers(&req) {
        Ok(p) => p,
        Err(m) => ret!(text_response(400, m), Conflict),
    };
    let close_req = header_is_true(&req, H_CLOSED);
    let seq_header = header_str(&req, H_SEQ).map(|s| s.to_string());
    let req_ct = header_str(&req, "content-type").map(|s| s.to_string());

    let body = req.body.clone();

    if body.is_empty() && !close_req {
        ret!(text_response(400, "empty append body"), Conflict);
    }
    if !body.is_empty() {
        match &req_ct {
            None => ret!(text_response(400, "missing Content-Type"), Conflict),
            Some(ct) => {
                if media_type(ct) != media_type(&st.config.content_type) {
                    // closed check has precedence over content-type mismatch
                    let t = st.tail();
                    if t.closed && !close_req {
                        ret!(closed_conflict(t.bytes), Closed);
                    }
                    ret!(text_response(409, "content-type mismatch"), Conflict);
                }
            }
        }
    }

    let wire = if body.is_empty() {
        Bytes::new()
    } else {
        match encode_wire(&body, st.is_json, false) {
            Ok(w) => w,
            Err(m) => ret!(text_response(400, m), Conflict),
        }
    };

    // Serialize per stream: producer validation + write + state update under one
    // lock. Time the wait separately — lock contention is a key bottleneck.
    let lock_t0 = crate::telemetry::Timer::start();
    let mut ap = st.appender.lock().await;
    crate::telemetry::record_append_lock_wait(lock_t0.elapsed_secs());

    // Closed checks (precedence: closed → seq regression → gap).
    {
        let s = st.shared.read().unwrap();
        if s.closed {
            let tail = s.tail;
            if close_req {
                if let Some(p) = &producer {
                    if let Some((cid, cep, cseq)) = &s.closed_by {
                        if *cid == p.id && *cep == p.epoch && *cseq == p.seq {
                            drop(s);
                            ret!(
                                ResponseBuilder::new(204)
                                    .hs(H_CLOSED, "true")
                                    .h(H_NEXT_OFFSET, format_offset(tail))
                                    .h(H_PRODUCER_EPOCH, p.epoch.to_string())
                                    .h(H_PRODUCER_SEQ, p.seq.to_string())
                                    .body(empty()),
                                Dup
                            );
                        }
                    }
                    drop(s);
                    ret!(closed_conflict(tail), Closed);
                }
                if body.is_empty() {
                    // idempotent close of an already-closed stream
                    drop(s);
                    ret!(
                        ResponseBuilder::new(204)
                            .hs(H_CLOSED, "true")
                            .h(H_NEXT_OFFSET, format_offset(tail))
                            .body(empty()),
                        Dup
                    );
                }
            }
            drop(s);
            ret!(closed_conflict(tail), Closed);
        }
    }

    // Producer validation.
    if let Some(p) = &producer {
        let outcome = {
            let s = st.shared.read().unwrap();
            validate_producer(&s, p)
        };
        match outcome {
            ProducerOutcome::Accept => {}
            ProducerOutcome::Duplicate { last_seq } => {
                let tail = st.shared.read().unwrap().tail;
                let mut b = ResponseBuilder::new(204)
                    .h(H_NEXT_OFFSET, format_offset(tail))
                    .h(H_PRODUCER_EPOCH, p.epoch.to_string())
                    .h(H_PRODUCER_SEQ, last_seq.to_string());
                if close_req {
                    b = b.hs(H_CLOSED, "true");
                }
                ret!(b.body(empty()), Dup);
            }
            ProducerOutcome::StaleEpoch { current } => {
                ret!(
                    ResponseBuilder::new(403)
                        .h(H_PRODUCER_EPOCH, current.to_string())
                        .body(full("stale producer epoch")),
                    Conflict
                );
            }
            ProducerOutcome::Gap { expected } => {
                ret!(
                    ResponseBuilder::new(409)
                        .h(H_PRODUCER_EXPECTED, expected.to_string())
                        .h(H_PRODUCER_RECEIVED, p.seq.to_string())
                        .body(full("producer sequence gap")),
                    Conflict
                );
            }
            ProducerOutcome::BadEpochStart => {
                ret!(
                    text_response(400, "new producer epoch must start at seq 0"),
                    Conflict
                );
            }
        }
    }
    // Stream-Seq (writer sequencing) regression check — after producer dedup so
    // duplicate producer requests stay idempotent (204).
    if let Some(seq) = &seq_header {
        let s = st.shared.read().unwrap();
        if let Some(last) = &s.last_seq_header {
            if seq.as_str() <= last.as_str() {
                let tail = s.tail;
                drop(s);
                // Body must read "Sequence conflict" to match the reference
                // server: clients classify a 409 as a sequence conflict by the
                // word "sequence" in the message (see @durable-streams/client).
                ret!(
                    ResponseBuilder::new(409)
                        .h(H_NEXT_OFFSET, format_offset(tail))
                        .body(full("Sequence conflict")),
                    Conflict
                );
            }
        }
    }

    // Write + state updates.
    if !wire.is_empty() && write_wire(&st, &mut ap, &wire).is_err() {
        ret!(text_response(500, "write failed"), Conflict);
    }
    {
        let mut s = st.shared.write().unwrap();
        if let Some(p) = &producer {
            s.producers.insert(
                p.id.clone(),
                ProducerState {
                    epoch: p.epoch,
                    last_seq: p.seq,
                },
            );
        }
        if let Some(seq) = seq_header {
            s.last_seq_header = Some(seq);
        }
        if close_req {
            // Set the closed flag in memory so the durable meta capture below
            // records it, but DO NOT notify readers (tail_tx) yet. The closure
            // must be durable before any reader can observe EOF; otherwise a
            // reader could act on the close, the server could crash before the
            // closure is fsynced, and the stream would recover OPEN — a
            // monotonicity violation (PROTOCOL.md §4.1). The reader
            // notification is deferred until after write_meta_sync completes.
            s.closed = true;
            if let Some(p) = &producer {
                s.closed_by = Some((p.id.clone(), p.epoch, p.seq));
            }
        }
    }
    let target = ap.written;
    // Read `file_base` under the appender lock so a concurrent compaction can't desync
    // it from `target`.
    let stream_offset = wal_stream_offset(&st, target, &wire);
    drop(ap);

    // Covering fsync failed: not durable. Error out (and skip the close commit
    // below) rather than ack 2xx.
    if !wire.is_empty()
        && maybe_sync_on_ack(&store, &st, &wire, stream_offset)
            .await
            .is_err()
    {
        ret!(text_response(500, "fsync failed"), Conflict);
    }

    // Closure ordering: WAL fsync → durable meta commit → expose the closure to
    // readers (closed_durable) and wake waiters. Readers never observe EOF for a
    // closure that is not yet durable (PROTOCOL.md §4.1).
    // Producer/access updates are debounced (documented crash window; see store::Meta).
    if close_req {
        let st2 = st.clone();
        let meta_res = tokio::task::spawn_blocking(move || write_meta_sync(&st2, true)).await;
        if !matches!(meta_res, Ok(Ok(()))) {
            ret!(text_response(500, "close not durable"), Conflict);
        }
        let tail = {
            let mut s = st.shared.write().unwrap();
            s.closed_durable = true;
            s.tail
        };
        st.tail_tx.send_replace(Tail { bytes: tail, closed: true });
    } else {
        st.schedule_meta_flush();
    }
    if !wire.is_empty() {
        maybe_seal_bg(&store, &st);
    }

    let tail = st.tail();
    let status = if producer.is_some() && !body.is_empty() {
        200
    } else {
        204
    };
    let mut b = ResponseBuilder::new(status).h(H_NEXT_OFFSET, format_offset(tail.bytes));
    if let Some(p) = &producer {
        b = b
            .h(H_PRODUCER_EPOCH, p.epoch.to_string())
            .h(H_PRODUCER_SEQ, p.seq.to_string());
    }
    if tail.closed {
        b = b.hs(H_CLOSED, "true");
    }
    (b.body(empty()), Accept)
}

fn closed_conflict(tail: u64) -> Resp {
    ResponseBuilder::new(409)
        .hs(H_CLOSED, "true")
        .h(H_NEXT_OFFSET, format_offset(tail))
        .body(full("stream is closed"))
}

// ---------- POST (append) — zero-copy socket→file splice path (Linux, --durability memory) ----------

/// Result of the zero-copy append entry. `Fallback` means the engine must fall
/// back to the buffered append path (read the whole body, run `handle`): the
/// request is anything but the simple happy-path append (a producer dup/gap/
/// stale-epoch, a `Stream-Seq` regression, a closed stream, a close request, a
/// missing/mismatched content-type, …). Every such edge case is handled
/// byte-for-byte by the existing buffered handler — the splice path deliberately
/// covers only the accept-and-write case so its critical section is a tight
/// mirror of `write_wire` + `maybe_sync_on_ack`.
#[cfg(target_os = "linux")]
pub enum ZeroCopyOutcome {
    /// Append handled; send `resp` and continue keep-alive as normal.
    Done(Resp),
    /// A splice leg failed mid-append: some body bytes may have already been
    /// consumed from the socket, so the HTTP framing is desynced. Send `resp`
    /// (a 500) but then CLOSE the connection — it must NOT be reused as
    /// keep-alive (a stale partial body would corrupt the next request).
    DoneClose(Resp),
    Fallback,
}

/// Zero-copy binary append (`--durability memory`): relay the request body
/// socket→file via `splice(2)` while holding the appender lock, then ack — the
/// offset/producer semantics are identical to the buffered append, only the byte
/// movement differs (no userspace `Bytes`). There is no WAL in memory mode: the
/// per-stream file write is the ack (durability comes from replication).
///
/// The caller (engine) has already confirmed: `--durability memory` (the engine
/// zero-copy intercept), `POST`, a known
/// `content_length` (not chunked), and a binary (non-JSON) target stream.
/// `prefix` is the leading body bytes the HTTP parser over-read; `splice_rest`
/// moves the remaining `content_len - prefix.len()` bytes from the socket to the
/// given `(file_fd, offset)` (the engine owns the socket fd + pipe machinery).
///
/// Returns `Fallback` for anything that is not a plain accept (see
/// `ZeroCopyOutcome`); the engine then reads the body buffered and runs the
/// normal handler. No stream state is mutated before the accept decision, so the
/// fallback re-validates from scratch and is fully idempotent.
///
/// `splice_rest` moves the remaining `content_len - prefix.len()` body bytes from
/// the socket to `(file_fd, offset)` and is `async`: the socket is non-blocking,
/// so the socket→file splice awaits read-readiness (it may park if the body has
/// not fully arrived). It is awaited here WHILE the appender `AsyncMutex` is held
/// — intended per-stream serialization; holding it across `.await` is supported.
#[cfg(target_os = "linux")]
pub async fn handle_binary_append_zero_copy<F, Fut>(
    store: Arc<Store>,
    req: &Req,
    prefix: &[u8],
    content_len: usize,
    splice_rest: F,
) -> ZeroCopyOutcome
where
    F: FnOnce(std::os::fd::RawFd, i64) -> Fut,
    Fut: std::future::Future<Output = std::io::Result<()>>,
{
    use std::os::fd::AsRawFd;

    let path = req.path.clone();
    // Route. A missing/soft-deleted/JSON stream, or one whose content-type does
    // not match, is an edge case → buffered fallback.
    let st = match store.get(&path) {
        Some(s) => s,
        None => return ZeroCopyOutcome::Fallback,
    };
    if st.is_json || st.shared.read().unwrap().soft_deleted {
        return ZeroCopyOutcome::Fallback;
    }
    // A close request, an empty body, or producer headers that don't parse are
    // all handled by the buffered path. Likewise any explicit close.
    if header_is_true(req, H_CLOSED) || content_len == 0 {
        return ZeroCopyOutcome::Fallback;
    }
    let producer = match parse_producer_headers(req) {
        Ok(p) => p,
        Err(_) => return ZeroCopyOutcome::Fallback,
    };
    let seq_header = header_str(req, H_SEQ).map(|s| s.to_string());
    // Content-type must be present and match (binary stream): a missing or
    // mismatched type is a 4xx the buffered path renders.
    match header_str(req, "content-type") {
        None => return ZeroCopyOutcome::Fallback,
        Some(ct) => {
            if media_type(ct) != media_type(&st.config.content_type) {
                return ZeroCopyOutcome::Fallback;
            }
        }
    }

    // Serialize per stream — same lock the buffered path holds across the byte
    // write. Held across the socket→file splice (the appender's per-stream
    // serialization).
    let lock_t0 = crate::telemetry::Timer::start();
    let mut ap = st.appender.lock().await;
    crate::telemetry::record_append_lock_wait(lock_t0.elapsed_secs());

    // Re-check closed / producer / seq under the lock. ANY non-accept outcome →
    // fall back (the lock is released on drop, no state mutated).
    {
        let s = st.shared.read().unwrap();
        if s.closed {
            return ZeroCopyOutcome::Fallback;
        }
    }
    if let Some(p) = &producer {
        let outcome = {
            let s = st.shared.read().unwrap();
            validate_producer(&s, p)
        };
        if !matches!(outcome, ProducerOutcome::Accept) {
            return ZeroCopyOutcome::Fallback;
        }
    }
    if let Some(seq) = &seq_header {
        let s = st.shared.read().unwrap();
        if let Some(last) = &s.last_seq_header {
            if seq.as_str() <= last.as_str() {
                return ZeroCopyOutcome::Fallback;
            }
        }
    }

    // ---- accepted: drive the socket→file splice ----
    // File offset O where this append lands in the stream's own data file.
    let file_off = ap.written;

    // Open a fresh non-O_APPEND fd for positioned writes (splice rejects O_APPEND).
    let splice_file = match st.open_splice_fd() {
        Ok(f) => f,
        Err(_) => return ZeroCopyOutcome::Fallback,
    };
    let file_fd = splice_file.as_raw_fd();

    // Write the already-buffered prefix at O (positioned). On failure the
    // remaining body is still unconsumed on the socket, so the HTTP framing is
    // desynced → force-close (see DoneClose).
    if !prefix.is_empty() {
        use std::os::unix::fs::FileExt;
        if splice_file.write_all_at(prefix, file_off).is_err() {
            return ZeroCopyOutcome::DoneClose(text_response(500, "write failed"));
        }
    }
    // Relay the rest socket→file at O+prefix.len() (awaits socket read-readiness
    // — the socket is non-blocking). On failure some body bytes may already be
    // consumed from the socket → desynced → force-close.
    let rest_off = (file_off + prefix.len() as u64) as i64;
    if splice_rest(file_fd, rest_off).await.is_err() {
        return ZeroCopyOutcome::DoneClose(text_response(500, "write failed"));
    }

    // Publish the new logical tail. `ap.written` and `s.tail` advance under the
    // lock exactly as in `write_wire`. The tail cache is OFF under
    // --durability memory, so we do NOT call set_last_chunk.
    ap.written += content_len as u64;
    let (tail, closed) = {
        let mut s = st.shared.write().unwrap();
        let tail = s.file_base + ap.written;
        s.tail = tail;
        s.last_access = SystemTime::now();
        (tail, s.closed_durable)
    };
    st.tail_tx.send_replace(Tail { bytes: tail, closed });

    // Shared response builder: captures `st`, `producer` by ref.
    let make_ok = || {
        let t = st.tail();
        let status = if producer.is_some() { 200 } else { 204 };
        let mut b = ResponseBuilder::new(status).h(H_NEXT_OFFSET, format_offset(t.bytes));
        if let Some(p) = &producer {
            b = b
                .h(H_PRODUCER_EPOCH, p.epoch.to_string())
                .h(H_PRODUCER_SEQ, p.seq.to_string());
        }
        if t.closed {
            b = b.hs(H_CLOSED, "true");
        }
        ZeroCopyOutcome::Done(b.body(empty()))
    };

    // This path is reached only in `--durability memory` (the engine zero-copy
    // intercept is enabled solely by that mode). The per-stream file write IS the
    // durable-enough ack (no WAL, no fsync — durability comes from replication).
    debug_assert_eq!(durability(), DurabilityMode::Memory);
    // Commit producer/seq dedup state under the appender lock so a concurrent
    // same-producer request cannot double-accept.
    {
        let mut s = st.shared.write().unwrap();
        if let Some(p) = &producer {
            s.producers.insert(
                p.id.clone(),
                ProducerState { epoch: p.epoch, last_seq: p.seq },
            );
        }
        if let Some(seq) = &seq_header {
            s.last_seq_header = Some(seq.clone());
        }
    }
    drop(ap); // critical section ends
    st.schedule_meta_flush();
    maybe_seal_bg(&store, &st);
    make_ok()
}

// ---------- reading bodies from the data file ----------

/// Describe payload range [start, end) as a response body. No I/O happens
/// here — the HTTP engine serves the segments (buffered copy, or sendfile on
/// engines that support it). JSON ranges always end on a `,` boundary; the
/// response is `[` + range-minus-comma + `]`. Logical ranges below the fork
/// base resolve through the parent chain.
/// Build a FileRange body for `[start, end)`. `hot` marks a live tail feed of
/// freshly-appended bytes (a caught-up long-poll wake), which the raw engine
/// can serve inline knowing it is page-cache resident.
async fn read_range_body(
    st: &Arc<StreamState>,
    start: u64,
    end: u64,
    hot: bool,
    live: &'static str,
    cache_hit: &mut bool,
) -> Body {
    let json = st.is_json;
    if end <= start {
        return if json { full("[]") } else { empty() };
    }
    let (data_start, data_end) = if json { (start, end - 1) } else { (start, end) };
    // Fast path: if the range is fully covered by the resident tail chunk
    // (the common caught-up / just-appended case), serve it from memory — no
    // file read, and shared across every concurrent reader of this append.
    let slice = st.tail_chunk_slice(data_start, data_end);
    *cache_hit = slice.is_some();
    crate::telemetry::record_tail_cache(slice.is_some(), live);
    if let Some(bytes) = slice {
        if json {
            let mut out = BytesMut::with_capacity(bytes.len() + 2);
            out.put_u8(b'[');
            out.put_slice(&bytes);
            out.put_u8(b']');
            return Body::Full(out.freeze());
        }
        return Body::Full(bytes);
    }
    let prefix: &'static [u8] = if json { b"[" } else { b"" };
    let suffix: &'static [u8] = if json { b"]" } else { b"" };
    // Resolve the range once. If it lands entirely on local fds (the live data
    // file and/or sealed chunk files) serve it zero-copy via Body::FileRange —
    // the only path when tiering is off, byte-for-byte the old behaviour.
    // Otherwise stream the placement-aware slices as a chunked channel so peak
    // memory stays O(segment) — one range-GET per remote segment, windowed local
    // reads — never O(read size).
    let mut slices = Vec::new();
    crate::store::resolve_range(st, data_start, data_end, &mut slices);
    match crate::store::into_local_segments(slices) {
        Ok(segments) => Body::FileRange {
            segments,
            prefix,
            suffix,
            hot,
        },
        Err(slices) => stream_resolved_body(st, slices, prefix, suffix),
    }
}

/// Per-item read window for the local parts of a streamed cold/mixed read.
/// Remote parts are already one range-GET per sealed segment (the natural unit:
/// one object = one segment, so per-segment GETs minimize object-store
/// round-trips); local parts are cheap preads, windowed here only to bound
/// memory. Together peak memory stays O(segment).
const COLD_LOCAL_WINDOW: usize = 1024 * 1024;

/// Stream pre-resolved placement-aware slices as a chunked `Body::Channel`: one
/// item per remote segment (a single range-GET) plus windowed local reads, framed
/// by `prefix`/`suffix`. Memory stays bounded regardless of how large the cold
/// range is (the failure mode of the old buffer-it-all `Body::Full` path). The
/// slices are resolved by the caller (which already opened any chunk-file fds
/// under the manifest lock), so this never re-walks the manifest.
fn stream_resolved_body(
    st: &Arc<StreamState>,
    slices: Vec<crate::store::ResolvedSlice>,
    prefix: &'static [u8],
    suffix: &'static [u8],
) -> Body {
    use crate::store::ResolvedSlice;
    use std::sync::atomic::{AtomicBool, Ordering};
    let (tx, rx) = mpsc::channel::<Bytes>(4);
    let failed = Arc::new(AtomicBool::new(false));
    let st = st.clone();
    let failed_producer = failed.clone();
    tokio::spawn(async move {
        // Mark the stream as aborted-due-to-error so the engine drops the
        // connection (no clean chunked terminator) instead of serving a
        // well-formed but truncated response. A `tx.send` failure is the client
        // going away (not our error), so it does NOT set the flag.
        let fail = || failed_producer.store(true, Ordering::Release);
        if !prefix.is_empty() && tx.send(Bytes::from_static(prefix)).await.is_err() {
            return;
        }
        for sl in slices {
            match sl {
                ResolvedSlice::Local(seg) => {
                    // Window the (possibly large) local slice so we never hold
                    // more than COLD_LOCAL_WINDOW of it in memory at once.
                    let mut off = 0u64;
                    while off < seg.len {
                        let n = (seg.len - off).min(COLD_LOCAL_WINDOW as u64);
                        let win = Segment {
                            file: seg.file.clone(),
                            file_start: seg.file_start + off,
                            len: n,
                        };
                        let bytes = tokio::task::spawn_blocking(move || {
                            materialize_segments(&[win])
                        })
                        .await
                        .unwrap_or_default();
                        // A short read means we cannot honour the content — abort
                        // (set the flag) so the engine drops the connection rather
                        // than emitting a clean-but-truncated response.
                        if bytes.len() as u64 != n {
                            fail();
                            return;
                        }
                        if tx.send(bytes).await.is_err() {
                            return; // client gone — not our failure
                        }
                        off += n;
                    }
                }
                ResolvedSlice::Remote { key, offset, len } => {
                    let Some(bs) = &st.blobstore else {
                        fail();
                        return;
                    };
                    match bs.get_range(&key, offset, len).await {
                        // Validate the object came back at full length — a
                        // truncated cold read must abort, never be forwarded.
                        Ok(b) if b.len() as u64 == len => {
                            if tx.send(b).await.is_err() {
                                return; // client gone
                            }
                        }
                        _ => {
                            fail();
                            return;
                        }
                    }
                }
            }
        }
        if !suffix.is_empty() {
            let _ = tx.send(Bytes::from_static(suffix)).await;
        }
    });
    Body::Channel(crate::api::StreamBody { rx, failed })
}

/// Materialize pre-resolved placement-aware slices into one contiguous buffer:
/// local file segments via positioned reads, remote segments via the BlobStore,
/// spliced in offset order, framed by `prefix`/`suffix`.
async fn materialize_resolved(
    st: &Arc<StreamState>,
    slices: Vec<crate::store::ResolvedSlice>,
    prefix: &'static [u8],
    suffix: &'static [u8],
) -> std::io::Result<Bytes> {
    use crate::store::ResolvedSlice;
    use std::io::{Error, ErrorKind};
    let mut out = BytesMut::new();
    out.put_slice(prefix);
    for sl in slices {
        match sl {
            ResolvedSlice::Local(seg) => {
                let want = seg.len;
                let bytes = tokio::task::spawn_blocking(move || {
                    crate::store::materialize_segments(&[seg])
                })
                .await
                .unwrap_or_default();
                // A short local read must not be forwarded as complete.
                if bytes.len() as u64 != want {
                    return Err(Error::new(ErrorKind::UnexpectedEof, "short local read"));
                }
                out.put_slice(&bytes);
            }
            ResolvedSlice::Remote { key, offset, len } => {
                let Some(bs) = &st.blobstore else {
                    return Err(Error::other("remote slice but no blobstore configured"));
                };
                match bs.get_range(&key, offset, len).await {
                    // Validate full length — a truncated object must not be
                    // forwarded as if complete.
                    Ok(b) if b.len() as u64 == len => out.put_slice(&b),
                    Ok(_) => {
                        return Err(Error::new(ErrorKind::UnexpectedEof, "truncated cold object"))
                    }
                    Err(e) => return Err(e),
                }
            }
        }
    }
    out.put_slice(suffix);
    Ok(out.freeze())
}

// ---------- GET (catch-up / long-poll / SSE) ----------

async fn handle_read(store: Arc<Store>, req: Req, path: String) -> Resp {
    let st = match store.get(&path) {
        Some(s) => s,
        None => return text_response(404, "stream not found"),
    };
    if st.shared.read().unwrap().soft_deleted {
        return gone();
    }
    // Only TTL is reset by a read, and touch() takes the write lock — skip it for
    // non-TTL streams to keep their read path lock-free.
    if st.config.ttl_seconds.is_some() {
        st.touch();
        st.schedule_meta_flush(); // sliding TTL must survive restarts
    }
    let q = parse_query(req.query.as_deref());
    let offset = match parse_offset(q.offset.as_deref()) {
        Ok(o) => o,
        Err(_) => return text_response(400, "malformed offset"),
    };
    let live = q.live.as_deref();
    if live.is_some() && q.offset.is_none() {
        return text_response(400, "offset is required for live modes");
    }
    let t0 = crate::telemetry::Timer::start();
    let mut cache_hit = false;
    let (resp, live_label) = match live {
        Some("long-poll") => (
            handle_long_poll(st, offset, q.cursor, &mut cache_hit).await,
            "long-poll",
        ),
        // SSE records its own read metric per emitted batch (streaming, no single
        // dispatch latency); the dispatch here just sets up the channel.
        Some("sse") => return handle_sse(st, offset, q.cursor).await,
        Some(_) => return text_response(400, "invalid live mode"),
        None => (
            handle_catchup(st, offset, &req, &mut cache_hit).await,
            "catchup",
        ),
    };
    crate::telemetry::record_read(t0.elapsed_secs(), live_label, cache_hit);
    resp
}

async fn handle_catchup(
    st: Arc<StreamState>,
    offset: ParsedOffset,
    req: &Req,
    cache_hit: &mut bool,
) -> Resp {
    let t = st.tail();
    let (start, now_mode) = match offset {
        ParsedOffset::Start => (0, false),
        ParsedOffset::Now => (t.bytes, true),
        ParsedOffset::At(b) => {
            if b > t.bytes {
                return text_response(400, "offset beyond tail");
            }
            (b, false)
        }
    };
    let end = t.bytes;
    // No ETag for offset=now (§10.1) — it's a tail sentinel, not a cacheable range.
    let etag = (!now_mode).then(|| st.etag(start, end, t.closed));
    if let Some(etag) = &etag {
        if header_str(req, "if-none-match") == Some(etag.as_str()) {
            let mut b = ResponseBuilder::new(304)
                .h("etag", etag.clone())
                .h(H_NEXT_OFFSET, format_offset(end))
                .hs(H_UP_TO_DATE, "true");
            if t.closed {
                b = b.hs(H_CLOSED, "true");
            }
            return b.body(empty());
        }
    }
    // Catch-up read of historical bytes: not a live tail feed.
    let body = read_range_body(&st, start, end, false, "catchup", cache_hit).await;
    let mut b = ResponseBuilder::new(200)
        .h("content-type", st.config.content_type.clone())
        .h(H_NEXT_OFFSET, format_offset(end))
        .hs(H_UP_TO_DATE, "true")
        .h(
            "cache-control",
            if now_mode { "no-store".into() } else { CACHEABLE.to_string() },
        );
    if let Some(etag) = etag {
        b = b.h("etag", etag);
    }
    if t.closed {
        b = b.hs(H_CLOSED, "true");
    }
    b.body(body)
}

async fn handle_long_poll(
    st: Arc<StreamState>,
    offset: ParsedOffset,
    client_cursor: Option<u64>,
    cache_hit: &mut bool,
) -> Resp {
    let t0 = st.tail();
    let from = match offset {
        ParsedOffset::Start => 0,
        ParsedOffset::Now => t0.bytes,
        ParsedOffset::At(b) => {
            if b > t0.bytes {
                return text_response(400, "offset beyond tail");
            }
            b
        }
    };
    let cursor = compute_cursor(client_cursor);

    // Existing data → return immediately. This is a backlog (the consumer was
    // behind the tail), so it may include cold historical bytes: not hot.
    if from < t0.bytes {
        return long_poll_data(&st, from, t0, client_cursor, false, cache_hit).await;
    }
    if t0.closed {
        return long_poll_close(t0.bytes, cursor);
    }

    // Wait for new data / closure / timeout.
    let mut rx = st.tail_tx.subscribe();
    let deadline = Instant::now() + long_poll_timeout_dur();
    loop {
        let t = *rx.borrow_and_update();
        if t.bytes > from {
            // Caught-up consumer woken by new appends: freshly-written, hot.
            return long_poll_data(&st, from, t, client_cursor, true, cache_hit).await;
        }
        if t.closed {
            return long_poll_close(t.bytes, cursor);
        }
        tokio::select! {
            r = rx.changed() => {
                if r.is_err() {
                    let t = st.tail();
                    if t.bytes > from {
                        return long_poll_data(&st, from, t, client_cursor, true, cache_hit).await;
                    }
                    return long_poll_timeout(t.bytes, cursor, t.closed);
                }
            }
            _ = tokio::time::sleep_until(tokio::time::Instant::now() + deadline.saturating_duration_since(Instant::now())) => {
                let t = st.tail();
                return long_poll_timeout(t.bytes, cursor, t.closed);
            }
        }
    }
}

async fn long_poll_data(
    st: &Arc<StreamState>,
    from: u64,
    t: Tail,
    client_cursor: Option<u64>,
    hot: bool,
    cache_hit: &mut bool,
) -> Resp {
    let cursor = compute_cursor(client_cursor);
    let body = read_range_body(st, from, t.bytes, hot, "long-poll", cache_hit).await;
    let mut b = ResponseBuilder::new(200)
        .h("content-type", st.config.content_type.clone())
        .h(H_NEXT_OFFSET, format_offset(t.bytes))
        .h(H_CURSOR, cursor.to_string())
        .h("etag", st.etag(from, t.bytes, t.closed))
        .hs(H_UP_TO_DATE, "true")
        .hs("cache-control", CACHEABLE);
    if t.closed {
        b = b.hs(H_CLOSED, "true");
    }
    b.body(body)
}

fn long_poll_close(tail: u64, cursor: u64) -> Resp {
    ResponseBuilder::new(204)
        .h(H_NEXT_OFFSET, format_offset(tail))
        .h(H_CURSOR, cursor.to_string())
        .hs(H_UP_TO_DATE, "true")
        .hs(H_CLOSED, "true")
        .hs("cache-control", "no-store")
        .body(empty())
}

fn long_poll_timeout(tail: u64, cursor: u64, closed: bool) -> Resp {
    let mut b = ResponseBuilder::new(204)
        .h(H_NEXT_OFFSET, format_offset(tail))
        .h(H_CURSOR, cursor.to_string())
        .hs(H_UP_TO_DATE, "true")
        .hs("cache-control", "no-store");
    if closed {
        b = b.hs(H_CLOSED, "true");
    }
    b.body(empty())
}

// ---------- SSE ----------

enum SseEncoding {
    Json,
    Text,
    Base64,
}

fn sse_encoding(st: &StreamState) -> SseEncoding {
    if st.is_json {
        SseEncoding::Json
    } else if media_type(&st.config.content_type).starts_with("text/") {
        SseEncoding::Text
    } else {
        SseEncoding::Base64
    }
}

/// Write `payload` as one SSE `data` event, splitting on line terminators to
/// prevent `data:` injection.
fn sse_data_event(out: &mut String, payload: &str) {
    out.push_str("event: data\n");
    for line in payload.split(['\n', '\r']) {
        out.push_str("data:");
        out.push_str(line);
        out.push('\n');
    }
    out.push('\n');
}

fn sse_control_event(out: &mut String, next: u64, cursor: u64, up_to_date: bool, closed: bool) {
    out.push_str("event: control\n");
    out.push_str("data:{\"streamNextOffset\":\"");
    out.push_str(&format_offset(next));
    out.push('"');
    if !closed {
        out.push_str(",\"streamCursor\":\"");
        out.push_str(&cursor.to_string());
        out.push('"');
    }
    if up_to_date {
        out.push_str(",\"upToDate\":true");
    }
    if closed {
        out.push_str(",\"streamClosed\":true");
    }
    out.push_str("}\n\n");
}

async fn handle_sse(st: Arc<StreamState>, offset: ParsedOffset, client_cursor: Option<u64>) -> Resp {
    let t0 = st.tail();
    let start = match offset {
        ParsedOffset::Start => 0,
        ParsedOffset::Now => t0.bytes,
        ParsedOffset::At(b) => {
            if b > t0.bytes {
                return text_response(400, "offset beyond tail");
            }
            b
        }
    };
    let encoding = sse_encoding(&st);
    let is_b64 = matches!(encoding, SseEncoding::Base64);

    let (tx, rx) = mpsc::channel::<Bytes>(8);
    let stc = st.clone();
    // Propagate the request span into the detached producer task so its emitted
    // read events stay parented to the originating `ds.request` span. We attach
    // via `.instrument` rather than holding an `Entered` guard, which must never
    // be held across an `.await`.
    let sse_span = tracing::Span::current();
    tokio::spawn(
        async move {
        let st = stc;
        let mut pos = start;
        let mut rxw = st.tail_tx.subscribe();
        let deadline = Instant::now() + SSE_MAX_DURATION;
        loop {
            let t = *rxw.borrow_and_update();
            if t.bytes > pos {
                // Read new range and emit data + control. Caught-up subscribers
                // share the resident tail chunk — one read for all of them —
                // and fall back to a file read only when behind it.
                let read_t0 = crate::telemetry::Timer::start();
                let cache_hit;
                let data = match st.tail_chunk_slice(pos, t.bytes) {
                    Some(b) => {
                        cache_hit = true;
                        b
                    }
                    None => {
                        cache_hit = false;
                        match read_range_bytes(&st, pos, t.bytes).await {
                            Ok(d) => d,
                            // End the stream without advancing `pos`: the client
                            // reconnects from its last offset, never skipping a gap.
                            Err(_) => return,
                        }
                    }
                };
                crate::telemetry::record_tail_cache(cache_hit, "sse");
                crate::telemetry::record_read(read_t0.elapsed_secs(), "sse", cache_hit);
                let mut ev = String::new();
                match sse_encoding(&st) {
                    SseEncoding::Json => {
                        // wire bytes end with ','; wrap as array
                        let inner = &data[..data.len().saturating_sub(1)];
                        let mut payload = String::with_capacity(inner.len() + 2);
                        payload.push('[');
                        payload.push_str(&String::from_utf8_lossy(inner));
                        payload.push(']');
                        sse_data_event(&mut ev, &payload);
                    }
                    SseEncoding::Text => {
                        sse_data_event(&mut ev, &String::from_utf8_lossy(&data));
                    }
                    SseEncoding::Base64 => {
                        sse_data_event(
                            &mut ev,
                            &crate::api::base64_encode(&data, crate::api::BASE64_STD, true),
                        );
                    }
                }
                pos = t.bytes;
                let up_to_date = pos >= st.tail().bytes;
                // If the stream closed atomically with this final data, fold the
                // close into this control event (streamClosed:true) rather than
                // emitting a plain up-to-date control followed by a separate close
                // event — the reference server / TS client expect the close signal
                // on the control immediately after the final data.
                let closed_now = t.closed && pos >= t.bytes;
                sse_control_event(
                    &mut ev,
                    pos,
                    compute_cursor(client_cursor),
                    up_to_date,
                    closed_now,
                );
                if tx.send(Bytes::from(ev)).await.is_err() {
                    return;
                }
                if closed_now {
                    return;
                }
            }
            if t.closed && pos >= t.bytes {
                let mut ev = String::new();
                sse_control_event(&mut ev, pos, compute_cursor(client_cursor), true, true);
                let _ = tx.send(Bytes::from(ev)).await;
                return;
            }
            if t.bytes > pos {
                continue;
            }
            // Initial control event when starting caught-up.
            if pos == start && t.bytes == start && !t.closed && pos == st.tail().bytes {
                let mut ev = String::new();
                sse_control_event(&mut ev, pos, compute_cursor(client_cursor), true, false);
                if tx.send(Bytes::from(ev)).await.is_err() {
                    return;
                }
            }
            tokio::select! {
                r = rxw.changed() => {
                    if r.is_err() {
                        return;
                    }
                }
                _ = tokio::time::sleep_until(tokio::time::Instant::now() + deadline.saturating_duration_since(Instant::now())) => {
                    return; // close connection; client reconnects
                }
            }
        }
        }
        .instrument(sse_span),
    );

    let mut b = ResponseBuilder::new(200)
        .hs("content-type", "text/event-stream")
        .hs("cache-control", "no-cache")
        .hs("connection", "keep-alive");
    if is_b64 {
        b = b.hs(H_SSE_ENCODING, "base64");
    }
    // SSE is a live feed: a mid-stream hiccup just ends the event stream and the
    // client reconnects from its last offset, so there is no abort signal here.
    b.body(Body::Channel(crate::api::StreamBody::infallible(rx)))
}

/// Read a logical byte range fully into memory (SSE batches are small).
/// Returns `Err` if the range could not be fully materialized (a short local
/// read or a cold-storage error/truncation) so callers never advance past a gap.
async fn read_range_bytes(
    st: &Arc<StreamState>,
    start: u64,
    end: u64,
) -> std::io::Result<Bytes> {
    let want = end.saturating_sub(start) as usize;
    let mut slices = Vec::new();
    crate::store::resolve_range(st, start, end, &mut slices);
    let out = match crate::store::into_local_segments(slices) {
        // Local-only fast path (always the case with tiering off): one blocking
        // read across all local segments.
        Ok(segs) => tokio::task::spawn_blocking(move || materialize_segments(&segs))
            .await
            .unwrap_or_default(),
        Err(slices) => materialize_resolved(st, slices, b"", b"").await?,
    };
    if out.len() != want {
        return Err(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "short read while materializing range",
        ));
    }
    Ok(out)
}

// ---------- HEAD ----------

fn handle_head(store: Arc<Store>, path: String) -> Resp {
    let st = match store.get(&path) {
        Some(s) => s,
        None => return text_response(404, "stream not found"),
    };
    if st.shared.read().unwrap().soft_deleted {
        return gone();
    }
    // HEAD must not reset the TTL.
    let t = st.tail();
    let mut b = ResponseBuilder::new(200)
        .h("content-type", st.config.content_type.clone())
        .h(H_NEXT_OFFSET, format_offset(t.bytes))
        .hs("cache-control", "no-store");
    if let Some(ttl) = st.config.ttl_seconds {
        b = b.h(H_TTL, ttl.to_string());
    }
    if let Some(raw) = &st.config.expires_at_raw {
        b = b.h(H_EXPIRES_AT, raw.clone());
    }
    if t.closed {
        b = b.hs(H_CLOSED, "true");
    }
    b.body(empty())
}

// ---------- DELETE ----------

fn handle_delete(store: Arc<Store>, path: String) -> Resp {
    let st = match store.get(&path) {
        Some(s) => s,
        None => return text_response(404, "stream not found"),
    };
    if st.shared.read().unwrap().soft_deleted {
        return gone();
    }
    store.delete_or_soft_delete(&st);
    ResponseBuilder::new(204).body(empty())
}

#[cfg(test)]
mod bug1_tests {
    //! Regression for BUG-1: a cold-tier read that errors or returns a truncated
    //! object must set the `StreamBody.failed` abort flag (so engines drop the
    //! connection) instead of completing a clean-but-short chunked 200 — which
    //! would let a client resume past `stream-next-offset` and silently skip the
    //! gap. Found by the madsim DST harness.
    use super::*;
    use crate::blobstore::{BlobStore, BoxFuture};
    use crate::store::{CreateResult, ResolvedSlice, Store, StreamConfig};
    use crate::tier::TierConfig;
    use std::sync::atomic::Ordering;
    use std::sync::Arc;

    #[derive(Clone, Copy)]
    enum Mode {
        Full,
        Truncate,
        Error,
    }

    struct TestBlob(Mode);
    impl BlobStore for TestBlob {
        fn put<'a>(&'a self, _k: &'a str, _b: bytes::Bytes) -> BoxFuture<'a, std::io::Result<()>> {
            Box::pin(async { Ok(()) })
        }
        fn get_range<'a>(
            &'a self,
            _k: &'a str,
            _s: u64,
            len: u64,
        ) -> BoxFuture<'a, std::io::Result<bytes::Bytes>> {
            let mode = self.0;
            Box::pin(async move {
                match mode {
                    Mode::Full => Ok(bytes::Bytes::from(vec![b'x'; len as usize])),
                    // one byte short of the requested length
                    Mode::Truncate => Ok(bytes::Bytes::from(vec![b'x'; len.saturating_sub(1) as usize])),
                    Mode::Error => Err(std::io::Error::other("cold backend boom")),
                }
            })
        }
        fn head<'a>(&'a self, _k: &'a str) -> BoxFuture<'a, std::io::Result<Option<u64>>> {
            Box::pin(async { Ok(None) })
        }
        fn delete<'a>(&'a self, _k: &'a str) -> BoxFuture<'a, std::io::Result<()>> {
            Box::pin(async { Ok(()) })
        }
    }

    fn stream_cfg() -> StreamConfig {
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

    /// Drive `stream_resolved_body` over a single 100-byte Remote slice backed by
    /// a `TestBlob` in `mode`; return (bytes delivered, failed-flag).
    async fn run(mode: Mode) -> (usize, bool) {
        let dir = std::env::temp_dir().join(format!(
            "ds-bug1-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let mut store = Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap();
        store.blobstore = Some(Arc::new(TestBlob(mode)));
        let store = Arc::new(store);
        let st = match store.create("s", stream_cfg(), None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };
        let slices = vec![ResolvedSlice::Remote {
            key: "k".into(),
            offset: 0,
            len: 100,
        }];
        let body = stream_resolved_body(&st, slices, b"", b"");
        let (n, failed) = match body {
            Body::Channel(sb) => {
                let mut rx = sb.rx;
                let mut n = 0usize;
                while let Some(b) = rx.recv().await {
                    n += b.len();
                }
                (n, sb.failed.load(Ordering::Acquire))
            }
            _ => panic!("expected a channel body"),
        };
        let _ = std::fs::remove_dir_all(&dir);
        (n, failed)
    }

    #[tokio::test]
    async fn cold_read_full_is_not_flagged() {
        let (n, failed) = run(Mode::Full).await;
        assert!(!failed, "a full-length cold read must not be flagged failed");
        assert_eq!(n, 100, "the full body is delivered");
    }

    #[tokio::test]
    async fn cold_read_truncated_aborts() {
        let (_n, failed) = run(Mode::Truncate).await;
        assert!(failed, "a truncated cold read must set the abort flag (BUG-1)");
    }

    #[tokio::test]
    async fn cold_read_error_aborts() {
        let (_n, failed) = run(Mode::Error).await;
        assert!(failed, "a cold-read backend error must set the abort flag (BUG-1)");
    }

    /// H4: the buffered cold-read path (`materialize_resolved` via
    /// `read_range_bytes`, used by SSE and fork sub-offset) must surface a
    /// truncated/errored cold read as `Err` — not silently return short bytes
    /// that a caller would treat as a complete (advanced) read.
    async fn run_buffered(mode: Mode) -> std::io::Result<bytes::Bytes> {
        let dir = std::env::temp_dir().join(format!(
            "ds-h4-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let mut store = Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap();
        store.blobstore = Some(Arc::new(TestBlob(mode)));
        let store = Arc::new(store);
        let st = match store.create("s", stream_cfg(), None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };
        let slices = vec![ResolvedSlice::Remote {
            key: "k".into(),
            offset: 0,
            len: 100,
        }];
        let res = materialize_resolved(&st, slices, b"", b"").await;
        let _ = std::fs::remove_dir_all(&dir);
        res
    }

    #[tokio::test]
    async fn buffered_cold_read_full_ok() {
        let r = run_buffered(Mode::Full).await;
        assert_eq!(r.unwrap().len(), 100, "a full cold read returns the bytes");
    }

    #[tokio::test]
    async fn buffered_cold_read_truncated_errors() {
        assert!(
            run_buffered(Mode::Truncate).await.is_err(),
            "a truncated cold object must surface as Err (H4)"
        );
    }

    #[tokio::test]
    async fn buffered_cold_read_backend_error_errors() {
        assert!(
            run_buffered(Mode::Error).await.is_err(),
            "a cold-read backend error must surface as Err (H4)"
        );
    }
}

#[cfg(test)]
mod memory_mode_tests {
    //! Tests for `--durability memory` mode: append acks with no WAL attached.
    use super::*;
    use crate::api::{Method, Req};
    use crate::store::Store;
    use crate::tier::TierConfig;
    use bytes::Bytes;

    fn tmp(tag: &str) -> std::path::PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let p = std::env::temp_dir().join(format!(
            "ds-mem-{tag}-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    fn put_req(path: &str, content_type: &str) -> Req {
        Req {
            method: Method::Put,
            path: path.to_string(),
            query: None,
            headers: vec![("content-type".to_string(), content_type.to_string())],
            body: Bytes::new(),
        }
    }

    fn post_req(path: &str, content_type: &str, body: &[u8]) -> Req {
        Req {
            method: Method::Post,
            path: path.to_string(),
            query: None,
            headers: vec![("content-type".to_string(), content_type.to_string())],
            body: Bytes::copy_from_slice(body),
        }
    }

    #[tokio::test]
    async fn memory_mode_append_acks_without_wal() {
        let _guard = crate::handlers::test_support::DurabilityGuard::memory();
        let dir = tmp("mem-append");
        let store = Arc::new(
            Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap(),
        );
        // NOTE: no WAL attached (store.wal not set) — memory mode must not touch it.

        // Create the stream (PUT).
        let resp = handle(Arc::clone(&store), put_req("m/s", "application/octet-stream")).await;
        assert!(
            (200..300).contains(&resp.status),
            "create stream expected 2xx, got {}",
            resp.status
        );

        // Append a record (POST) — must ack without WAL.
        let resp = handle(
            Arc::clone(&store),
            post_req("m/s", "application/octet-stream", b"hello-memory"),
        )
        .await;
        assert!(
            (200..300).contains(&resp.status),
            "memory append should ack, got {}",
            resp.status
        );

        // Verify the bytes landed in the per-stream file.
        let st = store.get("m/s").unwrap();
        assert_eq!(
            std::fs::read(&st.file_path).unwrap(),
            b"hello-memory",
            "per-stream file must hold the appended bytes"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}

