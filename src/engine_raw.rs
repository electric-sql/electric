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

use bytes::{Buf, Bytes, BytesMut};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::api::{Body, Req, Resp};
use crate::handlers;
use crate::http1;
use crate::store::{Segment, Store};

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

/// Adapts a tokio `TcpStream` + reusable `BytesMut` to the shared `ByteSource`
/// request reader. Reads land directly in the `BytesMut`'s spare capacity.
struct RawSource<'a> {
    stream: &'a mut TcpStream,
    buf: &'a mut BytesMut,
}

impl http1::ByteSource for RawSource<'_> {
    fn buffered(&self) -> &[u8] {
        self.buf
    }
    fn consume(&mut self, n: usize) {
        self.buf.advance(n);
    }
    async fn fill(&mut self) -> std::io::Result<bool> {
        Ok(self.stream.read_buf(self.buf).await? > 0)
    }
}

async fn conn_loop(store: Arc<Store>, mut stream: TcpStream) -> std::io::Result<()> {
    const BAD_REQUEST: &[u8] =
        b"HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\nconnection: close\r\n\r\n";
    const TOO_LARGE: &[u8] =
        b"HTTP/1.1 413 Payload Too Large\r\ncontent-length: 0\r\nconnection: close\r\n\r\n";
    let mut buf = BytesMut::with_capacity(16 * 1024);
    loop {
        // ---- read request head ---- (Source scoped so `stream` is free to
        // write the response / error once the read phase ends.)
        let head = {
            let mut src = RawSource {
                stream: &mut stream,
                buf: &mut buf,
            };
            match http1::read_head(&mut src).await? {
                http1::HeadResult::Eof => return Ok(()),
                http1::HeadResult::Bad => {
                    let _ = stream.write_all(BAD_REQUEST).await;
                    return Ok(());
                }
                http1::HeadResult::Head(h) => h,
            }
        };

        if head.expect_continue {
            stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").await?;
        }

        // ---- read request body ----
        let body = if head.chunked {
            let decoded = {
                let mut src = RawSource {
                    stream: &mut stream,
                    buf: &mut buf,
                };
                http1::decode_chunked(&mut src).await?
            };
            match decoded {
                Some(b) => b,
                None => {
                    let _ = stream.write_all(BAD_REQUEST).await;
                    return Ok(());
                }
            }
        } else {
            match head.content_length.unwrap_or(0) {
                0 => Bytes::new(),
                n => {
                    let read = {
                        let mut src = RawSource {
                            stream: &mut stream,
                            buf: &mut buf,
                        };
                        http1::read_sized(&mut src, n).await?
                    };
                    match read {
                        Some(b) => b,
                        None => {
                            let _ = stream.write_all(TOO_LARGE).await;
                            return Ok(());
                        }
                    }
                }
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
    let body_len = resp.body.len();
    let mut head: Vec<u8> = Vec::with_capacity(512);
    http1::write_head(&mut head, status, &resp.headers, body_len, keep_alive);

    if is_head || http1::status_has_no_body(status) {
        stream.write_all(&head).await?;
        return Ok(());
    }

    match resp.body {
        Body::Empty => {
            stream.write_all(&head).await?;
        }
        Body::Full(b) => {
            // Coalesce head + small bodies into one write.
            if b.len() <= http1::COALESCE_MAX {
                head.extend_from_slice(&b);
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
            head.extend_from_slice(prefix);
            stream.write_all(&head).await?;
            write_segments(stream, segments, hot).await?;
            if !suffix.is_empty() {
                stream.write_all(suffix).await?;
            }
        }
        Body::Channel(mut rx) => {
            stream.write_all(&head).await?;
            debug_assert!(body_len.is_none());
            let mut frame: Vec<u8> = Vec::with_capacity(8 * 1024);
            while let Some(b) = rx.recv().await {
                frame.clear();
                http1::frame_chunk(&mut frame, &b);
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
    // Time spent queued before the blocking task actually starts — the
    // blocking-pool wait, the cold-read / futex pressure signal.
    let queued = crate::telemetry::Timer::start();
    let join = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        crate::telemetry::record_offload_wait(queued.elapsed_secs());
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
