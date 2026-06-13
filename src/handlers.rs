// HTTP protocol handlers for Durable Streams.

use std::convert::Infallible;
use std::os::unix::fs::FileExt;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use bytes::{BufMut, Bytes, BytesMut};
use http_body_util::{BodyExt, Either, Full};
use hyper::body::{Body, Frame, Incoming};
use hyper::{Method, Request, Response, StatusCode};
use serde_json::value::RawValue;
use tokio::sync::mpsc;

use crate::store::*;

pub type RespBody = Either<Full<Bytes>, ChannelBody>;
pub type Resp = Response<RespBody>;

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

const SSE_MAX_DURATION: Duration = Duration::from_secs(60);
const CACHEABLE: &str = "public, max-age=60, stale-while-revalidate=300";

// ---------- channel-backed streaming body ----------

pub struct ChannelBody {
    rx: mpsc::Receiver<Bytes>,
}

impl Body for ChannelBody {
    type Data = Bytes;
    type Error = Infallible;

    fn poll_frame(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        match self.rx.poll_recv(cx) {
            std::task::Poll::Ready(Some(b)) => std::task::Poll::Ready(Some(Ok(Frame::data(b)))),
            std::task::Poll::Ready(None) => std::task::Poll::Ready(None),
            std::task::Poll::Pending => std::task::Poll::Pending,
        }
    }
}

fn full(b: impl Into<Bytes>) -> RespBody {
    Either::Left(Full::new(b.into()))
}

fn empty() -> RespBody {
    full(Bytes::new())
}

fn text_response(status: StatusCode, msg: &str) -> Resp {
    let mut r = Response::new(full(msg.to_string()));
    *r.status_mut() = status;
    r.headers_mut()
        .insert("content-type", "text/plain".parse().unwrap());
    r
}

struct ResponseBuilder {
    resp: hyper::http::response::Builder,
}

impl ResponseBuilder {
    fn new(status: StatusCode) -> Self {
        ResponseBuilder {
            resp: Response::builder().status(status),
        }
    }
    fn h(mut self, k: &'static str, v: String) -> Self {
        self.resp = self.resp.header(k, v);
        self
    }
    fn hs(mut self, k: &'static str, v: &'static str) -> Self {
        self.resp = self.resp.header(k, v);
        self
    }
    fn body(self, b: RespBody) -> Resp {
        self.resp.body(b).unwrap()
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

fn header_str<'a>(req: &'a Request<Incoming>, name: &str) -> Option<&'a str> {
    req.headers().get(name).and_then(|v| v.to_str().ok())
}

