// Shared HTTP/1.1 wire logic — the pure, I/O-free pieces both the `raw` and
// `uring` engines need: request-head parsing, response-head serialization, and
// chunked-frame writing. Each engine keeps only its own byte source/sink
// (borrowed tokio buffers vs tokio-uring owned buffers) and its file-read
// strategy; everything here is a plain function over slices/Vecs so the two
// engines can't drift on protocol details.

use bytes::{Bytes, BytesMut};

use crate::api::{status_reason, Method, MAX_BODY_BYTES, SECURITY_HEADERS};

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

// ---- request reading (shared over a byte source) ----

/// A buffered, async byte source: the engine-specific transport seam. Each
/// engine implements it over its own buffer + I/O primitive (tokio `BytesMut` +
/// `read_buf`, or tokio-uring `Vec<u8>` + owned-buffer `read`); all request
/// reading (head, sized body, chunked body) below is shared over this trait so
/// the protocol logic lives in one place.
pub(crate) trait ByteSource {
    /// Bytes received but not yet consumed.
    fn buffered(&self) -> &[u8];
    /// Discard the first `n` buffered bytes (already parsed).
    fn consume(&mut self, n: usize);
    /// Read more bytes from the transport into the buffer; `false` on clean EOF.
    async fn fill(&mut self) -> std::io::Result<bool>;
}

pub(crate) enum HeadResult {
    /// Clean connection close (no partial request pending).
    Eof,
    /// Malformed or oversized request head — caller should send 400 and close.
    Bad,
    Head(ReqHead),
}

/// Read and parse the next request head, filling from the source as needed.
pub(crate) async fn read_head<S: ByteSource>(src: &mut S) -> std::io::Result<HeadResult> {
    loop {
        match try_parse_head(src.buffered()) {
            Err(()) => return Ok(HeadResult::Bad),
            Ok(Some((head, consumed))) => {
                src.consume(consumed);
                return Ok(HeadResult::Head(head));
            }
            Ok(None) => {
                if !src.fill().await? {
                    return Ok(HeadResult::Eof);
                }
            }
        }
    }
}

/// Read a fixed-length request body. `Ok(None)` means the body exceeds
/// `MAX_BODY_BYTES` or the connection ended early (caller sends 413 / closes).
pub(crate) async fn read_sized<S: ByteSource>(
    src: &mut S,
    n: usize,
) -> std::io::Result<Option<Bytes>> {
    if n > MAX_BODY_BYTES {
        return Ok(None);
    }
    while src.buffered().len() < n {
        if !src.fill().await? {
            return Ok(None);
        }
    }
    let body = Bytes::copy_from_slice(&src.buffered()[..n]);
    src.consume(n);
    Ok(Some(body))
}

