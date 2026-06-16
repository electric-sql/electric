// Minimal HTTP/1.1 engine ("raw"): tokio + httparse, no framework.
//
// Owning the socket lets this engine serve Body::FileRange without going
// through userspace buffer abstractions — on Linux via sendfile(2) (the
// kernel copies page cache → socket directly), elsewhere via positioned
// reads. Supports keep-alive, content-length and chunked request bodies,
// Expect: 100-continue, and chunked streaming responses (SSE).
//
// sendfile blocks the calling thread on a page-cache miss (Linux has no async
// buffered-file I/O without io_uring). A FileRange served inline runs sendfile
// on the async worker — perfect when the data is resident (the hot tail), but
// a disk fault stalls the worker (head-of-line blocking for every connection on
// its run queue). Served via the blocking pool, sendfile still does the same
// zero-copy page-cache → socket transfer, but a fault parks a pool thread
// instead. ReadOffload picks where each read runs; see set_read_offload.

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

use bytes::{Buf, BufMut, Bytes, BytesMut};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::api::{status_reason, Body, Method, Req, Resp, MAX_BODY_BYTES};
use crate::handlers;
use crate::store::{Segment, Store};

const MAX_HEADER_BYTES: usize = 64 * 1024;

/// Where the raw engine runs sendfile for a FileRange read.
///
/// A live tail feed (`hot`) is always page-cache resident, so every mode serves
/// it inline; the modes differ only in how they treat catch-up reads, which may
/// fault on disk. `Inline` and `Always` are the endpoints (never / always
/// offload to the blocking pool) — useful baselines for benchmarking. `Tail`
/// is the default: keep the live tail inline (fast) and offload catch-up reads,
/// so a cold backfill's disk fault parks a pool thread instead of an async
/// worker.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ReadOffload {
    /// Never use the blocking pool (sendfile inline on the async worker).
    Inline,
    /// Live tail inline; catch-up reads on the blocking pool. (default)
    Tail,
    /// Always use the blocking pool.
    Always,
}

impl ReadOffload {
    pub fn parse(s: &str) -> Option<ReadOffload> {
        match s {
            "inline" => Some(ReadOffload::Inline),
            "tail" => Some(ReadOffload::Tail),
            "always" => Some(ReadOffload::Always),
            _ => None,
        }
    }
}

static READ_OFFLOAD: AtomicU8 = AtomicU8::new(ReadOffload::Tail as u8);

/// Set the read-offload strategy (process-global). Called once at startup.
pub fn set_read_offload(mode: ReadOffload) {
    READ_OFFLOAD.store(mode as u8, Ordering::Relaxed);
}

#[cfg(target_os = "linux")]
fn read_offload() -> ReadOffload {
    match READ_OFFLOAD.load(Ordering::Relaxed) {
        x if x == ReadOffload::Inline as u8 => ReadOffload::Inline,
        x if x == ReadOffload::Always as u8 => ReadOffload::Always,
        _ => ReadOffload::Tail,
    }
}

pub async fn serve(store: Arc<Store>, listener: TcpListener) {
    loop {
        let (stream, _) = match listener.accept().await {
            Ok(s) => s,
            Err(_) => continue,
        };
        let _ = stream.set_nodelay(true);
        let store = store.clone();
        tokio::spawn(async move {
            let _ = conn_loop(store, stream).await;
        });
    }
}

struct ReqHead {
    method: Method,
    is_head: bool,
    path: String,
    query: Option<String>,
    headers: Vec<(String, String)>,
    content_length: Option<usize>,
    chunked: bool,
    expect_continue: bool,
    keep_alive: bool,
}