fn header_is_true(req: &Request<Incoming>, name: &str) -> bool {
    header_str(req, name)
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

// ---------- main dispatch ----------

pub async fn handle(store: Arc<Store>, req: Request<Incoming>) -> Resp {
    let path = req.uri().path().to_string();
    let mut resp = if path == "/health" {
        text_response(StatusCode::OK, "ok")
    } else if path.split('/').any(|seg| seg == "__ds") {
        text_response(StatusCode::NOT_IMPLEMENTED, "control plane not implemented")
    } else {
        match *req.method() {
            Method::PUT => handle_create(store, req, path).await,
            Method::POST => handle_append(store, req, path).await,
            Method::GET => handle_read(store, req, path).await,
            Method::HEAD => handle_head(store, path),
            Method::DELETE => handle_delete(store, path),
            Method::OPTIONS => ResponseBuilder::new(StatusCode::NO_CONTENT).body(empty()),
            _ => text_response(StatusCode::METHOD_NOT_ALLOWED, "method not allowed"),
        }
    };
    let h = resp.headers_mut();
    h.insert("x-content-type-options", "nosniff".parse().unwrap());
    h.insert("cross-origin-resource-policy", "cross-origin".parse().unwrap());
    resp
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
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
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

async fn handle_create(store: Arc<Store>, req: Request<Incoming>, path: String) -> Resp {
    let content_type = header_str(&req, "content-type")
        .unwrap_or("application/octet-stream")
        .to_string();
    let ttl_raw = header_str(&req, H_TTL).map(|s| s.to_string());
    let exp_raw = header_str(&req, H_EXPIRES_AT).map(|s| s.to_string());
    if ttl_raw.is_some() && exp_raw.is_some() {
        return text_response(StatusCode::BAD_REQUEST, "Stream-TTL conflicts with Stream-Expires-At");
    }
    let ttl_seconds = match &ttl_raw {
        Some(v) => match parse_ttl(v) {
            Ok(t) => Some(t),
            Err(_) => return text_response(StatusCode::BAD_REQUEST, "invalid Stream-TTL"),
        },
        None => None,
    };
    let expires_at = match &exp_raw {
        Some(v) => match parse_rfc3339(v) {
            Ok(t) => Some(t),
            Err(_) => return text_response(StatusCode::BAD_REQUEST, "invalid Stream-Expires-At"),
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
            StatusCode::BAD_REQUEST,
            "fork headers require Stream-Forked-From",
        );
    }
    let sub_offset: Option<u64> = match &sub_offset_raw {
        None => None,
        Some(v) => {
            if v.is_empty() || !v.bytes().all(|c| c.is_ascii_digit()) {
                return text_response(StatusCode::BAD_REQUEST, "malformed Stream-Fork-Sub-Offset");
            }
            match v.parse() {
                Ok(n) => Some(n),
                Err(_) => {
                    return text_response(
                        StatusCode::BAD_REQUEST,
                        "malformed Stream-Fork-Sub-Offset",
                    )
                }
            }
        }
    };
    if sub_offset.unwrap_or(0) > 0 && fork_offset_raw.is_none() {
        return text_response(
            StatusCode::BAD_REQUEST,
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
            None => return text_response(StatusCode::NOT_FOUND, "fork source not found"),
        };
        if src.shared.read().unwrap().soft_deleted {
            return text_response(StatusCode::CONFLICT, "fork source is deleted");
        }
        match &content_type_hdr {
            None => content_type = src.config.content_type.clone(),
            Some(ct) => {
                if media_type(ct) != media_type(&src.config.content_type) {
                    return text_response(StatusCode::CONFLICT, "fork content-type mismatch");
                }
            }
        }
        let src_tail = src.tail().bytes;
        if sub_offset_raw.is_some() && src_tail == 0 {
            return text_response(
                StatusCode::BAD_REQUEST,
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
                        StatusCode::BAD_REQUEST,
                        "fork offset beyond stream length",
                    );
                }
                b
            }
            Err(_) => return text_response(StatusCode::BAD_REQUEST, "malformed fork offset"),
        };
        let fork_point = match sub_offset.unwrap_or(0) {
            0 => anchor,
            sub if src.is_json => {
                // Sub-offset counts messages past the anchor; each message ends with ','.
                let data = read_range_bytes(&src, anchor, src_tail).await;
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
                        StatusCode::BAD_REQUEST,
                        "sub-offset overshoots message count",
                    );
                }
                anchor + adv
            }
            sub => {
                if anchor + sub > src_tail {
                    return text_response(
                        StatusCode::BAD_REQUEST,
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

    let body = match req.into_body().collect().await {
        Ok(c) => c.to_bytes(),
        Err(_) => return text_response(StatusCode::BAD_REQUEST, "body read error"),
    };

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
            Err(msg) => return text_response(StatusCode::BAD_REQUEST, msg),
        }
    };

    let result = match store.create(&path, config, parent, base_offset) {
        Ok(r) => r,
        Err(e) => return text_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    match result {
        CreateResult::Conflict => text_response(StatusCode::CONFLICT, "stream exists with different configuration"),
        CreateResult::Exists(st) => {
            st.touch();
            let t = st.tail();
            let mut b = ResponseBuilder::new(StatusCode::OK)
                .h("content-type", st.config.content_type.clone())
                .h(H_NEXT_OFFSET, format_offset(t.bytes));
            if t.closed {
                b = b.hs(H_CLOSED, "true");
            }
            b.body(empty())
        }
        CreateResult::Created(st) => {
            if let Some(wire) = wire {
                let mut ap = st.appender.lock().await;
                if write_wire(&st, &mut ap, &wire).is_err() {
                    return text_response(StatusCode::INTERNAL_SERVER_ERROR, "write failed");
                }
                let target = ap.written;
                let file = ap.file.clone();
                drop(ap);
                st.sync.sync_to(file, &st, target).await;
            }
            let t = st.tail();
            let mut b = ResponseBuilder::new(StatusCode::CREATED)
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

fn write_wire(st: &StreamState, ap: &mut Appender, wire: &Bytes) -> std::io::Result<()> {
    use std::io::Write;
    (&*ap.file).write_all(wire)?;
    ap.written += wire.len() as u64;
    let tail = st.base_offset + ap.written;
    let closed;
    {
        let mut s = st.shared.write().unwrap();
        s.tail = tail;
        s.last_access = SystemTime::now();
        closed = s.closed;
    }
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

fn parse_producer_headers(req: &Request<Incoming>) -> Result<Option<ProducerHeaders>, &'static str> {
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
    text_response(StatusCode::GONE, "stream is deleted")
}

async fn handle_append(store: Arc<Store>, req: Request<Incoming>, path: String) -> Resp {
    let st = match store.get(&path) {
        Some(s) => s,
        None => return text_response(StatusCode::NOT_FOUND, "stream not found"),
    };
    if st.shared.read().unwrap().soft_deleted {
        return gone();
    }
    let producer = match parse_producer_headers(&req) {
        Ok(p) => p,
        Err(m) => return text_response(StatusCode::BAD_REQUEST, m),
    };
    let close_req = header_is_true(&req, H_CLOSED);
    let seq_header = header_str(&req, H_SEQ).map(|s| s.to_string());
    let req_ct = header_str(&req, "content-type").map(|s| s.to_string());

    let body = match req.into_body().collect().await {
        Ok(c) => c.to_bytes(),
        Err(_) => return text_response(StatusCode::BAD_REQUEST, "body read error"),
    };

    if body.is_empty() && !close_req {
        return text_response(StatusCode::BAD_REQUEST, "empty append body");
    }
    if !body.is_empty() {
        match &req_ct {
            None => return text_response(StatusCode::BAD_REQUEST, "missing Content-Type"),
            Some(ct) => {
                if media_type(ct) != media_type(&st.config.content_type) {
                    // closed check has precedence over content-type mismatch
                    let t = st.tail();
                    if t.closed && !close_req {
                        return closed_conflict(&st, t.bytes);
                    }
                    return text_response(StatusCode::CONFLICT, "content-type mismatch");
                }
            }
        }
    }

    let wire = if body.is_empty() {
        Bytes::new()
    } else {
        match encode_wire(&body, st.is_json, false) {
            Ok(w) => w,
            Err(m) => return text_response(StatusCode::BAD_REQUEST, m),
        }
    };

    // Serialize per stream: producer validation + write + state update under one lock.
    let mut ap = st.appender.lock().await;

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
                            return ResponseBuilder::new(StatusCode::NO_CONTENT)
                                .hs(H_CLOSED, "true")
                                .h(H_NEXT_OFFSET, format_offset(tail))
                                .h(H_PRODUCER_EPOCH, p.epoch.to_string())
                                .h(H_PRODUCER_SEQ, p.seq.to_string())
                                .body(empty());
                        }
                    }
                    drop(s);
                    return closed_conflict(&st, tail);
                }
                if body.is_empty() {
                    // idempotent close of an already-closed stream
                    drop(s);
                    return ResponseBuilder::new(StatusCode::NO_CONTENT)
                        .hs(H_CLOSED, "true")
                        .h(H_NEXT_OFFSET, format_offset(tail))
                        .body(empty());
                }
            }
            drop(s);
            return closed_conflict(&st, tail);
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
                let mut b = ResponseBuilder::new(StatusCode::NO_CONTENT)
                    .h(H_NEXT_OFFSET, format_offset(tail))
                    .h(H_PRODUCER_EPOCH, p.epoch.to_string())
                    .h(H_PRODUCER_SEQ, last_seq.to_string());
                if close_req {
                    b = b.hs(H_CLOSED, "true");
                }
                return b.body(empty());
            }
            ProducerOutcome::StaleEpoch { current } => {
                return ResponseBuilder::new(StatusCode::FORBIDDEN)
                    .h(H_PRODUCER_EPOCH, current.to_string())
                    .body(full("stale producer epoch"));
            }
            ProducerOutcome::Gap { expected } => {
                return ResponseBuilder::new(StatusCode::CONFLICT)
                    .h(H_PRODUCER_EXPECTED, expected.to_string())
                    .h(H_PRODUCER_RECEIVED, p.seq.to_string())
                    .body(full("producer sequence gap"));
            }
            ProducerOutcome::BadEpochStart => {
                return text_response(
                    StatusCode::BAD_REQUEST,
                    "new producer epoch must start at seq 0",
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
                return ResponseBuilder::new(StatusCode::CONFLICT)
                    .h(H_NEXT_OFFSET, format_offset(tail))
                    .body(full("Stream-Seq regression"));
            }
        }
    }

    // Write + state updates.
    if !wire.is_empty() {
        if write_wire(&st, &mut ap, &wire).is_err() {
            return text_response(StatusCode::INTERNAL_SERVER_ERROR, "write failed");
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
            let t = Tail {
                bytes: s.tail,
                closed: true,
            };
            drop(s);
            st.tail_tx.send_replace(t);
        }
    }
    let target = ap.written;
    let file = ap.file.clone();
    drop(ap);

    if !wire.is_empty() {
        st.sync.sync_to(file, &st, target).await;
    }

    // Persist metadata: closure durably (monotonic state), producer/access
    // updates debounced (documented crash window; see store::Meta).
    if close_req {
        let st2 = st.clone();
        let _ = tokio::task::spawn_blocking(move || write_meta_sync(&st2, true)).await;
    } else {
        st.schedule_meta_flush();
    }

    let tail = st.tail();
    let status = if producer.is_some() && !body.is_empty() {
        StatusCode::OK
    } else {
        StatusCode::NO_CONTENT
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
    b.body(empty())
}