/// Decode a `transfer-encoding: chunked` request body. `Ok(None)` on a
/// malformed body, an oversized body (`MAX_BODY_BYTES`), or early EOF — bounded
/// so a client that never terminates the body can't grow memory without limit.
pub(crate) async fn decode_chunked<S: ByteSource>(src: &mut S) -> std::io::Result<Option<Bytes>> {
    let mut out = BytesMut::new();
    loop {
        // chunk-size line
        let line_end = loop {
            if let Some(pos) = find_crlf(src.buffered()) {
                break pos;
            }
            if src.buffered().len() > MAX_HEADER_BYTES || !src.fill().await? {
                return Ok(None);
            }
        };
        let size = {
            let line = std::str::from_utf8(&src.buffered()[..line_end]).unwrap_or("");
            let s = line.split(';').next().unwrap_or("").trim();
            match usize::from_str_radix(s, 16) {
                Ok(v) => v,
                Err(_) => return Ok(None),
            }
        };
        src.consume(line_end + 2);
        if size == 0 {
            // trailer section: consume until the terminating blank line, bounded
            // by MAX_HEADER_BYTES.
            loop {
                if let Some(pos) = find_crlf(src.buffered()) {
                    src.consume(pos + 2);
                    if pos == 0 {
                        return Ok(Some(out.freeze()));
                    }
                } else if src.buffered().len() > MAX_HEADER_BYTES || !src.fill().await? {
                    return Ok(None);
                }
            }
        }
        // Guard against overflow from a hostile chunk-size line.
        let need = match size.checked_add(2) {
            Some(v) if out.len().checked_add(size).map(|t| t <= MAX_BODY_BYTES).unwrap_or(false) => v,
            _ => return Ok(None),
        };
        while src.buffered().len() < need {
            if !src.fill().await? {
                return Ok(None);
            }
        }
        out.extend_from_slice(&src.buffered()[..size]);
        src.consume(need); // chunk data + CRLF
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    /// In-memory `ByteSource` that hands out the wire bytes in fixed-size slices
    /// (one per `fill`), so tests can exercise reads that straddle fill
    /// boundaries by varying `step`.
    struct MockSource {
        pending: VecDeque<Vec<u8>>,
        buf: Vec<u8>,
    }

    impl MockSource {
        fn new(wire: &[u8], step: usize) -> Self {
            let step = step.max(1);
            let pending = wire.chunks(step).map(|c| c.to_vec()).collect();
            MockSource {
                pending,
                buf: Vec::new(),
            }
        }
    }

    impl ByteSource for MockSource {
        fn buffered(&self) -> &[u8] {
            &self.buf
        }
        fn consume(&mut self, n: usize) {
            self.buf.drain(..n);
        }
        async fn fill(&mut self) -> std::io::Result<bool> {
            match self.pending.pop_front() {
                Some(slice) => {
                    self.buf.extend_from_slice(&slice);
                    Ok(true)
                }
                None => Ok(false),
            }
        }
    }

    async fn decode(wire: &[u8], step: usize) -> Option<Vec<u8>> {
        let mut src = MockSource::new(wire, step);
        decode_chunked(&mut src)
            .await
            .unwrap()
            .map(|b| b.to_vec())
    }

    // Run a chunked-decode assertion across several fill granularities so a
    // body that arrives split mid-size-line / mid-chunk still decodes.
    async fn decode_all_steps(wire: &[u8]) -> Option<Vec<u8>> {
        let mut result = None;
        for step in [1usize, 2, 3, 7, wire.len().max(1)] {
            let got = decode(wire, step).await;
            if step == 1 {
                result = got.clone();
            } else {
                assert_eq!(got, result, "decode differs at fill step {step}");
            }
        }
        result
    }

    #[tokio::test]
    async fn chunked_single() {
        assert_eq!(
            decode_all_steps(b"5\r\nhello\r\n0\r\n\r\n").await.as_deref(),
            Some(&b"hello"[..])
        );
    }

    #[tokio::test]
    async fn chunked_multiple() {
        assert_eq!(
            decode_all_steps(b"3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n")
                .await
                .as_deref(),
            Some(&b"abcde"[..])
        );
    }

    #[tokio::test]
    async fn chunked_empty_body() {
        assert_eq!(decode_all_steps(b"0\r\n\r\n").await.as_deref(), Some(&b""[..]));
    }

    #[tokio::test]
    async fn chunked_hex_size() {
        // 0x1a = 26 bytes.
        let data: Vec<u8> = (b'a'..=b'z').collect();
        let mut wire = b"1a\r\n".to_vec();
        wire.extend_from_slice(&data);
        wire.extend_from_slice(b"\r\n0\r\n\r\n");
        assert_eq!(decode_all_steps(&wire).await, Some(data));
    }

    #[tokio::test]
    async fn chunked_extension_ignored() {
        // chunk-extension after `;` is ignored.
        assert_eq!(
            decode_all_steps(b"3;ext=1\r\nabc\r\n0\r\n\r\n")
                .await
                .as_deref(),
            Some(&b"abc"[..])
        );
    }

    #[tokio::test]
    async fn chunked_trailers_consumed() {
        assert_eq!(
            decode_all_steps(b"3\r\nabc\r\n0\r\nTrailer: x\r\nMore: y\r\n\r\n")
                .await
                .as_deref(),
            Some(&b"abc"[..])
        );
    }

    #[tokio::test]
    async fn chunked_malformed_size_rejected() {
        assert_eq!(decode(b"zz\r\nabc\r\n0\r\n\r\n", 64).await, None);
    }

    #[tokio::test]
    async fn chunked_early_eof_rejected() {
        // size says 5 but only 3 bytes + EOF.
        assert_eq!(decode(b"5\r\nabc", 64).await, None);
        // terminating blank line never arrives.
        assert_eq!(decode(b"3\r\nabc\r\n", 64).await, None);
    }

    #[tokio::test]
    async fn chunked_size_overflow_rejected() {
        // usize::MAX as hex: size.checked_add(2) overflows → rejected, no panic.
        assert_eq!(decode(b"ffffffffffffffff\r\n", 64).await, None);
    }

    #[tokio::test]
    async fn read_sized_across_fills() {
        let mut src = MockSource::new(b"hello world", 2);
        let body = read_sized(&mut src, 11).await.unwrap();
        assert_eq!(body.as_deref(), Some(&b"hello world"[..]));
    }

    #[tokio::test]
    async fn read_sized_over_limit_rejected() {
        let mut src = MockSource::new(b"x", 1);
        assert_eq!(read_sized(&mut src, MAX_BODY_BYTES + 1).await.unwrap(), None);
    }
}
