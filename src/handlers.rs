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

fn long_poll_timeout_dur() -> Duration {
    Duration::from_millis(LONG_POLL_TIMEOUT_MS.load(std::sync::atomic::Ordering::Relaxed))
}

/// Durability mode for the append/close hot path. Set once at startup from
/// `--durability`; mirrors the `set_splice_appends` / `set_read_offload` flag pattern.
///
/// - `Strict` (default): ack only after the covering `fdatasync`
///   (`SyncCoalescer::sync_to`).
/// - `Wal`: the per-stream file write (page cache) is the read view as today, then
///   the bytes are staged into the sharded WAL and the ack waits on the WAL shard's
///   group-commit `fdatasync` instead of a per-stream one.
/// - `Fast`: ack on the page-cache write, skipping the hot-path `fdatasync` —
///   durability then comes from S3-offload (cold) + future replication (hot tail).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DurabilityMode {
    Strict,
    Wal,
    Fast,
}

/// Process-global durability mode, encoded as a `u8` (`Strict` is the zero default so
/// an unset flag is strict). Same single-`AtomicU8` choke-point pattern the bool used.
static DURABILITY_MODE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

impl Default for DurabilityMode {
    /// `strict` is the default mode (an unset `--durability` flag).
    fn default() -> Self {
        DurabilityMode::Strict
    }
}

/// Parse the `--durability` flag value into a [`DurabilityMode`]. `relaxed` is the
/// legacy spelling of `fast` (kept as an alias so existing deploys don't break).
/// Returns `None` for an unknown value — the caller maps that to a usage error.
pub fn parse_durability(s: &str) -> Option<DurabilityMode> {
    match s {
        "strict" => Some(DurabilityMode::Strict),
        "fast" | "relaxed" => Some(DurabilityMode::Fast),
        "wal" => Some(DurabilityMode::Wal),
        _ => None,
    }
}

pub fn set_durability(mode: DurabilityMode) {
    let v = match mode {
        DurabilityMode::Strict => 0,
        DurabilityMode::Wal => 1,
        DurabilityMode::Fast => 2,
    };
    DURABILITY_MODE.store(v, std::sync::atomic::Ordering::Relaxed);
}