fn closed_conflict(st: &StreamState, tail: u64) -> Resp {
    let _ = st;
    ResponseBuilder::new(StatusCode::CONFLICT)
        .hs(H_CLOSED, "true")
        .h(H_NEXT_OFFSET, format_offset(tail))
        .body(full("stream is closed"))
}

// ---------- reading bodies from the data file ----------

const INLINE_READ_MAX: u64 = 4 * 1024 * 1024;
const STREAM_CHUNK: usize = 1024 * 1024;

/// Read payload range [start, end) and build the response body.
/// JSON ranges always end on a `,` boundary; the response is `[` + range-minus-comma + `]`.
/// Logical ranges below the fork base are resolved through the parent chain.
async fn read_range_body(st: &Arc<StreamState>, start: u64, end: u64) -> RespBody {
    let json = st.is_json;
    if end <= start {
        return if json { full("[]") } else { empty() };
    }
    let (data_start, data_end) = if json { (start, end - 1) } else { (start, end) };
    let len = data_end - data_start;
    let mut segs = Vec::new();
    collect_segments(st, data_start, data_end, &mut segs);

    if len <= INLINE_READ_MAX {
        let res = tokio::task::spawn_blocking(move || -> std::io::Result<Bytes> {
            let mut buf = BytesMut::zeroed(len as usize + if json { 2 } else { 0 });
            let mut at = if json { 1usize } else { 0 };
            for seg in &segs {
                seg.file
                    .read_exact_at(&mut buf[at..at + seg.len as usize], seg.file_start)?;
                at += seg.len as usize;
            }
            if json {
                buf[0] = b'[';
                let n = buf.len();
                buf[n - 1] = b']';
            }
            Ok(buf.freeze())
        })
        .await;
        match res {
            Ok(Ok(b)) => full(b),
            _ => full(Bytes::new()),
        }
    } else {
        let (tx, rx) = mpsc::channel::<Bytes>(4);
        tokio::task::spawn_blocking(move || {
            if json {
                let _ = tx.blocking_send(Bytes::from_static(b"["));
            }
            for seg in &segs {
                let mut pos = seg.file_start;
                let seg_end = seg.file_start + seg.len;
                while pos < seg_end {
                    let n = ((seg_end - pos) as usize).min(STREAM_CHUNK);
                    let mut buf = BytesMut::zeroed(n);
                    if seg.file.read_exact_at(&mut buf, pos).is_err() {
                        return;
                    }
                    pos += n as u64;
                    if tx.blocking_send(buf.freeze()).is_err() {
                        return;
                    }
                }
            }
            if json {
                let _ = tx.blocking_send(Bytes::from_static(b"]"));
            }
        });
        Either::Right(ChannelBody { rx })
    }
}

