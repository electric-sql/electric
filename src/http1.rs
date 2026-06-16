// Shared HTTP/1.1 wire logic — the pure, I/O-free pieces both the `raw` and
// `uring` engines need: request-head parsing, response-head serialization, and
// chunked-frame writing. Each engine keeps only its own byte source/sink
// (borrowed tokio buffers vs tokio-uring owned buffers) and its file-read
// strategy; everything here is a plain function over slices/Vecs so the two
// engines can't drift on protocol details.

use crate::api::{status_reason, Method, SECURITY_HEADERS};

pub(crate) const MAX_HEADER_BYTES: usize = 64 * 1024;
/// Bodies up to this size are coalesced into the head buffer and sent as one
/// write; larger bodies are written separately.
pub(crate) const COALESCE_MAX: usize = 64 * 1024;

pub(crate) struct ReqHead {
    pub(crate) method: Method,
    pub(crate) is_head: bool,
    pub(crate) path: String,
    pub(crate) query: Option<String>,
    pub(crate) headers: Vec<(String, String)>,
    pub(crate) content_length: Option<usize>,
    pub(crate) chunked: bool,
    pub(crate) expect_continue: bool,
    pub(crate) keep_alive: bool,
}

/// Try to parse a complete request head from `buf`; returns the head and the
/// number of bytes it consumed, `Ok(None)` if more bytes are needed, or `Err`
/// on a malformed/oversized head.
pub(crate) fn try_parse_head(buf: &[u8]) -> Result<Option<(ReqHead, usize)>, ()> {
    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut preq = httparse::Request::new(&mut headers);
    let n = match preq.parse(buf) {
        Ok(httparse::Status::Complete(n)) => n,
        Ok(httparse::Status::Partial) => {
            if buf.len() > MAX_HEADER_BYTES {
                return Err(());
            }
            return Ok(None);
        }
        Err(_) => return Err(()),
    };
    let method_str = preq.method.ok_or(())?;
    let target = preq.path.ok_or(())?;
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), Some(q.to_string())),
        None => (target.to_string(), None),
    };
    let http11 = preq.version == Some(1);
    let mut head = ReqHead {
        method: Method::parse(method_str),
        is_head: method_str == "HEAD",
        path,
        query,
        headers: Vec::with_capacity(preq.headers.len()),
        content_length: None,
        chunked: false,
        expect_continue: false,
        keep_alive: http11,
    };
    for h in preq.headers.iter() {
        let name = h.name.to_ascii_lowercase();
        let value = String::from_utf8_lossy(h.value).into_owned();
        match name.as_str() {
            "content-length" => head.content_length = value.trim().parse().ok(),
            "transfer-encoding" => {
                head.chunked = value.to_ascii_lowercase().contains("chunked");
            }
            "expect" => {
                head.expect_continue = value.eq_ignore_ascii_case("100-continue");
            }
            "connection" => {
                let v = value.to_ascii_lowercase();
                if v.contains("close") {
                    head.keep_alive = false;
                } else if v.contains("keep-alive") {
                    head.keep_alive = true;
                }
            }
            _ => {}
        }
        head.headers.push((name, value));
    }
    Ok(Some((head, n)))
}

pub(crate) fn find_crlf(buf: &[u8]) -> Option<usize> {
    buf.windows(2).position(|w| w == b"\r\n")
}

/// Responses with these statuses carry no body (and so no content-length /
/// transfer-encoding header).
pub(crate) fn status_has_no_body(status: u16) -> bool {
    status == 204 || status == 304 || (100..200).contains(&status)
}

/// Serialize a complete response head (status line, headers, constant security
/// headers, framing, blank line) into `out`. `body_len` is `None` for a
/// chunked/streaming body. Identical bytes for every engine.
pub(crate) fn write_head(
    out: &mut Vec<u8>,
    status: u16,
    headers: &[(&'static str, String)],
    body_len: Option<u64>,
    keep_alive: bool,
) {
    out.extend_from_slice(b"HTTP/1.1 ");
    out.extend_from_slice(status.to_string().as_bytes());
    out.push(b' ');
    out.extend_from_slice(status_reason(status).as_bytes());
    out.extend_from_slice(b"\r\n");
    for (k, v) in headers {
        out.extend_from_slice(k.as_bytes());
        out.extend_from_slice(b": ");
        out.extend_from_slice(v.as_bytes());
        out.extend_from_slice(b"\r\n");
    }
    for (k, v) in SECURITY_HEADERS {
        out.extend_from_slice(k.as_bytes());
        out.extend_from_slice(b": ");
        out.extend_from_slice(v.as_bytes());
        out.extend_from_slice(b"\r\n");
    }
    if !status_has_no_body(status) {
        match body_len {
            Some(n) => {
                out.extend_from_slice(b"content-length: ");
                out.extend_from_slice(n.to_string().as_bytes());
                out.extend_from_slice(b"\r\n");
            }
            None => out.extend_from_slice(b"transfer-encoding: chunked\r\n"),
        }
    }
    if !keep_alive {
        out.extend_from_slice(b"connection: close\r\n");
    }
    out.extend_from_slice(b"\r\n");
}

/// Append one `transfer-encoding: chunked` frame (`<hex-len>\r\n<data>\r\n`).
/// The terminating `0\r\n\r\n` is written separately by the caller.
pub(crate) fn frame_chunk(out: &mut Vec<u8>, b: &[u8]) {
    out.extend_from_slice(format!("{:x}\r\n", b.len()).as_bytes());
    out.extend_from_slice(b);
    out.extend_from_slice(b"\r\n");
}
