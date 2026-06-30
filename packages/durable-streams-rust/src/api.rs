// HTTP request/response types shared between handlers and the raw HTTP engine.
//
// Handlers speak these types only; the engine adapts them to its transport.
// The key piece is Body::FileRange: handlers describe reads as file segments +
// optional framing bytes, and the engine decides how to serve them (buffered
// copy, or sendfile where the platform can).

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use bytes::Bytes;
use tokio::sync::mpsc;

use crate::store::Segment;

/// A pull-based streaming body, driven INLINE on the connection task: the engine
/// calls `next_chunk` in a loop and writes each returned frame, ending when it
/// yields `None`. Unlike `Body::Channel` (a spawned producer task feeding an
/// mpsc channel), this adds NO per-response task and NO channel — the producer
/// runs on the connection's own task. SSE fan-out uses it so each subscriber
/// costs only its connection's existing footprint, not an extra ~4–5 KiB of
/// resident task+channel heap (the source of per-subscriber linear memory).
pub trait EventSource: Send {
    /// Produce the next framed chunk, or `None` to end the stream. The returned
    /// future borrows `self`, so state lives in the source (no channel buffer).
    fn next_chunk(&mut self) -> Pin<Box<dyn Future<Output = Option<Bytes>> + Send + '_>>;

    /// Reactor eligibility (Linux). When this returns `Some`, the connection task
    /// hands the socket to the epoll reactor instead of driving the stream
    /// inline, freeing its future — the per-subscriber cost. Default: not
    /// eligible (inline / hand-off, as for every non-SSE source).
    #[cfg(target_os = "linux")]
    fn reactor_reg(&self) -> Option<SseReg> {
        None
    }
}

/// Live-tail SSE registration: everything the reactor needs to serve a
/// subscriber once the connection task has handed off its socket. Constructed
/// only on Linux (`SseSource::reactor_reg`).
#[cfg(target_os = "linux")]
pub struct SseReg {
    pub st: Arc<crate::store::StreamState>,
    pub start: u64,
    pub encoding: crate::handlers::SseEncoding,
    pub client_cursor: Option<u64>,
}

/// A streamed (chunked) response body plus an abort signal.
///
/// `rx` carries the body frames. `failed` is set by the producer if it ends the
/// stream early because of a backend error (a cold-tier `get_range` failure, a
/// short/truncated object, a local read error). When `failed` is set the engine
/// MUST abort the response — drop the connection without emitting the clean
/// chunked terminator — so a client never mistakes a failed/short read for a
/// complete one (it would otherwise resume past `stream-next-offset` and silently
/// skip the missing bytes). See `handlers::stream_resolved_body`.
pub struct StreamBody {
    pub rx: mpsc::Receiver<Bytes>,
    pub failed: Arc<AtomicBool>,
}

/// Maximum accepted request body size; larger bodies get `413 Payload Too
/// Large`.
pub const MAX_BODY_BYTES: usize = 1024 * 1024 * 1024; // 1 GiB safety cap

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Method {
    Get,
    Put,
    Post,
    Delete,
    Head,
    Options,
    Other,
}

impl Method {
    pub fn parse(s: &str) -> Method {
        match s {
            "GET" => Method::Get,
            "PUT" => Method::Put,
            "POST" => Method::Post,
            "DELETE" => Method::Delete,
            "HEAD" => Method::Head,
            "OPTIONS" => Method::Options,
            _ => Method::Other,
        }
    }
}

pub struct Req {
    pub method: Method,
    /// Percent-encoded path, no query string.
    pub path: String,
    pub query: Option<String>,
    /// Lowercased header names.
    pub headers: Vec<(String, String)>,
    /// Fully collected request body.
    pub body: Bytes,
}

impl Req {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    pub fn header_is_true(&self, name: &str) -> bool {
        self.header(name)
            .map(|v| v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    }
}

pub enum Body {
    Empty,
    Full(Bytes),
    /// Streaming body for large dynamic responses (e.g. cold-tier reads): a
    /// spawned producer feeds frames over a channel. The `failed` flag tells the
    /// engine to abort rather than terminate cleanly. For SSE fan-out, prefer
    /// `Body::Sse`, which avoids the per-response task + channel.
    Channel(StreamBody),
    /// Pull-based streaming body driven inline on the connection task (SSE).
    /// No spawned task, no channel — see `EventSource`.
    Sse(Box<dyn EventSource>),
    /// Byte ranges of data files plus optional framing (JSON `[` / `]`).
    /// Total body length is prefix + Σ segment.len + suffix.
    FileRange {
        segments: Vec<Segment>,
        prefix: &'static [u8],
        suffix: &'static [u8],
        /// True when these bytes are a live tail feed of freshly-appended data
        /// (a caught-up long-poll wake) — guaranteed page-cache resident. The
        /// raw engine uses this to decide where sendfile runs; see
        /// engine_raw::ReadOffload.
        hot: bool,
    },
}

impl Body {
    /// Content length, when knowable up front (everything but Channel).
    pub fn len(&self) -> Option<u64> {
        match self {
            Body::Empty => Some(0),
            Body::Full(b) => Some(b.len() as u64),
            Body::Channel(_) => None,
            Body::Sse(_) => None,
            Body::FileRange {
                segments,
                prefix,
                suffix,
                ..
            } => Some(
                prefix.len() as u64
                    + segments.iter().map(|s| s.len).sum::<u64>()
                    + suffix.len() as u64,
            ),
        }
    }
}

pub struct Resp {
    pub status: u16,
    /// Header names must be lowercase ASCII.
    pub headers: Vec<(&'static str, String)>,
    pub body: Body,
}

impl Resp {
    pub fn new(status: u16) -> Resp {
        Resp {
            status,
            headers: Vec::with_capacity(8),
            body: Body::Empty,
        }
    }
}

pub const BASE64_STD: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// RFC 4648 base64. `pad` adds trailing `=` (standard, used for SSE binary frames).
pub fn base64_encode(data: &[u8], charset: &[u8; 64], pad: bool) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(charset[(n >> 18) as usize & 63] as char);
        out.push(charset[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(charset[(n >> 6) as usize & 63] as char);
        } else if pad {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(charset[n as usize & 63] as char);
        } else if pad {
            out.push('=');
        }
    }
    out
}

/// Constant security headers added to every response by the HTTP engines.
/// Kept as static name/value pairs so engines emit them with no allocation.
pub const SECURITY_HEADERS: &[(&str, &str)] = &[
    ("x-content-type-options", "nosniff"),
    ("cross-origin-resource-policy", "cross-origin"),
];

pub fn status_reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        304 => "Not Modified",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        410 => "Gone",
        413 => "Payload Too Large",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        _ => "",
    }
}