/// Try to parse a complete request head from `buf`; returns the head and the
/// number of bytes it consumed.
fn try_parse_head(buf: &[u8]) -> Result<Option<(ReqHead, usize)>, ()> {
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

async fn read_more(stream: &mut TcpStream, buf: &mut BytesMut) -> std::io::Result<bool> {
    Ok(stream.read_buf(buf).await? > 0)
}

/// Read `n` body bytes (some may already be buffered).
async fn read_sized_body(
    stream: &mut TcpStream,
    buf: &mut BytesMut,
    n: usize,
) -> std::io::Result<Option<Bytes>> {
    if n > MAX_BODY_BYTES {
        return Ok(None);
    }
    while buf.len() < n {
        if !read_more(stream, buf).await? {
            return Ok(None);
        }
    }
    Ok(Some(buf.split_to(n).freeze()))
}

/// Decode a chunked request body.
async fn read_chunked_body(
    stream: &mut TcpStream,
    buf: &mut BytesMut,
) -> std::io::Result<Option<Bytes>> {
    let mut out = BytesMut::new();
    loop {
        // Find the size line.
        let line_end = loop {
            if let Some(pos) = find_crlf(buf) {
                break pos;
            }
            if buf.len() > MAX_HEADER_BYTES || !read_more(stream, buf).await? {
                return Ok(None);
            }
        };
        let size_str = std::str::from_utf8(&buf[..line_end]).unwrap_or("");
        let size_str = size_str.split(';').next().unwrap_or("").trim();
        let size = match usize::from_str_radix(size_str, 16) {
            Ok(s) => s,
            Err(_) => return Ok(None),
        };
        buf.advance(line_end + 2);
        if size == 0 {
            // Trailer section: consume until blank line. Bounded by
            // MAX_HEADER_BYTES so a client that sends `0\r\n` then an endless
            // stream that never forms the terminating blank line can't grow
            // `buf` without limit (OOM / DoS).
            loop {
                if let Some(pos) = find_crlf(buf) {
                    buf.advance(pos + 2);
                    if pos == 0 {
                        return Ok(Some(out.freeze()));
                    }
                } else if buf.len() > MAX_HEADER_BYTES || !read_more(stream, buf).await? {
                    return Ok(None);
                }
            }
        }
        // Guard against overflow from a hostile chunk-size line.
        let need = match size.checked_add(2) {
            Some(n) if out.len().checked_add(size).map(|t| t <= MAX_BODY_BYTES).unwrap_or(false) => n,
            _ => return Ok(None),
        };
        while buf.len() < need {
            if !read_more(stream, buf).await? {
                return Ok(None);
            }
        }
        out.put_slice(&buf[..size]);
        buf.advance(need); // chunk data + CRLF
    }
}

fn find_crlf(buf: &[u8]) -> Option<usize> {
    buf.windows(2).position(|w| w == b"\r\n")
}

async fn conn_loop(store: Arc<Store>, mut stream: TcpStream) -> std::io::Result<()> {
    let mut buf = BytesMut::with_capacity(16 * 1024);
    loop {
        // ---- read request head ----
        let (head, consumed) = loop {
            match try_parse_head(&buf) {
                Err(()) => {
                    let _ = stream
                        .write_all(b"HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
                        .await;
                    return Ok(());
                }
                Ok(Some(parsed)) => break parsed,
                Ok(None) => {
                    if !read_more(&mut stream, &mut buf).await? {
                        return Ok(()); // clean EOF between requests
                    }
                }
            }
        };
        buf.advance(consumed);

        if head.expect_continue {
            stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").await?;
        }

        // ---- read request body ----
        let body = if head.chunked {
            match read_chunked_body(&mut stream, &mut buf).await? {
                Some(b) => b,
                None => {
                    let _ = stream
                        .write_all(b"HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
                        .await;
                    return Ok(());
                }
            }
        } else {
            match head.content_length.unwrap_or(0) {
                0 => Bytes::new(),
                n => match read_sized_body(&mut stream, &mut buf, n).await? {
                    Some(b) => b,
                    None => {
                        let _ = stream
                            .write_all(b"HTTP/1.1 413 Payload Too Large\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
                            .await;
                        return Ok(());
                    }
                },
            }
        };

        let keep_alive = head.keep_alive;
        let is_head = head.is_head;
        let req = Req {
            method: head.method,
            path: head.path,
            query: head.query,
            headers: head.headers,
            body,
        };
        let resp = handlers::handle(store.clone(), req).await;
        write_response(&mut stream, resp, is_head, keep_alive).await?;
        if !keep_alive {
            return Ok(());
        }
    }
}

async fn write_response(
    stream: &mut TcpStream,
    resp: Resp,
    is_head: bool,
    keep_alive: bool,
) -> std::io::Result<()> {
    let status = resp.status;
    let no_body_status = status == 204 || status == 304 || (100..200).contains(&status);
    let mut head = BytesMut::with_capacity(512);
    head.put_slice(b"HTTP/1.1 ");
    head.put_slice(status.to_string().as_bytes());
    head.put_u8(b' ');
    head.put_slice(status_reason(status).as_bytes());
    head.put_slice(b"\r\n");
    for (k, v) in &resp.headers {
        head.put_slice(k.as_bytes());
        head.put_slice(b": ");
        head.put_slice(v.as_bytes());
        head.put_slice(b"\r\n");
    }
    for (k, v) in crate::api::SECURITY_HEADERS {
        head.put_slice(k.as_bytes());
        head.put_slice(b": ");
        head.put_slice(v.as_bytes());
        head.put_slice(b"\r\n");
    }
    let body_len = resp.body.len();
    let chunked = body_len.is_none();
    if !no_body_status {
        match body_len {
            Some(n) => {
                head.put_slice(b"content-length: ");
                head.put_slice(n.to_string().as_bytes());
                head.put_slice(b"\r\n");
            }
            None => head.put_slice(b"transfer-encoding: chunked\r\n"),
        }
    }
    if !keep_alive {
        head.put_slice(b"connection: close\r\n");
    }
    head.put_slice(b"\r\n");

    if is_head || no_body_status {
        stream.write_all(&head).await?;
        return Ok(());
    }

    match resp.body {
        Body::Empty => {
            stream.write_all(&head).await?;
        }
        Body::Full(b) => {
            // Coalesce head + small bodies into one write.
            if b.len() <= 64 * 1024 {
                head.put_slice(&b);
                stream.write_all(&head).await?;
            } else {
                stream.write_all(&head).await?;
                stream.write_all(&b).await?;
            }
        }
        Body::FileRange {
            segments,
            prefix,
            suffix,
            hot,
        } => {
            head.put_slice(prefix);
            stream.write_all(&head).await?;
            write_segments(stream, segments, hot).await?;
            if !suffix.is_empty() {
                stream.write_all(suffix).await?;
            }
        }
        Body::Channel(mut rx) => {
            stream.write_all(&head).await?;
            debug_assert!(chunked);
            let mut frame = BytesMut::with_capacity(8 * 1024);
            while let Some(b) = rx.recv().await {
                frame.clear();
                frame.put_slice(format!("{:x}\r\n", b.len()).as_bytes());
                frame.put_slice(&b);
                frame.put_slice(b"\r\n");
                stream.write_all(&frame).await?;
            }
            stream.write_all(b"0\r\n\r\n").await?;
        }
    }
    Ok(())
}

/// Serve a FileRange body's segments, choosing where sendfile runs per the
/// configured ReadOffload strategy. `hot` marks a live tail feed (freshly
/// appended, page-cache resident). Non-Linux always uses the inline (buffered)
/// fallback — there is no sendfile there and the pool buys nothing.
async fn write_segments(
    stream: &mut TcpStream,
    segments: Vec<Segment>,
    hot: bool,
) -> std::io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        let pool = match read_offload() {
            ReadOffload::Inline => false,
            ReadOffload::Always => true,
            // A live tail feed is resident, so inline either way; a catch-up
            // read may be cold, so offload it to the pool.
            ReadOffload::Tail => !hot,
        };
        if pool {
            return write_segments_blocking(stream, segments).await;
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = hot;
    for seg in &segments {
        write_segment(stream, seg).await?;
    }
    Ok(())
}

/// Serve segments with sendfile(2) on the blocking pool.
///
/// We dup the socket fd into an OwnedFd moved into the blocking task. sendfile
/// blocks the pool thread on a page-cache miss (the whole point: the async
/// worker stays free) and the dup keeps the socket alive even if this future is
/// cancelled mid-write while the detached task is still running — so the task
/// can never write to a recycled, unrelated fd. The dup shares O_NONBLOCK with
/// the original tokio socket, so the loop waits on POLLOUT for backpressure.
#[cfg(target_os = "linux")]
async fn write_segments_blocking(
    stream: &mut TcpStream,
    segments: Vec<Segment>,
) -> std::io::Result<()> {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    let dup = unsafe {
        let fd = libc::dup(stream.as_raw_fd());
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        OwnedFd::from_raw_fd(fd)
    };
    let join = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let sock_fd = dup.as_raw_fd();
        for seg in &segments {
            blocking_sendfile(sock_fd, seg)?;
        }
        Ok(()) // dup dropped here → closed
    })
    .await;
    match join {
        Ok(inner) => inner,
        Err(e) => Err(std::io::Error::other(e)),
    }
}

/// Blocking sendfile loop for one segment over a (possibly nonblocking) fd.
#[cfg(target_os = "linux")]
fn blocking_sendfile(sock_fd: std::os::fd::RawFd, seg: &Segment) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    if seg.len == 0 {
        return Ok(());
    }
    let file_fd = seg.file.as_raw_fd();
    let mut offset = seg.file_start as libc::off_t;
    let end = seg.file_end() as libc::off_t;
    while offset < end {
        let count = (end - offset) as usize;
        let sent = unsafe { libc::sendfile(sock_fd, file_fd, &mut offset, count) };
        if sent < 0 {
            let err = std::io::Error::last_os_error();
            match err.raw_os_error() {
                Some(libc::EINTR) => continue,
                // EAGAIN == EWOULDBLOCK on Linux: the dup inherits O_NONBLOCK, so
                // wait for the socket to drain before retrying.
                Some(libc::EAGAIN) => {
                    wait_writable(sock_fd)?;
                    continue;
                }
                _ => return Err(err),
            }
        }
        if sent == 0 {
            // No progress with bytes pending (e.g. file truncated under us).
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "sendfile made no progress",
            ));
        }
    }
    Ok(())
}