pub fn durability() -> DurabilityMode {
    match DURABILITY_MODE.load(std::sync::atomic::Ordering::Relaxed) {
        1 => DurabilityMode::Wal,
        2 => DurabilityMode::Fast,
        _ => DurabilityMode::Strict,
    }
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
                let file = ap.file.clone();
                let mode = durability();
                // Logical pre-append offset for THIS append — needed ONLY by the Wal
                // arm. Read `file_base` (under the appender lock so a concurrent
                // compaction that raises `file_base` + resets `ap.written` together
                // can't desync it from `target`) ONLY in Wal mode. Strict/Fast take
                // NO `st.shared` lock here — byte-for-byte the pre-WAL hot path.
                let stream_offset = wal_stream_offset(mode, &st, target, &wire);
                drop(ap);
                if maybe_sync_on_ack(mode, &store, &st, &wire, file, target, stream_offset)
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

/// Gate the ack's durability on the durability mode. Every append/close `sync_to`
/// site routes through this one helper so all three modes are decided in one place.
///
/// - `Strict`: await the covering per-stream `fdatasync` (`sync_to`), exactly as before.
/// - `Fast`: return `Ok` without syncing — the ack happens on the page-cache write.
/// - `Wal`: the per-stream file write already happened upstream (the read view); stage
///   the wire bytes into the stream's WAL shard and await the shard's group-commit
///   `fdatasync`. `stream_offset` is `Some(logical pre-append offset)` for THIS append
///   (`file_base + file-relative pre-append position`), computed by the caller via
///   [`wal_stream_offset`] from the SAME append context as `target` (under the appender
///   lock) so a concurrent compaction/appender can't desync it. Recovery does
///   `file_pos = stream_offset − file_base`, so for forked/compacted streams
///   (`file_base > 0`) this MUST be logical, not the file-relative `target`.
///
/// `Strict`/`Fast` ignore `store`/`wire`/`stream_offset` and pass `stream_offset:
/// None` (they never take the `st.shared` read lock), so those paths stay
/// byte-for-byte unchanged from the pre-WAL base.
/// Compute the **logical** pre-append `stream_offset` for the WAL record — but
/// ONLY in `Wal` mode. In `Strict`/`Fast` this returns `None` WITHOUT touching
/// `st.shared`, so the default (strict) and fast hot paths acquire exactly the
/// locks the pre-WAL base did (no extra `st.shared.read()` per append).
///
/// MUST be called while the caller still holds the appender lock: `file_base`
/// and `target` (`ap.written`) are reset together under that lock on compaction,
/// so reading `file_base` here keeps it consistent with the captured `target`.
fn wal_stream_offset(
    mode: DurabilityMode,
    st: &StreamState,
    target: u64,
    wire: &Bytes,
) -> Option<u64> {
    match mode {
        DurabilityMode::Wal => {
            Some(st.shared.read().unwrap().file_base + target - wire.len() as u64)
        }
        DurabilityMode::Strict | DurabilityMode::Fast => None,
    }
}

async fn maybe_sync_on_ack(
    mode: DurabilityMode,
    store: &Arc<Store>,
    st: &StreamState,
    wire: &Bytes,
    file: std::sync::Arc<std::fs::File>,
    target: u64,
    stream_offset: Option<u64>,
) -> std::io::Result<()> {
    match mode {
        DurabilityMode::Strict => st.sync.sync_to(file, st, target).await,
        DurabilityMode::Fast => Ok(()),
        DurabilityMode::Wal => {
            let stream_offset = stream_offset
                .expect("wal mode requires a precomputed logical stream_offset");
            let wal = store.wal.get().expect("wal mode requires Store.wal");
            let shard = wal.shard_for(st.id);
            // Register the touched per-stream file into the shard's dirty set
            // (spec §7) BEFORE staging the WAL record. This MUST precede
            // `reserve_and_stage`: once a record is staged, the committer can
            // advance `durable_lsn` to cover its lsn at any moment, and a
            // concurrent checkpoint snapping its floor there would
            // `recycle_below` the segment carrying that lsn. If the stream were
            // not yet in the dirty set, that checkpoint would unlink the WAL
            // segment WITHOUT having `fdatasync`'d the stream's per-stream file
            // → recycle-before-fsync data loss (spec §7 forbids this).
            // Registering first closes that window: the stream is dirty before
            // its lsn can ever become durable, so any checkpoint whose floor
            // covers the lsn fdatasyncs this stream's file before recycling. The
            // per-stream bytes are already in page cache (`write_wire` ran
            // upstream), so registering before staging is safe. We hold its
            // `Arc<File>`; the WAL stays ignorant of `StreamState`. Off the ack
            // gate — checkpoint runs asynchronously and never blocks the ack.
            shard.register_dirty(st.id, file);
            // A transient WAL segment write error fails the ack (the request
            // errors) rather than crashing the process — matching the committer's
            // fail-loud-don't-ack discipline. The lsn was reserved but never
            // written, so it stays a permanent gap that blocks the contiguous
            // watermark, and durable_lsn never advances past it.
            let lsn = shard.reserve_and_stage(
                crate::wal::codec::RecordKind::Append,
                st.id,
                stream_offset,
                wire,
            )?;
            shard.wait_durable(lsn).await;
            Ok(())
        }
    }
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
            // NOTE (relaxed): this guarantees the *closedness* never rolls back
            // (the close-meta stays durable in both modes), but under `relaxed`
            // the closed *position* can: the data fdatasync below is skipped, so an
            // OS/power crash can lose the un-synced tail and recover a shorter
            // closed stream (tail = on-disk size < the acked tail). A reader that
            // saw EOF at the longer tail then faces a shorter closed stream. This
            // is within relaxed's stated contract (lose the un-sealed hot tail on an
            // OS/power crash; a closed stream is just hot tail ending in a close).
            // The strong PROTOCOL.md §4.1 position-monotonicity guarantee is
            // strict-only.
            s.closed = true;
            if let Some(p) = &producer {
                s.closed_by = Some((p.id.clone(), p.epoch, p.seq));
            }
        }
    }
    let target = ap.written;
    let file = ap.file.clone();
    let mode = durability();
    // Logical pre-append offset for THIS append (see site above) — Wal-only; read
    // `file_base` under the appender lock so a concurrent compaction can't desync
    // it from `target`. Strict/Fast take no `st.shared` lock here.
    let stream_offset = wal_stream_offset(mode, &st, target, &wire);
    drop(ap);

    // Covering fsync failed: not durable. Error out (and skip the close commit
    // below) rather than ack 2xx.
    if !wire.is_empty()
        && maybe_sync_on_ack(mode, &store, &st, &wire, file, target, stream_offset)
            .await
            .is_err()
    {
        ret!(text_response(500, "fsync failed"), Conflict);
    }

    // Closure ordering: data fdatasync (above, strict-only) → durable meta commit →
    // expose the closure to readers (closed_durable) and wake waiters. Readers never
    // observe EOF for a closure that is not yet durable (PROTOCOL.md §4.1). Under
    // `strict` the recovered closed tail also never moves backward; under `relaxed`
    // the data fdatasync is skipped, so the *closedness* is still durable but its
    // *position* can shrink on an OS/power crash (see the close-req note above).
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

