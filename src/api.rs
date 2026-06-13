// Engine-agnostic HTTP request/response types.
//
// Handlers speak these types only; each HTTP engine (hyper, raw) adapts them
// to its transport. The key piece is Body::FileRange: handlers describe reads
// as file segments + optional framing bytes, and the engine decides how to
// serve them (buffered copy, or sendfile on engines/platforms that can).

use bytes::Bytes;
use tokio::sync::mpsc;

use crate::store::Segment;

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
    /// Streaming body (SSE / large dynamic responses); engine frames it
    /// (e.g. chunked transfer-encoding) and ends when the channel closes.
    Channel(mpsc::Receiver<Bytes>),
    /// Byte ranges of data files plus optional framing (JSON `[` / `]`).
    /// Total body length is prefix + Σ segment.len + suffix.
    FileRange {
        segments: Vec<Segment>,
        prefix: &'static [u8],
        suffix: &'static [u8],
    },
}

impl Body {
    /// Content length, when knowable up front (everything but Channel).
    pub fn len(&self) -> Option<u64> {
        match self {
            Body::Empty => Some(0),
            Body::Full(b) => Some(b.len() as u64),
            Body::Channel(_) => None,
            Body::FileRange {
                segments,
                prefix,
                suffix,
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