/// Block until the socket is writable (POLLOUT), retrying on EINTR.
#[cfg(target_os = "linux")]
fn wait_writable(sock_fd: std::os::fd::RawFd) -> std::io::Result<()> {
    let mut pfd = libc::pollfd {
        fd: sock_fd,
        events: libc::POLLOUT,
        revents: 0,
    };
    loop {
        let r = unsafe { libc::poll(&mut pfd, 1, -1) };
        if r < 0 {
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() == Some(libc::EINTR) {
                continue;
            }
            return Err(err);
        }
        return Ok(());
    }
}

/// Serve one file segment to the socket.
///
/// Linux: sendfile(2) — the kernel copies page cache → socket directly, no
/// userspace buffer — driven by write readiness on the nonblocking socket.
#[cfg(target_os = "linux")]
async fn write_segment(stream: &mut TcpStream, seg: &Segment) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    if seg.len == 0 {
        return Ok(());
    }
    let file_fd = seg.file.as_raw_fd();
    let mut offset = seg.file_start as libc::off_t;
    let end = seg.file_end() as libc::off_t;
    while offset < end {
        stream.writable().await?;
        let count = (end - offset) as usize;
        let res = stream.try_io(tokio::io::Interest::WRITABLE, || {
            let sent =
                unsafe { libc::sendfile(stream.as_raw_fd(), file_fd, &mut offset, count) };
            if sent < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(sent)
            }
        });
        match res {
            // sendfile advances `offset` by the bytes sent. A 0 return with
            // bytes still pending means no progress is possible (e.g. the file
            // was truncated under us) — stop rather than spin forever.
            Ok(0) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "sendfile made no progress",
                ))
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

/// Portable fallback: positioned reads through a reusable buffer.
#[cfg(not(target_os = "linux"))]
async fn write_segment(stream: &mut TcpStream, seg: &Segment) -> std::io::Result<()> {
    use std::os::unix::fs::FileExt;
    if seg.len == 0 {
        return Ok(());
    }
    const CHUNK: usize = 256 * 1024;
    let mut pos = seg.file_start;
    let end = seg.file_end();
    let mut buf = vec![0u8; CHUNK.min(seg.len as usize)];
    while pos < end {
        let n = ((end - pos) as usize).min(CHUNK);
        seg.file.read_exact_at(&mut buf[..n], pos)?;
        stream.write_all(&buf[..n]).await?;
        pos += n as u64;
    }
    Ok(())
}
