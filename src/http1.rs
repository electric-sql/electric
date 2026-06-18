// Shared HTTP/1.1 wire logic — the pure, I/O-free pieces both the `raw` and
// `uring` engines need: request-head parsing, response-head serialization, and
// chunked-frame writing. Each engine keeps only its own byte source/sink
// (borrowed tokio buffers vs tokio-uring owned buffers) and its file-read
// strategy; everything here is a plain function over slices/Vecs so the two
// engines can't drift on protocol details.

use bytes::{Buf, Bytes, BytesMut};
use tokio::io::{AsyncRead, AsyncReadExt};

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
    // Request-smuggling guards (RFC 9112 §6.1, §6.3.3, §6.3.5): a duplicate or
    // non-numeric Content-Length, both CL and Transfer-Encoding, or any TE other
    // than exactly `chunked` is a framing conflict — reject rather than risk a
    // CL.TE / TE.CL desync with a front proxy.
    let mut cl_bad = false;
    let mut te_present = false;
    let mut te_chunked = false;
    for h in preq.headers.iter() {
        let name = h.name.to_ascii_lowercase();
        let value = String::from_utf8_lossy(h.value).into_owned();
        match name.as_str() {
            "content-length" => {
                if head.content_length.is_some() {
                    cl_bad = true; // duplicate
                }
                match value.trim().parse() {
                    Ok(n) => head.content_length = Some(n),
                    Err(_) => cl_bad = true,
                }
            }
            "transfer-encoding" => {
                te_present = true;
                te_chunked = value.trim().eq_ignore_ascii_case("chunked");
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
    if cl_bad {
        return Err(());
    }
    if te_present {
        // CL + TE is a desync vector; a TE we can't frame (not exactly `chunked`)
        // is unsupported. Either way, refuse.
        if head.content_length.is_some() || !te_chunked {
            return Err(());
        }
        head.chunked = true;
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

// Header-value response injection is structurally prevented, so no per-write
// scrub is needed on the hot path: request-derived values (content-type, host →
// location) are rejected by httparse if they contain CR/LF, and server-minted
// values (offsets, ETags, cache-control) are CR/LF-free by construction.

/// Append one `transfer-encoding: chunked` frame (`<hex-len>\r\n<data>\r\n`).
/// The terminating `0\r\n\r\n` is written separately by the caller.
pub(crate) fn frame_chunk(out: &mut Vec<u8>, b: &[u8]) {
    out.extend_from_slice(format!("{:x}\r\n", b.len()).as_bytes());
    out.extend_from_slice(b);
    out.extend_from_slice(b"\r\n");
}

// ---- request reading ----
//
// Reads operate on an `AsyncRead` (the socket) plus a reusable `BytesMut` that
// holds bytes received but not yet consumed: `&buf[..]` is the buffered slice,
// `buf.advance(n)` consumes, `reader.read_buf(buf)` fills (returns 0 on EOF).

pub(crate) enum HeadResult {
    /// Clean connection close (no partial request pending).
    Eof,
    /// Malformed or oversized request head — caller should send 400 and close.
    Bad,
    Head(ReqHead),
}

/// Read and parse the next request head, filling from `reader` as needed.
pub(crate) async fn read_head<R: AsyncRead + Unpin>(
    reader: &mut R,
    buf: &mut BytesMut,
) -> std::io::Result<HeadResult> {
    loop {
        match try_parse_head(buf) {
            Err(()) => return Ok(HeadResult::Bad),
            Ok(Some((head, consumed))) => {
                buf.advance(consumed);
                return Ok(HeadResult::Head(head));
            }
            Ok(None) => {
                if reader.read_buf(buf).await? == 0 {
                    return Ok(HeadResult::Eof);
                }
            }
        }
    }
}

/// Read a fixed-length request body. `Ok(None)` means the body exceeds
/// `MAX_BODY_BYTES` or the connection ended early (caller sends 413 / closes).
pub(crate) async fn read_sized<R: AsyncRead + Unpin>(
    reader: &mut R,
    buf: &mut BytesMut,
    n: usize,
) -> std::io::Result<Option<Bytes>> {
    if n > MAX_BODY_BYTES {
        return Ok(None);
    }
    while buf.len() < n {
        if reader.read_buf(buf).await? == 0 {
            return Ok(None);
        }
    }
    let body = Bytes::copy_from_slice(&buf[..n]);
    buf.advance(n);
    Ok(Some(body))
}

/// Decode a `transfer-encoding: chunked` request body. `Ok(None)` on a
/// malformed body, an oversized body (`MAX_BODY_BYTES`), or early EOF — bounded
/// so a client that never terminates the body can't grow memory without limit.
pub(crate) async fn decode_chunked<R: AsyncRead + Unpin>(
    reader: &mut R,
    buf: &mut BytesMut,
) -> std::io::Result<Option<Bytes>> {
    let mut out = BytesMut::new();
    loop {
        // chunk-size line
        let line_end = loop {
            if let Some(pos) = find_crlf(buf) {
                break pos;
            }
            if buf.len() > MAX_HEADER_BYTES || reader.read_buf(buf).await? == 0 {
                return Ok(None);
            }
        };
        let size = {
            let line = std::str::from_utf8(&buf[..line_end]).unwrap_or("");
            let s = line.split(';').next().unwrap_or("").trim();
            match usize::from_str_radix(s, 16) {
                Ok(v) => v,
                Err(_) => return Ok(None),
            }
        };
        buf.advance(line_end + 2);
        if size == 0 {
            // trailer section: consume until the terminating blank line, bounded
            // by MAX_HEADER_BYTES.
            loop {
                if let Some(pos) = find_crlf(buf) {
                    buf.advance(pos + 2);
                    if pos == 0 {
                        return Ok(Some(out.freeze()));
                    }
                } else if buf.len() > MAX_HEADER_BYTES || reader.read_buf(buf).await? == 0 {
                    return Ok(None);
                }
            }
        }
        // Guard against overflow from a hostile chunk-size line.
        let need = match size.checked_add(2) {
            Some(v) if out.len().checked_add(size).map(|t| t <= MAX_BODY_BYTES).unwrap_or(false) => v,
            _ => return Ok(None),
        };
        while buf.len() < need {
            if reader.read_buf(buf).await? == 0 {
                return Ok(None);
            }
        }
        out.extend_from_slice(&buf[..size]);
        buf.advance(need); // chunk data + CRLF
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::pin::Pin;
    use std::task::{Context, Poll};
    use tokio::io::ReadBuf;

    /// In-memory `AsyncRead` that hands out the wire bytes in fixed-size slices
    /// (one per `poll_read`), so tests can exercise reads that straddle fill
    /// boundaries by varying `step`.
    struct ChunkedReader {
        pending: VecDeque<Vec<u8>>,
    }

    impl ChunkedReader {
        fn new(wire: &[u8], step: usize) -> Self {
            let step = step.max(1);
            ChunkedReader {
                pending: wire.chunks(step).map(|c| c.to_vec()).collect(),
            }
        }
    }

    impl AsyncRead for ChunkedReader {
        fn poll_read(
            mut self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
            rbuf: &mut ReadBuf<'_>,
        ) -> Poll<std::io::Result<()>> {
            // read_buf always offers >= 64 spare bytes, so for the small test
            // steps a slice fits; re-queue any remainder if it ever doesn't.
            if let Some(mut slice) = self.pending.pop_front() {
                let n = slice.len().min(rbuf.remaining());
                rbuf.put_slice(&slice[..n]);
                if n < slice.len() {
                    slice.drain(..n);
                    self.pending.push_front(slice);
                }
            }
            Poll::Ready(Ok(()))
        }
    }

    async fn decode(wire: &[u8], step: usize) -> Option<Vec<u8>> {
        let mut reader = ChunkedReader::new(wire, step);
        let mut buf = BytesMut::new();
        decode_chunked(&mut reader, &mut buf)
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
        let mut reader = ChunkedReader::new(b"hello world", 2);
        let mut buf = BytesMut::new();
        let body = read_sized(&mut reader, &mut buf, 11).await.unwrap();
        assert_eq!(body.as_deref(), Some(&b"hello world"[..]));
    }

    #[tokio::test]
    async fn read_sized_over_limit_rejected() {
        let mut reader = ChunkedReader::new(b"x", 1);
        let mut buf = BytesMut::new();
        assert_eq!(
            read_sized(&mut reader, &mut buf, MAX_BODY_BYTES + 1).await.unwrap(),
            None
        );
    }

    // ---- request-smuggling / framing-conflict rejection (H6) ----

    fn parse_ok(raw: &[u8]) -> ReqHead {
        match try_parse_head(raw) {
            Ok(Some((h, _))) => h,
            other => panic!("expected a parsed head, got {:?}", other.is_err()),
        }
    }
    fn parse_rejected(raw: &[u8]) -> bool {
        matches!(try_parse_head(raw), Err(()))
    }

    #[test]
    fn cl_and_te_together_rejected() {
        assert!(parse_rejected(
            b"POST /s HTTP/1.1\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\n\r\n"
        ));
    }
    #[test]
    fn duplicate_content_length_rejected() {
        assert!(parse_rejected(
            b"POST /s HTTP/1.1\r\nContent-Length: 0\r\nContent-Length: 5\r\n\r\n"
        ));
    }
    #[test]
    fn non_numeric_content_length_rejected() {
        assert!(parse_rejected(b"POST /s HTTP/1.1\r\nContent-Length: 5x\r\n\r\n"));
    }
    #[test]
    fn non_chunked_transfer_encoding_rejected() {
        assert!(parse_rejected(b"POST /s HTTP/1.1\r\nTransfer-Encoding: gzip\r\n\r\n"));
        // substring `chunked` must not satisfy the framing check
        assert!(parse_rejected(b"POST /s HTTP/1.1\r\nTransfer-Encoding: x-chunked\r\n\r\n"));
    }
    #[test]
    fn plain_chunked_and_single_cl_accepted() {
        let h = parse_ok(b"POST /s HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n");
        assert!(h.chunked && h.content_length.is_none());
        let h = parse_ok(b"POST /s HTTP/1.1\r\nContent-Length: 5\r\n\r\n");
        assert!(!h.chunked && h.content_length == Some(5));
    }
}
