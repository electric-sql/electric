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
    /// No WAL, no fsync: ack once the op is decided by a quorum of replicas
    /// (OmniPaxos) and applied locally. See REPLICATION.md.
    Replicated,
}

static DURABILITY_MODE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

/// Parse the `--durability` value. `wal` | `memory` | `replicated`; `None` → usage error.
pub fn parse_durability(s: &str) -> Option<DurabilityMode> {
    match s {
        "wal" => Some(DurabilityMode::Wal),
        "memory" => Some(DurabilityMode::Memory),
        "replicated" => Some(DurabilityMode::Replicated),
        _ => None,
    }
}

pub fn set_durability(mode: DurabilityMode) {
    DURABILITY_MODE.store(mode as u8, std::sync::atomic::Ordering::Relaxed);
}

pub fn durability() -> DurabilityMode {
    match DURABILITY_MODE.load(std::sync::atomic::Ordering::Relaxed) {
        1 => DurabilityMode::Memory,
        2 => DurabilityMode::Replicated,
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
/// Idle keep-alive cadence for SSE: when no new data arrives, emit a periodic
/// up-to-date control event so proxies/clients see liveness (still capped by
/// `SSE_MAX_DURATION`). Matches the reference servers' periodic control emits.
const SSE_KEEPALIVE: Duration = Duration::from_secs(15);
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

fn parse_query(q: Option<&str>) -> Result<Query, &'static str> {
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
                // A duplicate `offset` is rejected (matches the Go/TS reference
                // servers), not silently last-wins coalesced. `live`/`cursor`
                // keep last-wins (the Go server reads them with a last-value
                // getter and does not reject duplicates).
                "offset" => {
                    if out.offset.is_some() {
                        return Err("multiple offset parameters not allowed");
                    }
                    out.offset = Some(v);
                }
                "live" => out.live = Some(v),
                "cursor" => out.cursor = v.parse().ok(),
                _ => {}
            }
        }
    }
    Ok(out)
}