// ---------- POST (binary append, splice fast path) ----------
//
// The raw engine owns the request socket fd, so for a BINARY stream (on-disk
// bytes == socket bytes, no JSON transform) it can move the request body
// socket → pipe → file entirely in the kernel via splice(2) — no
// socket→userspace→file copy. JSON streams transform the body (flatten + `,`),
// so the on-disk bytes differ from the socket bytes and splice is impossible.
//
// The engine doesn't know whether a stream is JSON (the store does), and the
// per-stream appender lock plus producer dedup must be held across the splice,
// so the whole flow lives here. The engine supplies a `splice_body` callback
// that, holding the socket, writes any already-buffered body bytes to `file` at
// `offset` and then splices the remaining `content_length - prebuffered.len()`
// bytes from the socket into `file`. It must consume exactly `content_length`
// body bytes from the socket so keep-alive/pipelining stays correct.

/// Outcome of attempting the binary-append fast path. Linux-only: splice(2)
/// exists only there, so the raw engine only calls this path on Linux.
#[cfg(target_os = "linux")]
pub enum BeginResult<R> {
    /// Splice ran and the append committed; serve this response.
    Done(Resp),
    /// Not eligible for splice (JSON stream, missing/duplicate, validation
    /// that needs the body, etc.). The engine reads the body normally and calls
    /// `handlers::handle`. The reason the request was not consumed: nothing has
    /// been read from the socket body yet, so the normal path is fully valid.
    Fallback(R),
    /// A definitive rejection decided before reading the body (e.g. 409 closed,
    /// producer conflict, content-type mismatch). The engine sends this and,
    /// because the body was NOT consumed, must close the connection.
    Reject(Resp),
}

/// Parameters the engine passes describing the in-flight POST.
#[cfg(target_os = "linux")]
pub struct BinaryAppendReq {
    pub content_length: u64,
    /// Lowercased request headers (producer/seq/content-type/stream-closed).
    pub headers: Vec<(String, String)>,
}