// ---------- GET (catch-up / long-poll / SSE) ----------

async fn handle_read(store: Arc<Store>, req: Request<Incoming>, path: String) -> Resp {
    let st = match store.get(&path) {
        Some(s) => s,
        None => return text_response(StatusCode::NOT_FOUND, "stream not found"),
    };
    if st.shared.read().unwrap().soft_deleted {
        return gone();
    }
    st.touch();
    if st.config.ttl_seconds.is_some() {
        st.schedule_meta_flush(); // sliding TTL must survive restarts
    }
    let q = parse_query(req.uri().query());
    let offset = match parse_offset(q.offset.as_deref()) {
        Ok(o) => o,
        Err(_) => return text_response(StatusCode::BAD_REQUEST, "malformed offset"),
    };
    let live = q.live.as_deref();
    if live.is_some() && q.offset.is_none() {
        return text_response(StatusCode::BAD_REQUEST, "offset is required for live modes");
    }
    match live {
        Some("long-poll") => handle_long_poll(st, offset, q.cursor).await,
        Some("sse") => handle_sse(st, offset, q.cursor).await,
        Some(_) => text_response(StatusCode::BAD_REQUEST, "invalid live mode"),
        None => handle_catchup(st, offset, &req).await,
    }
}

async fn handle_catchup(st: Arc<StreamState>, offset: ParsedOffset, req: &Request<Incoming>) -> Resp {
    let t = st.tail();
    let (start, now_mode) = match offset {
        ParsedOffset::Start => (0, false),
        ParsedOffset::Now => (t.bytes, true),
        ParsedOffset::At(b) => {
            if b > t.bytes {
                return text_response(StatusCode::BAD_REQUEST, "offset beyond tail");
            }
            (b, false)
        }
    };
    let end = t.bytes;
    let etag = st.etag(start, end, t.closed);
    if let Some(inm) = header_str(req, "if-none-match") {
        if inm == etag {
            let mut b = ResponseBuilder::new(StatusCode::NOT_MODIFIED)
                .h("etag", etag)
                .h(H_NEXT_OFFSET, format_offset(end))
                .hs(H_UP_TO_DATE, "true");
            if t.closed {
                b = b.hs(H_CLOSED, "true");
            }
            return b.body(empty());
        }
    }
    let body = read_range_body(&st, start, end).await;
    let mut b = ResponseBuilder::new(StatusCode::OK)
        .h("content-type", st.config.content_type.clone())
        .h(H_NEXT_OFFSET, format_offset(end))
        .hs(H_UP_TO_DATE, "true")
        .h("etag", etag)
        .h(
            "cache-control",
            if now_mode { "no-store".into() } else { CACHEABLE.to_string() },
        );
    if t.closed {
        b = b.hs(H_CLOSED, "true");
    }
    b.body(body)
}