// Thin, intentional seams over the `Req` header accessors: every handler reads
// headers through these two free functions, so the underlying header source (and
// any future normalization — casing, trimming, multi-value policy) can change in
// one place without touching call sites. Kept as free functions for uniform,
// greppable call sites.
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
    } else if path == "/_repl/status" {
        if durability() == DurabilityMode::Replicated {
            let mut r = Resp::new(200);
            r.headers.push(("content-type", "application/json".to_string()));
            r.body = full(crate::replication::handle().status_json());
            r
        } else {
            text_response(404, "not in replicated mode")
        }
    } else {
        match req.method {
            Method::Put => handle_create(store, req, path).await,
            Method::Post => handle_append(store, req, path).await,
            Method::Get => handle_read(store, req, path).await,
            Method::Head => handle_head(store, path),
            Method::Delete => handle_delete(store, path).await,
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
    // Read Content-Type ONCE: `content_type_hdr` carries presence (used for fork
    // inheritance / match below); `content_type` is the resolved value with the
    // octet-stream default.
    let content_type_hdr = header_str(&req, "content-type").map(|s| s.to_string());
    let content_type = content_type_hdr
        .as_deref()
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
                // NOTE: this materializes the whole `[anchor, src_tail)` range to
                // scan for the Nth comma, even for a small `sub` over a huge stream
                // — O(tail) memory. Acceptable here: fork-create is a cold control
                // op, not a hot path. A bounded-window scan would remove the cost.
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

    // Replicated mode: the create (fork point pre-resolved above) goes through
    // the consensus log; every node — this one included — applies it from the
    // decided entry (log-first apply, REPLICATION.md). The response is built
    // from the apply outcome so it matches the single-node path.
    if durability() == DurabilityMode::Replicated {
        use crate::replication::entry::{CreateApplyOutcome as C, LogOp, OpOutcome};
        let op = LogOp::Create {
            path: path.clone(),
            config,
            base_offset,
            wire: wire.as_ref().map(|w| w.to_vec()).unwrap_or_default(),
        };
        return match crate::replication::handle().propose_and_wait(op).await {
            Err(_) => text_response(503, "replication timeout — retry"),
            Ok(OpOutcome::Create(c)) => match c {
                C::Created { tail, closed } => {
                    let mut b = ResponseBuilder::new(201)
                        .h(
                            "location",
                            format!("http://{}{}", host.as_deref().unwrap_or("localhost"), path),
                        )
                        .h("content-type", content_type)
                        .h(H_NEXT_OFFSET, format_offset(tail));
                    if closed {
                        b = b.hs(H_CLOSED, "true");
                    }
                    b.body(empty())
                }
                C::Exists {
                    tail,
                    closed,
                    content_type,
                } => {
                    let mut b = ResponseBuilder::new(200)
                        .h("content-type", content_type)
                        .h(H_NEXT_OFFSET, format_offset(tail));
                    if closed {
                        b = b.hs(H_CLOSED, "true");
                    }
                    b.body(empty())
                }
                C::Conflict => text_response(409, "stream exists with different configuration"),
                C::ForkSourceMissing => text_response(409, "fork source is deleted"),
                C::WriteFailed => text_response(500, "write failed"),
            },
            Ok(_) => text_response(500, "unexpected apply outcome"),
        };
    }

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
                let new_tail = match write_wire(&st, &mut ap, &wire) {
                    Ok(t) => t,
                    Err(_) => return text_response(500, "write failed"),
                };
                let target = ap.written;
                // Read `file_base` under the appender lock so a concurrent
                // compaction that raises `file_base` + resets `ap.written` together
                // can't desync it from `target`.
                let stream_offset = wal_stream_offset(&st, target, &wire);
                // Stage to the WAL UNDER the appender lock so per-stream LSN order
                // matches byte order (see stage_for_durability); the slow
                // durability wait runs after the lock is dropped.
                let staged_lsn = match stage_for_durability(&store, &st, &wire, stream_offset) {
                    Ok(lsn) => lsn,
                    Err(_) => return text_response(500, "wal stage failed"),
                };
                drop(ap);
                if let Some(lsn) = staged_lsn {
                    wait_durable_lsn(&store, &st, lsn).await;
                }
                // Durable now (wal) / page-cache written (memory): expose to readers.
                publish_durable_tail(&st, new_tail, &wire);
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

/// Stage the append into the WAL, assigning its LSN. MUST be called while the
/// appender lock is still held, so that PER STREAM the WAL LSN order matches the
/// byte/file-write order. That ordering is load-bearing: the committer's durable
/// watermark is a CONTIGUOUS-LSN cursor, so once LSN order tracks byte order,
/// `wait_durable(lsn)` returning guarantees every lower-offset record of this
/// stream is durable too — which is exactly what `publish_durable_tail` relies on
/// when it exposes bytes up to a tail. Reserving the LSN off the appender lock
/// (as a plain `drop(ap)` before staging would) lets a later-byte append win a
/// LOWER LSN, so its `wait_durable` could fire while an earlier-byte (higher-LSN)
/// record is still un-durable — exposing a non-durable interior range.
///
/// Returns the staged LSN, or `None` in memory mode (no WAL). The durability WAIT
/// is done separately, off the lock, by `wait_durable_lsn` (the slow part).
fn stage_for_durability(
    store: &Arc<Store>,
    st: &Arc<StreamState>,
    wire: &Bytes,
    stream_offset: u64,
) -> std::io::Result<Option<u64>> {
    // memory mode: no WAL — the page-cache file write IS the ack. No fsync, no stage.
    if durability() == DurabilityMode::Memory {
        return Ok(None);
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
    Ok(Some(lsn))
}

/// Wait until `lsn` is durable (the WAL `fdatasync` has covered it). Runs OFF the
/// appender lock — only the LSN reservation (`stage_for_durability`) needs the
/// lock; the fsync wait must not serialize same-stream appenders.
async fn wait_durable_lsn(store: &Arc<Store>, st: &Arc<StreamState>, lsn: u64) {
    let wal = store.wal.get().expect("WAL must be attached before serving");
    let shard = wal.shard_for(st.id);
    shard.wait_durable(lsn).await;
}

/// Write the wire bytes to the stream's own file (page cache) and advance the
/// WRITER tail `s.tail`. Returns the new logical tail. Does NOT make the bytes
/// reader-visible: visibility is published by `publish_durable_tail` only after
/// the bytes are durable (mirrors the close path's durability-before-visibility
/// ordering — PROTOCOL.md §4.1). Adds no fsync: the per-stream file stays
/// async/WAL-recoverable; the only durability barrier is the WAL `fdatasync`
/// awaited in `wait_durable_lsn`.
fn write_wire(st: &StreamState, ap: &mut Appender, wire: &Bytes) -> std::io::Result<u64> {
    use std::io::Write;
    (&*ap.file).write_all(wire)?;
    ap.written += wire.len() as u64;
    let tail = {
        let mut s = st.shared.write().unwrap();
        let tail = s.file_base + ap.written;
        s.tail = tail;
        s.last_access = SystemTime::now();
        tail
    };
    Ok(tail)
}

/// Expose freshly-appended bytes to readers AFTER they are durable (in `wal` mode
/// `wait_durable_lsn` has awaited the WAL `fdatasync` for an LSN staged in byte
/// order; in `memory` mode there is no WAL and the page-cache write IS the ack).
/// Advances the reader-observable
/// `durable_tail` MONOTONICALLY and, only when it actually advances, refreshes the
/// tail-chunk cache and wakes live subscribers. The monotonic guard makes
/// concurrent appenders (whose group-commit fsyncs may resolve out of order)
/// safe: a later appender publishing the higher frontier first is fine (all
/// lower bytes are durable too), and the earlier appender then no-ops.
fn publish_durable_tail(st: &StreamState, tail: u64, wire: &Bytes) {
    let closed;
    {
        let mut s = st.shared.write().unwrap();
        if tail <= s.durable_tail {
            // A concurrent appender already published an equal/greater durable
            // frontier — nothing to expose, and re-firing would regress the watch.
            return;
        }
        s.durable_tail = tail;
        closed = s.closed_durable;
    }
    // Publish the resident chunk BEFORE waking subscribers, so a long-poll/SSE
    // reader woken by the tail update reliably hits the cache (one shared copy)
    // instead of racing ahead and falling back to a file read. The chunk spans
    // [tail - wire.len(), tail).
    st.set_last_chunk(tail - wire.len() as u64, wire.clone());
    st.tail_tx.send_replace(Tail { bytes: tail, closed });
    // Wake any reactor-served subscribers of this stream (no-op when none).
    #[cfg(target_os = "linux")]
    crate::sse_reactor::wake_stream(st);
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

// ---------- replicated apply (log-first) ----------
//
// The semantic twins of the single-node PUT/POST/DELETE paths, invoked by the
// replication core for every DECIDED log entry, in log order, on every node
// (leader included). They mirror the checks above exactly — closed → producer
// dedup/fencing → Stream-Seq — so replicas stay a deterministic function of
// the decided log. "Decided by a quorum" is this mode's durability, so bytes
// and closures are exposed to readers immediately after apply; the meta
// sidecar flush stays async (REPLICATION.md).

/// Apply a decided `LogOp::Create`. The fork point (`base_offset`) was
/// resolved by the proposing node; only the parent lookup happens here.
pub(crate) async fn apply_replicated_create(
    store: &Arc<Store>,
    path: &str,
    config: StreamConfig,
    base_offset: u64,
    wire: Vec<u8>,
) -> crate::replication::entry::CreateApplyOutcome {
    use crate::replication::entry::CreateApplyOutcome as C;
    let parent = match &config.forked_from {
        Some(src) => match store.get(src) {
            Some(s) if !s.shared.read().unwrap().soft_deleted => Some(s),
            _ => return C::ForkSourceMissing,
        },
        None => None,
    };
    let result = {
        let store2 = Arc::clone(store);
        let path2 = path.to_string();
        match tokio::task::spawn_blocking(move || store2.create(&path2, config, parent, base_offset))
            .await
        {
            Ok(Ok(r)) => r,
            _ => return C::WriteFailed,
        }
    };
    match result {
        CreateResult::Conflict => C::Conflict,
        CreateResult::Exists(st) => {
            st.touch();
            let t = st.tail();
            C::Exists {
                tail: t.bytes,
                closed: t.closed,
                content_type: st.config.content_type.clone(),
            }
        }
        CreateResult::Created(st) => {
            if !wire.is_empty() {
                let wire = Bytes::from(wire);
                let mut ap = st.appender.lock().await;
                let new_tail = match write_wire(&st, &mut ap, &wire) {
                    Ok(t) => t,
                    Err(_) => return C::WriteFailed,
                };
                drop(ap);
                publish_durable_tail(&st, new_tail, &wire);
            }
            let t = st.tail();
            C::Created {
                tail: t.bytes,
                closed: t.closed,
            }
        }
    }
}

/// Apply a decided `LogOp::Append` — the authoritative twin of
/// `handle_append_inner`'s checked-write section.
pub(crate) async fn apply_replicated_append(
    store: &Arc<Store>,
    path: &str,
    wire: Vec<u8>,
    producer: Option<crate::replication::entry::ReplProducer>,
    seq_header: Option<String>,
    close_req: bool,
) -> crate::replication::entry::AppendApplyOutcome {
    use crate::replication::entry::AppendApplyOutcome as A;
    let wire = Bytes::from(wire);
    let st = match store.get(path) {
        Some(s) => s,
        None => return A::NotFound,
    };
    if st.shared.read().unwrap().soft_deleted {
        return A::Gone;
    }
    let lock_t0 = crate::telemetry::Timer::start();
    let mut ap = st.appender.lock().await;
    crate::telemetry::record_append_lock_wait(lock_t0.elapsed_secs());

    // Closed checks (precedence: closed → producer → seq), as in the single-node path.
    {
        let s = st.shared.read().unwrap();
        if s.closed {
            let tail = s.durable_tail;
            if close_req {
                if let Some(p) = &producer {
                    if let Some((cid, cep, cseq)) = &s.closed_by {
                        if *cid == p.id && *cep == p.epoch && *cseq == p.seq {
                            return A::ClosedDupClose {
                                tail,
                                epoch: p.epoch,
                                seq: p.seq,
                            };
                        }
                    }
                    return A::Closed { tail };
                }
                if wire.is_empty() {
                    return A::ClosedIdempotent { tail };
                }
            }
            return A::Closed { tail };
        }
    }
    if let Some(p) = &producer {
        let ph = ProducerHeaders {
            id: p.id.clone(),
            epoch: p.epoch,
            seq: p.seq,
        };
        let outcome = {
            let s = st.shared.read().unwrap();
            validate_producer(&s, &ph)
        };
        match outcome {
            ProducerOutcome::Accept => {}
            ProducerOutcome::Duplicate { last_seq } => {
                let (tail, closed) = {
                    let s = st.shared.read().unwrap();
                    (s.durable_tail, s.closed_durable)
                };
                return A::ProducerDuplicate {
                    tail,
                    closed,
                    epoch: p.epoch,
                    last_seq,
                };
            }
            ProducerOutcome::StaleEpoch { current } => {
                let tail = st.shared.read().unwrap().durable_tail;
                return A::ProducerStaleEpoch { tail, current };
            }
            ProducerOutcome::Gap { expected } => {
                return A::ProducerGap {
                    expected,
                    received: p.seq,
                }
            }
            ProducerOutcome::BadEpochStart => return A::ProducerBadEpochStart,
        }
    }
    if let Some(seq) = &seq_header {
        let s = st.shared.read().unwrap();
        if let Some(last) = &s.last_seq_header {
            if seq.as_str() <= last.as_str() {
                return A::SeqConflict {
                    tail: s.durable_tail,
                };
            }
        }
    }

    // NOTE: a local write failure here (disk error) after the entry decided
    // means this replica diverges from the log — same failure class as a WAL
    // fsync error in `wal` mode. The 500 surfaces it; the node should be
    // replaced (v1 fail-stop assumption, REPLICATION.md).
    let mut new_tail = None;
    if !wire.is_empty() {
        match write_wire(&st, &mut ap, &wire) {
            Ok(t) => new_tail = Some(t),
            Err(_) => return A::WriteFailed,
        }
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
            s.closed = true;
            if let Some(p) = &producer {
                s.closed_by = Some((p.id.clone(), p.epoch, p.seq));
            }
        }
    }
    drop(ap);

    // Decided ⇒ durable in this mode: expose bytes (and the closure) now.
    if let Some(t) = new_tail {
        publish_durable_tail(&st, t, &wire);
    }
    let (tail, closed) = if close_req {
        let tail = {
            let mut s = st.shared.write().unwrap();
            s.closed_durable = true;
            s.durable_tail
        };
        st.tail_tx.send_replace(Tail {
            bytes: tail,
            closed: true,
        });
        #[cfg(target_os = "linux")]
        crate::sse_reactor::wake_stream(&st);
        (tail, true)
    } else {
        let s = st.shared.read().unwrap();
        (s.durable_tail, s.closed_durable)
    };
    st.schedule_meta_flush();
    A::Applied { tail, closed }
}

/// Apply a decided `LogOp::Delete`. The decided log entry is the durability of
/// the delete, so the local removal uses the non-durable variant.
pub(crate) async fn apply_replicated_delete(
    store: &Arc<Store>,
    path: &str,
) -> crate::replication::entry::DeleteApplyOutcome {
    use crate::replication::entry::DeleteApplyOutcome as D;
    let st = match store.get(path) {
        Some(s) => s,
        None => return D::NotFound,
    };
    if st.shared.read().unwrap().soft_deleted {
        return D::Gone;
    }
    let store2 = Arc::clone(store);
    let st2 = Arc::clone(&st);
    let _ = tokio::task::spawn_blocking(move || store2.delete_or_soft_delete(&st2)).await;
    D::Deleted
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
    // is_json comes back from the inner handler (false on the not-found path) so
    // the metric label doesn't cost a SECOND registry lookup per append — at high
    // stream cardinality each lookup is a cold walk of a million-key map.
    let (resp, outcome, is_json) = handle_append_inner(store, req, path).await;
    crate::telemetry::record_append(t0.elapsed_secs(), outcome.label(), is_json);
    resp
}

async fn handle_append_inner(store: Arc<Store>, req: Req, path: String) -> (Resp, AppendOutcome, bool) {
    use AppendOutcome::*;
    let st = match store.get(&path) {
        Some(s) => s,
        None => return (text_response(404, "stream not found"), Conflict, false),
    };
    let is_json = st.is_json;
    macro_rules! ret {
        ($resp:expr, $oc:expr) => {
            return ($resp, $oc, is_json)
        };
    }
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

    // Replicated mode: propose the append into the consensus log and wait for
    // the local apply of the decided entry (log-first apply — REPLICATION.md).
    // The authoritative closed/producer/seq checks run in the applier
    // (`apply_replicated_append`), in log order, deterministically on every
    // node; the response is rebuilt here from the apply outcome, mirroring the
    // single-node formats below.
    if durability() == DurabilityMode::Replicated {
        use crate::replication::entry::{AppendApplyOutcome as A, LogOp, OpOutcome, ReplProducer};
        let op = LogOp::Append {
            path: path.clone(),
            wire: wire.to_vec(),
            producer: producer.as_ref().map(|p| ReplProducer {
                id: p.id.clone(),
                epoch: p.epoch,
                seq: p.seq,
            }),
            seq: seq_header.clone(),
            close: close_req,
        };
        let outcome = match crate::replication::handle().propose_and_wait(op).await {
            Ok(OpOutcome::Append(a)) => a,
            Ok(_) => ret!(text_response(500, "unexpected apply outcome"), Conflict),
            Err(_) => ret!(text_response(503, "replication timeout — retry"), Conflict),
        };
        match outcome {
            A::Applied { tail, closed } => {
                let status = if producer.is_some() && !body.is_empty() {
                    200
                } else {
                    204
                };
                let mut b = ResponseBuilder::new(status).h(H_NEXT_OFFSET, format_offset(tail));
                if let Some(p) = &producer {
                    b = b
                        .h(H_PRODUCER_EPOCH, p.epoch.to_string())
                        .h(H_PRODUCER_SEQ, p.seq.to_string());
                }
                if closed {
                    b = b.hs(H_CLOSED, "true");
                }
                ret!(b.body(empty()), Accept);
            }
            A::NotFound => ret!(text_response(404, "stream not found"), Conflict),
            A::Gone => ret!(gone(), Conflict),
            A::ClosedDupClose { tail, epoch, seq } => ret!(
                ResponseBuilder::new(204)
                    .hs(H_CLOSED, "true")
                    .h(H_NEXT_OFFSET, format_offset(tail))
                    .h(H_PRODUCER_EPOCH, epoch.to_string())
                    .h(H_PRODUCER_SEQ, seq.to_string())
                    .body(empty()),
                Dup
            ),
            A::ClosedIdempotent { tail } => ret!(
                ResponseBuilder::new(204)
                    .hs(H_CLOSED, "true")
                    .h(H_NEXT_OFFSET, format_offset(tail))
                    .body(empty()),
                Dup
            ),
            A::Closed { tail } => ret!(closed_conflict(tail), Closed),
            A::ProducerDuplicate {
                tail,
                closed,
                epoch,
                last_seq,
            } => {
                let mut b = ResponseBuilder::new(204)
                    .h(H_NEXT_OFFSET, format_offset(tail))
                    .h(H_PRODUCER_EPOCH, epoch.to_string())
                    .h(H_PRODUCER_SEQ, last_seq.to_string());
                if closed {
                    b = b.hs(H_CLOSED, "true");
                }
                ret!(b.body(empty()), Dup);
            }
            A::ProducerStaleEpoch { tail, current } => ret!(
                ResponseBuilder::new(403)
                    .h(H_PRODUCER_EPOCH, current.to_string())
                    .h(H_NEXT_OFFSET, format_offset(tail))
                    .body(full("stale producer epoch")),
                Conflict
            ),
            A::ProducerGap { expected, received } => ret!(
                ResponseBuilder::new(409)
                    .h(H_PRODUCER_EXPECTED, expected.to_string())
                    .h(H_PRODUCER_RECEIVED, received.to_string())
                    .body(full("producer sequence gap")),
                Conflict
            ),
            A::ProducerBadEpochStart => ret!(
                text_response(400, "new producer epoch must start at seq 0"),
                Conflict
            ),
            A::SeqConflict { tail } => ret!(
                ResponseBuilder::new(409)
                    .h(H_NEXT_OFFSET, format_offset(tail))
                    .body(full("Sequence conflict")),
                Conflict
            ),
            A::WriteFailed => ret!(text_response(500, "write failed"), Conflict),
        }
    }

    // Serialize per stream: producer validation + write + state update under one
    // lock. Time the wait separately — lock contention is a key bottleneck.
    let lock_t0 = crate::telemetry::Timer::start();
    let mut ap = st.appender.lock().await;
    crate::telemetry::record_append_lock_wait(lock_t0.elapsed_secs());

    // Closed checks (precedence: closed → seq regression → gap).
    {
        let s = st.shared.read().unwrap();
        if s.closed {
            // Report the durable tail to clients (never an offset a crash could
            // roll back) — same monotonicity contract as `tail()`.
            let tail = s.durable_tail;
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
                // Gate Stream-Closed on the stream's ACTUAL durable-closed state
                // (what readers observe), not on the retry request's close flag.
                // This branch is past the already-closed early-return, so the
                // stream is open here unless it was closed durably in between.
                let (tail, closed) = {
                    let s = st.shared.read().unwrap();
                    (s.durable_tail, s.closed_durable)
                };
                let mut b = ResponseBuilder::new(204)
                    .h(H_NEXT_OFFSET, format_offset(tail))
                    .h(H_PRODUCER_EPOCH, p.epoch.to_string())
                    .h(H_PRODUCER_SEQ, last_seq.to_string());
                if closed {
                    b = b.hs(H_CLOSED, "true");
                }
                ret!(b.body(empty()), Dup);
            }
            ProducerOutcome::StaleEpoch { current } => {
                // Include the durable tail (matching the production Caddy server)
                // so a fenced producer learns the current offset. Spec §5.2.1
                // mandates only Producer-Epoch; Stream-Next-Offset is additive.
                let tail = st.shared.read().unwrap().durable_tail;
                ret!(
                    ResponseBuilder::new(403)
                        .h(H_PRODUCER_EPOCH, current.to_string())
                        .h(H_NEXT_OFFSET, format_offset(tail))
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
                let tail = s.durable_tail;
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

    // Write + state updates. `new_tail` carries the writer tail to publish to
    // readers only AFTER durability (below), so a live reader never observes
    // bytes a crash could roll back (PROTOCOL.md §4.1).
    let mut new_tail = None;
    if !wire.is_empty() {
        match write_wire(&st, &mut ap, &wire) {
            Ok(t) => new_tail = Some(t),
            Err(_) => ret!(text_response(500, "write failed"), Conflict),
        }
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
    // Stage to the WAL UNDER the appender lock so per-stream LSN order matches
    // byte order (see stage_for_durability). A stage failure is not durable —
    // error out (and skip the close commit below) rather than ack 2xx.
    let staged_lsn = if !wire.is_empty() {
        match stage_for_durability(&store, &st, &wire, stream_offset) {
            Ok(lsn) => lsn,
            Err(_) => ret!(text_response(500, "wal stage failed"), Conflict),
        }
    } else {
        None
    };
    drop(ap);

    // Wait for durability off the lock before exposing the bytes.
    if let Some(lsn) = staged_lsn {
        wait_durable_lsn(&store, &st, lsn).await;
    }

    // Durable now (wal) / page-cache written (memory): expose the new bytes to
    // readers, mirroring the close-visibility ordering below.
    if let Some(t) = new_tail {
        publish_durable_tail(&st, t, &wire);
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
            s.durable_tail
        };
        st.tail_tx.send_replace(Tail { bytes: tail, closed: true });
        #[cfg(target_os = "linux")]
        crate::sse_reactor::wake_stream(&st);
    } else if staged_lsn.is_some() {
        // WAL mode: the stream is in its shard's dirty set (register_dirty ran
        // during staging), so the ~3 s checkpoint will write the sidecar for us —
        // just mark it. This keeps the meta `File::create`+`rename` (and its
        // parent-directory rwsem, measured at ~40% of server CPU under write
        // saturation) plus a timer task OFF the per-append path. Producer/access
        // updates are already documented as a non-durable, lagging flush; the lag
        // bound moves from the 100 ms debounce to the checkpoint cadence.
        st.meta_dirty.store(true, std::sync::atomic::Ordering::Release);
    } else {
        // No WAL record staged (memory durability): no checkpoint will flush the
        // sidecar — keep the debounced flush.
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
    (b.body(empty()), Accept, is_json)
}

fn closed_conflict(tail: u64) -> Resp {
    ResponseBuilder::new(409)
        .hs(H_CLOSED, "true")
        .h(H_NEXT_OFFSET, format_offset(tail))
        .body(full("stream is closed"))
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
    let q = match parse_query(req.query.as_deref()) {
        Ok(q) => q,
        Err(m) => return text_response(400, m),
    };
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
        Some("sse") => return handle_sse(st, offset, q.cursor),
        Some(_) => return text_response(400, "invalid live mode"),
        None => (
            handle_catchup(st, offset, &req, &mut cache_hit).await,
            "catchup",
        ),
    };
    crate::telemetry::record_read(t0.elapsed_secs(), live_label, cache_hit);
    resp
}

/// Resolved start position for a read (catch-up / long-poll / SSE).
///
/// `parse_offset` has already rejected malformed offsets with `400`. A
/// well-formed offset is always accepted here: a NUMERIC offset that is beyond
/// the current tail is treated as "caught up at the tail" (matching the Go and
/// TS reference servers), NOT a `400`. The beyond-tail behaviour is therefore
/// defined in exactly ONE place and shared by all three read paths.
struct StartResolution {
    /// Byte position to read from, clamped to the tail (never `> tail`).
    start: u64,
    /// Sentinel/no-cache read (`offset=now` or an offset at/beyond the tail):
    /// no ETag, `Cache-Control: no-store`.
    now_mode: bool,
    /// `Stream-Next-Offset` to report when the response is up-to-date. For a
    /// beyond-tail offset this is the requested offset (PROTOCOL.md §5.5).
    next_offset: u64,
}

fn resolve_start(offset: ParsedOffset, tail: u64) -> StartResolution {
    match offset {
        ParsedOffset::Start => StartResolution {
            start: 0,
            now_mode: false,
            next_offset: tail,
        },
        ParsedOffset::Now => StartResolution {
            start: tail,
            now_mode: true,
            next_offset: tail,
        },
        ParsedOffset::At(b) => {
            if b > tail {
                // Beyond-tail numeric offset: caught up at the tail. Read from
                // the tail (empty range) but report the requested offset.
                StartResolution {
                    start: tail,
                    now_mode: true,
                    next_offset: b,
                }
            } else {
                StartResolution {
                    start: b,
                    now_mode: false,
                    next_offset: b,
                }
            }
        }
    }
}

async fn handle_catchup(
    st: Arc<StreamState>,
    offset: ParsedOffset,
    req: &Req,
    cache_hit: &mut bool,
) -> Resp {
    let t = st.tail();
    let StartResolution {
        start,
        now_mode,
        next_offset,
    } = resolve_start(offset, t.bytes);
    let end = t.bytes;
    // In sentinel mode (offset=now or a beyond-tail offset) the range is empty
    // (`start == end == tail`); report the resolved next offset — the requested
    // offset for a beyond-tail read (PROTOCOL.md §5.5). Otherwise report the
    // tail reached by the catch-up read.
    let reported = if now_mode { next_offset } else { end };
    // No ETag for offset=now (§10.1) — it's a tail sentinel, not a cacheable range.
    let etag = (!now_mode).then(|| st.etag(start, end, t.closed));
    if let Some(etag) = &etag {
        if header_str(req, "if-none-match") == Some(etag.as_str()) {
            let mut b = ResponseBuilder::new(304)
                .h("etag", etag.clone())
                .h(H_NEXT_OFFSET, format_offset(reported))
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
        .h(H_NEXT_OFFSET, format_offset(reported))
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
    // A beyond-tail numeric offset is treated as caught-up at the tail (see
    // `resolve_start`), so it follows the normal wait path below.
    let from = resolve_start(offset, t0.bytes).start;
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
            _ = tokio::time::sleep(deadline.saturating_duration_since(Instant::now())) => {
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

#[derive(Clone, Copy)]
pub(crate) enum SseEncoding {
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

/// Encode a wire byte range as one SSE `data` event in the stream's encoding.
/// Shared by the inline producer (`SseSource::next`) and the reactor so both
/// emit byte-identical frames.
pub(crate) fn sse_encode_data(out: &mut String, data: &[u8], encoding: SseEncoding) {
    match encoding {
        SseEncoding::Json => {
            // wire bytes end with ','; strip it and wrap the records as an array
            let inner = &data[..data.len().saturating_sub(1)];
            let mut payload = String::with_capacity(inner.len() + 2);
            payload.push('[');
            payload.push_str(&String::from_utf8_lossy(inner));
            payload.push(']');
            sse_data_event(out, &payload);
        }
        SseEncoding::Text => sse_data_event(out, &String::from_utf8_lossy(data)),
        SseEncoding::Base64 => {
            sse_data_event(out, &crate::api::base64_encode(data, crate::api::BASE64_STD, true))
        }
    }
}

/// Write `payload` as one SSE `data` event, splitting on line terminators to
/// prevent `data:` injection.
pub(crate) fn sse_data_event(out: &mut String, payload: &str) {
    out.push_str("event: data\n");
    for line in payload.split(['\n', '\r']) {
        out.push_str("data:");
        out.push_str(line);
        out.push('\n');
    }
    out.push('\n');
}

pub(crate) fn sse_control_event(out: &mut String, next: u64, cursor: u64, up_to_date: bool, closed: bool) {
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

/// Inline SSE producer state. Driven by the connection task via `EventSource`
/// (one `next_chunk` call per emitted SSE event) instead of a spawned task
/// feeding an mpsc channel: an idle subscriber then costs only its connection,
/// not an extra task future + channel buffer (the per-subscriber memory that
/// made fan-out grow linearly). All caught-up subscribers still share the one
/// resident tail chunk, so the fan-out read stays O(1).
struct SseSource {
    st: Arc<StreamState>,
    rxw: tokio::sync::watch::Receiver<Tail>,
    pos: u64,
    start: u64,
    deadline: Instant,
    client_cursor: Option<u64>,
    encoding: SseEncoding,
    sent_initial: bool,
    done: bool,
}

impl SseSource {
    /// Produce the next SSE event, or `None` to end the stream. Mirrors the
    /// original producer loop, but returns one frame per call (state persists in
    /// `self`) so it can run inline without a channel.
    async fn next(&mut self) -> Option<Bytes> {
        if self.done {
            return None;
        }
        loop {
            let t = *self.rxw.borrow_and_update();
            if t.bytes > self.pos {
                // Read new range and emit data + control. Caught-up subscribers
                // share the resident tail chunk — one read for all of them —
                // and fall back to a file read only when behind it.
                let read_t0 = crate::telemetry::Timer::start();
                let cache_hit;
                let data = match self.st.tail_chunk_slice(self.pos, t.bytes) {
                    Some(b) => {
                        cache_hit = true;
                        b
                    }
                    None => {
                        cache_hit = false;
                        match read_range_bytes(&self.st, self.pos, t.bytes).await {
                            Ok(d) => d,
                            // End the stream without advancing `pos`: the client
                            // reconnects from its last offset, never skipping a gap.
                            Err(_) => {
                                self.done = true;
                                return None;
                            }
                        }
                    }
                };
                crate::telemetry::record_tail_cache(cache_hit, "sse");
                crate::telemetry::record_read(read_t0.elapsed_secs(), "sse", cache_hit);
                let mut ev = String::new();
                sse_encode_data(&mut ev, &data, self.encoding);
                self.pos = t.bytes;
                let up_to_date = self.pos >= self.st.tail().bytes;
                // If the stream closed atomically with this final data, fold the
                // close into this control event (streamClosed:true) rather than
                // emitting a plain up-to-date control followed by a separate close
                // event — the reference server / TS client expect the close signal
                // on the control immediately after the final data.
                let closed_now = t.closed && self.pos >= t.bytes;
                sse_control_event(
                    &mut ev,
                    self.pos,
                    compute_cursor(self.client_cursor),
                    up_to_date,
                    closed_now,
                );
                if closed_now {
                    self.done = true;
                }
                return Some(Bytes::from(ev));
            }
            if t.closed && self.pos >= t.bytes {
                let mut ev = String::new();
                sse_control_event(&mut ev, self.pos, compute_cursor(self.client_cursor), true, true);
                self.done = true;
                return Some(Bytes::from(ev));
            }
            // Initial control event when starting caught-up (once).
            if !self.sent_initial
                && self.pos == self.start
                && t.bytes == self.start
                && !t.closed
                && self.pos == self.st.tail().bytes
            {
                let mut ev = String::new();
                sse_control_event(&mut ev, self.pos, compute_cursor(self.client_cursor), true, false);
                self.sent_initial = true;
                return Some(Bytes::from(ev));
            }
            // Idle wait: bounded by the total SSE duration, but woken early by new
            // data and broken into keep-alive intervals so an idle stream still
            // emits a periodic up-to-date control (liveness for proxies/clients).
            let now = Instant::now();
            if now >= self.deadline {
                self.done = true;
                return None; // total cap reached; client reconnects
            }
            let wait = SSE_KEEPALIVE.min(self.deadline - now);
            tokio::select! {
                r = self.rxw.changed() => {
                    if r.is_err() {
                        self.done = true;
                        return None;
                    }
                }
                _ = tokio::time::sleep(wait) => {
                    // No new data within the keep-alive window: emit a heartbeat
                    // control (still open here — the close path returns above).
                    let mut ev = String::new();
                    sse_control_event(&mut ev, self.pos, compute_cursor(self.client_cursor), true, false);
                    return Some(Bytes::from(ev));
                }
            }
        }
    }
}

impl crate::api::EventSource for SseSource {
    fn next_chunk(
        &mut self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<Bytes>> + Send + '_>> {
        Box::pin(self.next())
    }

    /// Live-tail subscribers (root stream, tiering off, start at/after the live
    /// file base) are served by the epoll reactor: the connection task hands off
    /// the socket and frees its future. Everything else (cold catch-up from a
    /// forked/compacted/tiered range) stays on the inline hand-off path.
    #[cfg(target_os = "linux")]
    fn reactor_reg(&self) -> Option<crate::api::SseReg> {
        if self.st.parent.is_some() || self.st.blobstore.is_some() {
            return None;
        }
        if self.start < self.st.shared.read().unwrap().file_base {
            return None;
        }
        Some(crate::api::SseReg {
            st: self.st.clone(),
            start: self.start,
            encoding: self.encoding,
            client_cursor: self.client_cursor,
        })
    }
}

fn handle_sse(st: Arc<StreamState>, offset: ParsedOffset, client_cursor: Option<u64>) -> Resp {
    let t0 = st.tail();
    // A beyond-tail numeric offset starts caught-up at the tail (see
    // `resolve_start`): emit the initial up-to-date control event, then wait.
    let start = resolve_start(offset, t0.bytes).start;
    let encoding = sse_encoding(&st);
    let is_b64 = matches!(encoding, SseEncoding::Base64);

    let src = SseSource {
        rxw: st.tail_tx.subscribe(),
        st,
        pos: start,
        start,
        deadline: Instant::now() + SSE_MAX_DURATION,
        client_cursor,
        encoding,
        sent_initial: false,
        done: false,
    };

    let mut b = ResponseBuilder::new(200)
        .hs("content-type", "text/event-stream")
        .hs("cache-control", "no-cache")
        // SSE responses are single-use: the server unilaterally closes the socket
        // when the stream closes (or at SSE_MAX_DURATION), so we must NOT advertise
        // keep-alive. If we did, the client (e.g. undici) would return the socket to
        // its pool and pipeline the next request onto it; the server's close() would
        // then see unread request bytes in the recv buffer and send a RST instead of
        // a FIN, discarding the still-in-flight SSE response (data + close frames)
        // and surfacing as an UND_ERR_SOCKET "other side closed" on the client.
        .hs("connection", "close");
    if is_b64 {
        b = b.hs(H_SSE_ENCODING, "base64");
    }
    // SSE is a live feed driven inline on the connection task: a mid-stream
    // hiccup just ends the event stream and the client reconnects from its last
    // offset, so there is no abort signal here.
    b.body(Body::Sse(Box::new(src)))
}

/// Read a logical byte range fully into memory (SSE batches are small).
/// Returns `Err` if the range could not be fully materialized (a short local
/// read or a cold-storage error/truncation) so callers never advance past a gap.
/// pub(crate): the replication tests use it to verify replica convergence.
pub(crate) async fn read_range_bytes(
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

async fn handle_delete(store: Arc<Store>, path: String) -> Resp {
    let st = match store.get(&path) {
        Some(s) => s,
        None => return text_response(404, "stream not found"),
    };
    if st.shared.read().unwrap().soft_deleted {
        return gone();
    }
    // Replicated mode: the delete goes through the consensus log; durability of
    // the 204 comes from the decided entry, not local fsync (REPLICATION.md).
    if durability() == DurabilityMode::Replicated {
        use crate::replication::entry::{DeleteApplyOutcome as D, LogOp, OpOutcome};
        let op = LogOp::Delete { path };
        return match crate::replication::handle().propose_and_wait(op).await {
            Err(_) => text_response(503, "replication timeout — retry"),
            Ok(OpOutcome::Delete(D::Deleted)) => ResponseBuilder::new(204).body(empty()),
            Ok(OpOutcome::Delete(D::NotFound)) => text_response(404, "stream not found"),
            Ok(OpOutcome::Delete(D::Gone)) => gone(),
            Ok(_) => text_response(500, "unexpected apply outcome"),
        };
    }
    // The 204 is a durability promise: once acked, a crash must never
    // resurrect the stream. Await the on-disk removal (unlinks + parent-dir
    // fsync, or the soft-delete meta flag) before responding — a detached
    // removal task can be lost to a crash after the ack.
    let store2 = Arc::clone(&store);
    let st2 = Arc::clone(&st);
    match tokio::task::spawn_blocking(move || store2.delete_or_soft_delete_durable(&st2)).await {
        Ok(Ok(())) => ResponseBuilder::new(204).body(empty()),
        _ => text_response(500, "delete not durable"),
    }
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