#[cfg(target_os = "linux")]
impl BinaryAppendReq {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
    fn header_is_true(&self, name: &str) -> bool {
        self.header(name)
            .map(|v| v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    }
}

/// Drive the binary-append fast path for one POST. `splice_body(file, offset)`
/// writes prebuffered body bytes then splices the rest of `content_length` from
/// the socket into `file` at `offset`; it is invoked exactly once, while the
/// appender lock is held, and must consume exactly `content_length` body bytes.
///
/// Returns `Done` (committed), `Fallback(marker)` (engine reads body normally),
/// or `Reject` (definitive error decided before touching the body).
///
/// Eligibility checks here intentionally mirror `handle_append_inner`'s precedence
/// (deleted → content-type → closed → producer dedup → seq) so the response is
/// byte-for-byte the same as the normal path would have produced.
#[cfg(target_os = "linux")]
pub async fn try_binary_append_splice<R, F, Fut>(
    store: Arc<Store>,
    path: String,
    req: BinaryAppendReq,
    fallback_marker: R,
    splice_body: F,
) -> BeginResult<R>
where
    F: FnOnce(std::path::PathBuf, u64) -> Fut,
    Fut: std::future::Future<Output = std::io::Result<()>>,
{
    use BeginResult::*;
    let t0 = crate::telemetry::Timer::start();

    // Stream must exist and be a non-JSON (binary) stream for splice to apply.
    let st = match store.get(&path) {
        Some(s) => s,
        None => return Fallback(fallback_marker),
    };
    if st.is_json {
        return Fallback(fallback_marker);
    }
    // An empty body or a close request goes through the normal path (close is
    // rare and needs the full closed-handling machinery). content_length 0 also
    // means "empty append" → normal path returns the right 400/204.
    let close_req = req.header_is_true(H_CLOSED);
    if req.content_length == 0 || close_req {
        return Fallback(fallback_marker);
    }
    // The splice fast path moves bytes socket→file in the kernel, so the body never
    // enters userspace. WAL mode must stage those bytes into the WAL, which requires
    // the wire buffer in userspace; fall back to the normal append path (which has
    // `wire`) when WAL is selected. `strict`/`fast` are unaffected.
    if matches!(durability(), DurabilityMode::Wal) {
        return Fallback(fallback_marker);
    }
    if req.content_length as usize > crate::api::MAX_BODY_BYTES {
        // Match the engine's normal 413 (body not consumed → connection closes).
        return Reject(
            ResponseBuilder::new(413)
                .hs("content-type", "text/plain")
                .body(full("payload too large")),
        );
    }

    if st.shared.read().unwrap().soft_deleted {
        return Reject(gone());
    }

    // Content-Type must be present and match (binary streams require it for a
    // non-empty body). Closed has precedence over a content-type mismatch.
    let req_ct = req.header("content-type");
    match req_ct {
        None => return Reject(text_response(400, "missing Content-Type")),
        Some(ct) => {
            if media_type(ct) != media_type(&st.config.content_type) {
                let t = st.tail();
                if t.closed {
                    return Reject(closed_conflict(t.bytes));
                }
                return Reject(text_response(409, "content-type mismatch"));
            }
        }
    }

    let producer = match parse_producer_headers_h(&req) {
        Ok(p) => p,
        Err(m) => return Reject(text_response(400, m)),
    };
    let seq_header = req.header(H_SEQ).map(|s| s.to_string());

    // Acquire the per-stream appender lock for the whole begin→splice→commit
    // critical section, exactly like the normal append path.
    let lock_t0 = crate::telemetry::Timer::start();
    let mut ap = st.appender.lock().await;
    crate::telemetry::record_append_lock_wait(lock_t0.elapsed_secs());

    // Closed check (a non-close append to a closed stream is a 409).
    {
        let s = st.shared.read().unwrap();
        if s.closed {
            let tail = s.tail;
            drop(s);
            return Reject(closed_conflict(tail));
        }
    }

    // Producer dedup / sequencing. A duplicate or conflict is answered WITHOUT
    // reading the body — but the body is still on the socket, so these are
    // Reject (connection closes) rather than Done; the client reconnects.
    if let Some(p) = &producer {
        let outcome = {
            let s = st.shared.read().unwrap();
            validate_producer(&s, p)
        };
        match outcome {
            ProducerOutcome::Accept => {}
            ProducerOutcome::Duplicate { last_seq } => {
                let tail = st.shared.read().unwrap().tail;
                return Reject(
                    ResponseBuilder::new(204)
                        .h(H_NEXT_OFFSET, format_offset(tail))
                        .h(H_PRODUCER_EPOCH, p.epoch.to_string())
                        .h(H_PRODUCER_SEQ, last_seq.to_string())
                        .body(empty()),
                );
            }
            ProducerOutcome::StaleEpoch { current } => {
                return Reject(
                    ResponseBuilder::new(403)
                        .h(H_PRODUCER_EPOCH, current.to_string())
                        .body(full("stale producer epoch")),
                );
            }
            ProducerOutcome::Gap { expected } => {
                return Reject(
                    ResponseBuilder::new(409)
                        .h(H_PRODUCER_EXPECTED, expected.to_string())
                        .h(H_PRODUCER_RECEIVED, p.seq.to_string())
                        .body(full("producer sequence gap")),
                );
            }
            ProducerOutcome::BadEpochStart => {
                return Reject(text_response(
                    400,
                    "new producer epoch must start at seq 0",
                ));
            }
        }
    }
    if let Some(seq) = &seq_header {
        let s = st.shared.read().unwrap();
        if let Some(last) = &s.last_seq_header {
            if seq.as_str() <= last.as_str() {
                let tail = s.tail;
                drop(s);
                return Reject(
                    ResponseBuilder::new(409)
                        .h(H_NEXT_OFFSET, format_offset(tail))
                        .body(full("Sequence conflict")),
                );
            }
        }
    }

    // ---- splice the body socket → file at the appender's current offset ----
    // The shared data fd is O_APPEND, but splice(2) refuses an O_APPEND target
    // (EINVAL). The engine therefore opens a fresh O_WRONLY fd to the file and
    // splices with an explicit offset; we pass it the path + the exact write
    // offset (safe: the appender lock serializes writers).
    let file = ap.file.clone();
    let offset = ap.written;
    let n = req.content_length;
    if let Err(_e) = splice_body(st.file_path.clone(), offset).await {
        // The socket / pipe / file write failed mid-splice. The file may now
        // hold a partial body. Recover by truncating back to the pre-append
        // length so the contiguous-wire invariant (tail == file size) holds and
        // the stream stays consistent; then surface a 500. The connection is
        // closed by the engine (body framing is now indeterminate).
        let _ = file.set_len(offset);
        return Reject(text_response(500, "write failed"));
    }

    // ---- commit: advance tail, invalidate cache, publish, group-commit fsync ----
    ap.written += n;
    let tail;
    {
        let mut s = st.shared.write().unwrap();
        tail = s.file_base + ap.written;
        s.tail = tail;
        s.last_access = SystemTime::now();
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
    }
    // The spliced bytes never entered userspace, so they can't populate the
    // resident tail-chunk cache. Clear any stale entry covering this range so a
    // caught-up reader falls through to a file read (sendfile) instead of being
    // served wrong bytes.
    st.set_last_chunk(tail, Bytes::new());
    let closed = st.shared.read().unwrap().closed_durable;
    st.tail_tx.send_replace(Tail { bytes: tail, closed });

    let target = ap.written;
    drop(ap);
    // WAL mode is excluded above (splice bypasses userspace), so this site only ever
    // runs `Strict`/`Fast`, which ignore the `wire`/`stream_offset` arguments — pass an
    // empty wire and `None` (no WAL record is ever recorded here).
    if maybe_sync_on_ack(durability(), &store, &st, &Bytes::new(), file, target, None)
        .await
        .is_err()
    {
        // Not durable. Body was fully consumed, so keep-alive framing is intact.
        return Done(text_response(500, "fsync failed"));
    }
    st.schedule_meta_flush();
    maybe_seal_bg(&store, &st);

    crate::telemetry::record_append(t0.elapsed_secs(), "accept", false);

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
    Done(b.body(empty()))
}

/// Producer-header parse over a `BinaryAppendReq` (mirrors `parse_producer_headers`).
#[cfg(target_os = "linux")]
fn parse_producer_headers_h(req: &BinaryAppendReq) -> Result<Option<ProducerHeaders>, &'static str> {
    let id = req.header(H_PRODUCER_ID);
    let epoch = req.header(H_PRODUCER_EPOCH);
    let seq = req.header(H_PRODUCER_SEQ);
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
                            materialize_segments(&[win], b"", b"")
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
                    crate::store::materialize_segments(&[seg], b"", b"")
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
        Ok(segs) => tokio::task::spawn_blocking(move || materialize_segments(&segs, b"", b""))
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
mod durability_tests {
    use super::*;