async fn handle_long_poll(st: Arc<StreamState>, offset: ParsedOffset, client_cursor: Option<u64>) -> Resp {
    let t0 = st.tail();
    let from = match offset {
        ParsedOffset::Start => 0,
        ParsedOffset::Now => t0.bytes,
        ParsedOffset::At(b) => {
            if b > t0.bytes {
                return text_response(StatusCode::BAD_REQUEST, "offset beyond tail");
            }
            b
        }
    };
    let cursor = compute_cursor(client_cursor);

    // Existing data → return immediately.
    if from < t0.bytes {
        return long_poll_data(&st, from, t0, client_cursor).await;
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
            return long_poll_data(&st, from, t, client_cursor).await;
        }
        if t.closed {
            return long_poll_close(t.bytes, cursor);
        }
        tokio::select! {
            r = rx.changed() => {
                if r.is_err() {
                    let t = st.tail();
                    if t.bytes > from {
                        return long_poll_data(&st, from, t, client_cursor).await;
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

async fn long_poll_data(st: &Arc<StreamState>, from: u64, t: Tail, client_cursor: Option<u64>) -> Resp {
    let cursor = compute_cursor(client_cursor);
    let body = read_range_body(st, from, t.bytes).await;
    let mut b = ResponseBuilder::new(StatusCode::OK)
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
    ResponseBuilder::new(StatusCode::NO_CONTENT)
        .h(H_NEXT_OFFSET, format_offset(tail))
        .h(H_CURSOR, cursor.to_string())
        .hs(H_UP_TO_DATE, "true")
        .hs(H_CLOSED, "true")
        .hs("cache-control", "no-store")
        .body(empty())
}

fn long_poll_timeout(tail: u64, cursor: u64, closed: bool) -> Resp {
    let mut b = ResponseBuilder::new(StatusCode::NO_CONTENT)
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

const BASE64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(BASE64_CHARS[(n >> 18) as usize & 63] as char);
        out.push(BASE64_CHARS[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            BASE64_CHARS[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            BASE64_CHARS[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
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
                return text_response(StatusCode::BAD_REQUEST, "offset beyond tail");
            }
            b
        }
    };
    let encoding = sse_encoding(&st);
    let is_b64 = matches!(encoding, SseEncoding::Base64);

    let (tx, rx) = mpsc::channel::<Bytes>(8);
    let stc = st.clone();
    tokio::spawn(async move {
        let st = stc;
        let mut pos = start;
        let mut rxw = st.tail_tx.subscribe();
        let deadline = Instant::now() + SSE_MAX_DURATION;
        loop {
            let t = *rxw.borrow_and_update();
            if t.bytes > pos {
                // Read new range and emit data + control.
                let data = read_range_bytes(&st, pos, t.bytes).await;
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
                        sse_data_event(&mut ev, &base64_encode(&data));
                    }
                }
                pos = t.bytes;
                let up_to_date = pos >= st.tail().bytes;
                sse_control_event(&mut ev, pos, compute_cursor(client_cursor), up_to_date, false);
                if tx.send(Bytes::from(ev)).await.is_err() {
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
    });

    let mut b = ResponseBuilder::new(StatusCode::OK)
        .hs("content-type", "text/event-stream")
        .hs("cache-control", "no-cache")
        .hs("connection", "keep-alive");
    if is_b64 {
        b = b.hs(H_SSE_ENCODING, "base64");
    }
    b.body(Either::Right(ChannelBody { rx }))
}

/// Read a logical byte range fully into memory (SSE batches are small).
async fn read_range_bytes(st: &Arc<StreamState>, start: u64, end: u64) -> Bytes {
    let len = (end - start) as usize;
    let mut segs = Vec::new();
    collect_segments(st, start, end, &mut segs);
    tokio::task::spawn_blocking(move || {
        let mut buf = BytesMut::zeroed(len);
        let mut at = 0usize;
        for seg in &segs {
            if seg
                .file
                .read_exact_at(&mut buf[at..at + seg.len as usize], seg.file_start)
                .is_err()
            {
                return Bytes::new();
            }
            at += seg.len as usize;
        }
        buf.freeze()
    })
    .await
    .unwrap_or_default()
}

// ---------- HEAD ----------

fn handle_head(store: Arc<Store>, path: String) -> Resp {
    let st = match store.get(&path) {
        Some(s) => s,
        None => return text_response(StatusCode::NOT_FOUND, "stream not found"),
    };
    if st.shared.read().unwrap().soft_deleted {
        return gone();
    }
    // HEAD must not reset the TTL.
    let t = st.tail();
    let mut b = ResponseBuilder::new(StatusCode::OK)
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
        None => return text_response(StatusCode::NOT_FOUND, "stream not found"),
    };
    if st.shared.read().unwrap().soft_deleted {
        return gone();
    }
    store.delete_or_soft_delete(&st);
    ResponseBuilder::new(StatusCode::NO_CONTENT).body(empty())
}