    #[test]
    fn durability_flag_defaults_strict_and_flips() {
        // Default mode is Strict (an unset --durability flag).
        assert_eq!(DurabilityMode::default(), DurabilityMode::Strict, "default must be strict");

        // --durability parsing: strict|wal|fast (+ the `relaxed` legacy alias).
        assert_eq!(parse_durability("strict"), Some(DurabilityMode::Strict));
        assert_eq!(parse_durability("wal"), Some(DurabilityMode::Wal));
        assert_eq!(parse_durability("fast"), Some(DurabilityMode::Fast));
        assert_eq!(
            parse_durability("relaxed"),
            Some(DurabilityMode::Fast),
            "`relaxed` is the legacy alias of `fast`"
        );
        assert_eq!(parse_durability("bogus"), None, "unknown value → usage error");

        // --wal-shards parses to an Option<usize> (the `requested_n` passed to
        // WalSet::open). An absent flag is `None` (→ persisted N or default_n at
        // init); a present flag is `Some(n)`.
        let parsed: Option<usize> = "4".parse().ok();
        assert_eq!(parsed, Some(4usize), "--wal-shards N parses to Some(N)");
        let absent: Option<usize> = None;
        assert_eq!(absent, None, "an absent --wal-shards defaults to None");

        // Process-global flag round-trips through set/get. Reset at the end so no
        // append-path test (which reads it) is perturbed.
        set_durability(DurabilityMode::Wal);
        assert_eq!(durability(), DurabilityMode::Wal, "set_durability(Wal) takes effect");
        set_durability(DurabilityMode::Fast);
        assert_eq!(durability(), DurabilityMode::Fast, "set_durability(Fast) takes effect");
        set_durability(DurabilityMode::Strict); // reset
        assert_eq!(durability(), DurabilityMode::Strict);
    }

    #[tokio::test]
    async fn maybe_sync_on_ack_strict_syncs_relaxed_skips() {
        use crate::store::{CreateResult, Store, StreamConfig};
        use crate::tier::TierConfig;

        let dir = std::env::temp_dir().join(format!(
            "ds-durab-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let store = std::sync::Arc::new(Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap());
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
        let st = match store.create("s", cfg, None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };

        // Write 10 bytes via the same path the handler uses, then STRICT-sync.
        let mut ap = st.appender.lock().await;
        write_wire(&st, &mut ap, &bytes::Bytes::from_static(b"0123456789")).unwrap();
        let target = ap.written;
        let file = ap.file.clone();
        drop(ap);
        maybe_sync_on_ack(DurabilityMode::Strict, &store, &st, &bytes::Bytes::from_static(b"0123456789"), file, target, None)
            .await
            .unwrap();
        assert_eq!(st.sync.synced(), target, "strict must advance the durable watermark");

        // Append 5 more; RELAXED must skip the fsync → watermark unchanged.
        let mut ap = st.appender.lock().await;
        write_wire(&st, &mut ap, &bytes::Bytes::from_static(b"abcde")).unwrap();
        let target2 = ap.written;
        let file2 = ap.file.clone();
        drop(ap);
        maybe_sync_on_ack(DurabilityMode::Fast, &store, &st, &bytes::Bytes::new(), file2, target2, None)
            .await
            .unwrap();
        assert_eq!(st.sync.synced(), target, "relaxed must skip fsync (watermark unchanged)");
        assert!(target2 > target, "the bytes were still written (tail advanced)");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn wal_mode_acks_after_durable() {
        use crate::store::{CreateResult, Store, StreamConfig};
        use crate::tier::TierConfig;
        use crate::wal::walset::WalSet;

        let dir = std::env::temp_dir().join(format!(
            "ds-wal-mode-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);

        // Store with a 1-shard WalSet attached.
        let wal = WalSet::open(&dir, Some(1), 1).unwrap();
        let store = Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap();
        store.wal.set(std::sync::Arc::clone(&wal)).ok();
        let store = std::sync::Arc::new(store);

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
        let st = match store.create("w", cfg, None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };

        // Write the per-stream file exactly as the handler does.
        let wire = bytes::Bytes::from_static(b"hello-wal");
        let mut ap = st.appender.lock().await;
        write_wire(&st, &mut ap, &wire).unwrap();
        let target = ap.written;
        let file = ap.file.clone();
        drop(ap);

        // The bytes are in the per-stream file IMMEDIATELY (page cache), before ack.
        assert_eq!(
            std::fs::read(&st.file_path).unwrap(),
            wire.as_ref(),
            "per-stream file holds the bytes before the WAL ack"
        );

        // NO committer spawned yet → the shard's durable_lsn cannot advance, so the
        // wal-mode helper must NOT return. Prove the ack is gated.
        set_durability(DurabilityMode::Wal);
        let stream_offset =
            st.shared.read().unwrap().file_base + target - wire.len() as u64;
        let ack = maybe_sync_on_ack(
            DurabilityMode::Wal,
            &store,
            &st,
            &wire,
            std::sync::Arc::clone(&file),
            target,
            Some(stream_offset),
        );
        tokio::pin!(ack);
        tokio::select! {
            biased;
            _ = &mut ack => panic!("wal ack returned before the committer made the append durable"),
            _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {}
        }

        // Now spawn the committer; the staged append becomes durable and the ack resolves.
        wal.spawn_committers();
        tokio::time::timeout(std::time::Duration::from_secs(5), ack)
            .await
            .expect("wal ack must resolve once the committer advances durable_lsn")
            .unwrap();

        // The shard's durable_lsn now covers the single staged append (lsn 1).
        assert!(
            wal.shard_for(st.id).durable_lsn() >= 1,
            "durable_lsn covers the append after ack"
        );

        set_durability(DurabilityMode::Strict); // reset the global
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Regression for the WAL `stream_offset` logical-vs-file-relative bug: a
    /// forked/compacted stream has `file_base > 0`, and the WAL record's
    /// `stream_offset` is defined as the LOGICAL pre-append offset (recovery does
    /// `file_pos = stream_offset − file_base`). The buggy code recorded the
    /// file-relative `target − wire.len()`, which is short by `file_base` and
    /// underflows/mis-positions on recovery. This test seeds `file_base > 0` and
    /// asserts the recorded `stream_offset` is logical, i.e. `stream_offset −
    /// file_base` equals the correct file position (0 for the first append).
    #[tokio::test]
    async fn wal_record_offset_is_logical_for_forked_stream() {
        use crate::store::{CreateResult, Store, StreamConfig};
        use crate::tier::TierConfig;
        use crate::wal::codec::{decode_at, Decoded};
        use crate::wal::walset::WalSet;

        let dir = std::env::temp_dir().join(format!(
            "ds-wal-forked-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);

        // 1-shard WalSet so the record lands in `<dir>/wal/0/1.wal`.
        let wal = WalSet::open(&dir, Some(1), 1).unwrap();
        let store = Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap();
        store.wal.set(std::sync::Arc::clone(&wal)).ok();
        let store = std::sync::Arc::new(store);

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
        // A forked stream: base_offset > 0 → file_base starts at base_offset > 0.
        const FILE_BASE: u64 = 1000;
        let st = match store.create("forked", cfg, None, FILE_BASE).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };
        assert_eq!(
            st.shared.read().unwrap().file_base,
            FILE_BASE,
            "forked stream must start with file_base > 0"
        );

        // Append via the same path the handler uses.
        let wire = bytes::Bytes::from_static(b"forked-payload");
        let mut ap = st.appender.lock().await;
        write_wire(&st, &mut ap, &wire).unwrap();
        let target = ap.written;
        let file = ap.file.clone();
        let file_base = st.shared.read().unwrap().file_base;
        let stream_offset = file_base + target - wire.len() as u64;
        drop(ap);

        set_durability(DurabilityMode::Wal);
        wal.spawn_committers();
        maybe_sync_on_ack(
            DurabilityMode::Wal,
            &store,
            &st,
            &wire,
            std::sync::Arc::clone(&file),
            target,
            Some(stream_offset),
        )
        .await
        .unwrap();

        // Read the staged record back from the shard's segment and assert the
        // recorded stream_offset is LOGICAL. The first append's file position is 0,
        // so the logical offset must equal file_base. The buggy `target − wire.len()`
        // would record 0 here (the file-relative pre-offset), failing this assert.
        let seg = std::fs::read(dir.join("wal").join("0").join("1.wal")).unwrap();
        match decode_at(&seg, 0) {
            Decoded::Record { stream_id, stream_offset: rec_off, payload_off, len, .. } => {
                assert_eq!(stream_id, st.id);
                assert_eq!(&seg[payload_off..payload_off + len], wire.as_ref());
                assert_eq!(
                    rec_off, FILE_BASE,
                    "WAL stream_offset must be LOGICAL (file_base + file-relative pre-offset), \
                     not the file-relative `target − wire.len()`"
                );
                // Recovery maps file_pos = stream_offset − file_base; the first
                // append must land at file position 0.
                assert_eq!(
                    rec_off - file_base,
                    0,
                    "stream_offset − file_base must position the payload at file pos 0"
                );
            }
            other => panic!("WAL record did not decode: {other:?}"),
        }

        set_durability(DurabilityMode::Strict); // reset the global
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Ordering invariant (CQ-1): the wal-mode ack path MUST register the touched
    /// per-stream file into the shard's dirty set BEFORE its lsn can ever become
    /// durable. Otherwise a checkpoint whose floor snaps in the window between
    /// `reserve_and_stage` and `register_dirty` could `recycle_below(floor)` the
    /// WAL segment carrying that lsn while the stream's per-stream file was never
    /// `fdatasync`'d this checkpoint → recycle-before-fsync data loss (spec §7).
    ///
    /// We prove the order deterministically with a `#[cfg(test)]` seam on the
    /// shard: `Shard::set_on_stage_hook` installs a callback that fires at the
    /// VERY START of `reserve_and_stage` — before any lsn is reserved, i.e.
    /// strictly before this record's lsn can ever become durable. The hook
    /// asserts the stream is ALREADY in the dirty set at that moment. That holds
    /// iff `register_dirty(...)` ran BEFORE `reserve_and_stage(...)` in the wal
    /// ack arm. If `register_dirty` is moved back to after `reserve_and_stage`
    /// (the original window), the hook fires before registration and the
    /// in-hook assertion (surfaced via an atomic flag the test checks) fails.
    #[tokio::test]
    async fn wal_registers_dirty_before_lsn_can_become_durable() {
        use crate::store::{CreateResult, Store, StreamConfig};
        use crate::tier::TierConfig;
        use crate::wal::walset::WalSet;
        use std::sync::atomic::{AtomicBool, Ordering};

        let dir = std::env::temp_dir().join(format!(
            "ds-wal-dirty-order-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);

        let wal = WalSet::open(&dir, Some(1), 1).unwrap();
        let store = Store::new_with_tier(dir.clone(), TierConfig::default()).unwrap();
        store.wal.set(std::sync::Arc::clone(&wal)).ok();
        let store = std::sync::Arc::new(store);

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
        let st = match store.create("order", cfg, None, 0).unwrap() {
            CreateResult::Created(s) => s,
            _ => panic!("create failed"),
        };

        // Write the per-stream bytes upstream of the ack, exactly as the handler.
        let wire = bytes::Bytes::from_static(b"order-wal");
        let mut ap = st.appender.lock().await;
        write_wire(&st, &mut ap, &wire).unwrap();
        let target = ap.written;
        let file = ap.file.clone();
        drop(ap);

        let shard = wal.shard_for(st.id);
        let stream_id = st.id;

        // Before the ack runs, the stream is NOT yet dirty.
        assert!(
            !shard.is_dirty(stream_id),
            "precondition: stream not registered before the wal ack runs"
        );

        // Install the ordering seam: at the instant `reserve_and_stage` begins
        // (the earliest point this record's lsn could become durable), record
        // whether the stream was ALREADY registered dirty.
        let hook_fired = std::sync::Arc::new(AtomicBool::new(false));
        let dirty_at_stage = std::sync::Arc::new(AtomicBool::new(false));
        {
            let hook_shard = std::sync::Arc::clone(shard);
            let fired = std::sync::Arc::clone(&hook_fired);
            let dirty_seen = std::sync::Arc::clone(&dirty_at_stage);
            shard.set_on_stage_hook(Box::new(move |sid| {
                if sid == stream_id {
                    dirty_seen.store(hook_shard.is_dirty(stream_id), Ordering::SeqCst);
                    fired.store(true, Ordering::SeqCst);
                }
            }));
        }

        set_durability(DurabilityMode::Wal);
        wal.spawn_committers();
        let stream_offset = st.shared.read().unwrap().file_base + target - wire.len() as u64;

        maybe_sync_on_ack(
            DurabilityMode::Wal,
            &store,
            &st,
            &wire,
            std::sync::Arc::clone(&file),
            target,
            Some(stream_offset),
        )
        .await
        .unwrap();

        // The seam must have fired (the wal arm went through `reserve_and_stage`).
        assert!(hook_fired.load(Ordering::SeqCst), "reserve_and_stage seam must fire");

        // THE INVARIANT: the stream was already dirty when staging began, i.e.
        // `register_dirty` precedes `reserve_and_stage`. Fails if registration is
        // moved back after staging — the exact recycle-before-fsync window (CQ-1).
        assert!(
            dirty_at_stage.load(Ordering::SeqCst),
            "stream must be registered dirty BEFORE reserve_and_stage runs \
             (register_dirty must precede staging so a checkpoint floor can never \
              cover the lsn before the per-stream file is in the dirty set)"
        );

        // And after the ack the stream is still dirty and the append is durable.
        assert!(shard.is_dirty(stream_id), "stream stays dirty until next checkpoint");
        assert!(shard.durable_lsn() >= 1, "durable_lsn covers the append after ack");

        set_durability(DurabilityMode::Strict); // reset the global
        let _ = std::fs::remove_dir_all(&dir);
    }
}
