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

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;

use bytes::{Bytes, BytesMut};
use tokio::io::AsyncWriteExt;
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

/// Zero-copy binary-append fast path toggle (off by default → behaviour
/// identical to the read+write path). Set once at startup via --splice-appends;
/// only takes effect on Linux for binary (non-JSON) streams.
static SPLICE_APPENDS: AtomicBool = AtomicBool::new(false);

/// Enable/disable the splice(2) binary-append fast path (process-global).
pub fn set_splice_appends(on: bool) {
    SPLICE_APPENDS.store(on, Ordering::Relaxed);
}

#[cfg(target_os = "linux")]
fn splice_appends() -> bool {
    SPLICE_APPENDS.load(Ordering::Relaxed)
}

/// Bound concurrent connections so a flood can't exhaust fds/memory. (A per-
/// connection idle/slowloris timeout is intentionally NOT a per-request
/// `tokio::time::timeout` — that cost ~5% hot-path CPU in a keep-alive workload;
/// it belongs in a background idle-reaper, a follow-up.)
const MAX_CONNECTIONS: usize = 65_536;

/// Process-global connection limiter, shared by `serve` (acquire per connection)
/// and `drain` (acquire all permits to wait for in-flight connections to finish).
fn conn_limiter() -> &'static Arc<tokio::sync::Semaphore> {
    static SEMA: std::sync::OnceLock<Arc<tokio::sync::Semaphore>> = std::sync::OnceLock::new();
    SEMA.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(MAX_CONNECTIONS)))
}

/// Wait up to `grace` for in-flight connections to finish (best-effort drain on
/// shutdown). Acquiring all permits succeeds only once every connection task has
/// released its permit.
pub async fn drain(grace: std::time::Duration) {
    let sema = conn_limiter();
    let _ = tokio::time::timeout(grace, sema.acquire_many(MAX_CONNECTIONS as u32)).await;
}

pub async fn serve(store: Arc<Store>, listener: TcpListener) {
    let conns = conn_limiter().clone();
    loop {
        let (stream, _) = match listener.accept().await {
            Ok(s) => s,
            Err(e) => {
                // Back off instead of busy-looping. fd exhaustion (EMFILE/ENFILE —
                // the per-process / system open-file limit, commonly the default
                // `ulimit -n` of 1024) would otherwise spin this loop at ~100% CPU,
                // accepting nothing and starving the runtime — including health
                // checks — until load drops. That is the "hangs above ~1024
                // connections and doesn't recover" failure. Sleeping frees the core
                // and lets in-flight connections close and release fds.
                let fd_exhausted =
                    matches!(e.raw_os_error(), Some(libc::EMFILE) | Some(libc::ENFILE));
                let backoff = if fd_exhausted {
                    std::time::Duration::from_millis(50)
                } else {
                    std::time::Duration::from_millis(5)
                };
                tokio::time::sleep(backoff).await;
                continue;
            }
        };
        let _ = stream.set_nodelay(true);
        // At capacity: drop the new connection rather than queue unboundedly.
        let Ok(permit) = conns.clone().try_acquire_owned() else {
            continue;
        };
        let store = store.clone();
        tokio::spawn(async move {
            let _permit = permit; // released when the connection ends
            let _ = conn_loop(store, stream).await;
        });
    }
}

async fn conn_loop(store: Arc<Store>, mut stream: TcpStream) -> std::io::Result<()> {
    const BAD_REQUEST: &[u8] =
        b"HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\nconnection: close\r\n\r\n";
    const TOO_LARGE: &[u8] =
        b"HTTP/1.1 413 Payload Too Large\r\ncontent-length: 0\r\nconnection: close\r\n\r\n";
    let mut buf = BytesMut::with_capacity(16 * 1024);
    loop {
        // ---- read request head ----
        let head = match http1::read_head(&mut stream, &mut buf).await? {
            http1::HeadResult::Eof => return Ok(()),
            http1::HeadResult::Bad => {
                let _ = stream.write_all(BAD_REQUEST).await;
                return Ok(());
            }
            http1::HeadResult::Head(h) => h,
        };

        // Reject an over-limit declared body before sending 100-continue or
        // reading anything (RFC 9110 §10.1.1 permits a 4xx instead of 100).
        if head.content_length.is_some_and(|n| n > crate::api::MAX_BODY_BYTES) {
            let _ = stream.write_all(TOO_LARGE).await;
            return Ok(());
        }
        if head.expect_continue {
            stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").await?;
        }

        // ---- binary-append splice fast path (Linux, opt-in) ----
        // Eligible: POST with a fixed content-length body, not chunked, no
        // Expect: 100-continue (already handled above is fine, but we keep it
        // simple and skip those), and the splice toggle on. The handler decides
        // whether the *stream* qualifies (binary, exists, not a dup) and either
        // commits via splice, falls back, or rejects.
        #[cfg(target_os = "linux")]
        if splice_appends()
            && head.method == crate::api::Method::Post
            && !head.chunked
            && !head.expect_continue
        {
            if let Some(clen) = head.content_length {
                match try_splice_append(&store, &mut stream, &mut buf, &head, clen).await? {
                    SpliceOutcome::Done { keep_alive } => {
                        if !keep_alive {
                            return Ok(());
                        }
                        continue;
                    }
                    SpliceOutcome::Reject => return Ok(()),
                    SpliceOutcome::Fallback => { /* body untouched; fall through */ }
                }
            }
        }

        // ---- read request body ----
        let body = if head.chunked {
            match http1::decode_chunked(&mut stream, &mut buf).await? {
                Some(b) => b,
                None => {
                    let _ = stream.write_all(BAD_REQUEST).await;
                    return Ok(());
                }
            }
        } else {
            match head.content_length.unwrap_or(0) {
                0 => Bytes::new(),
                n => match http1::read_sized(&mut stream, &mut buf, n).await? {
                    Some(b) => b,
                    None => {
                        let _ = stream.write_all(TOO_LARGE).await;
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
        Body::Channel(crate::api::StreamBody { mut rx, failed }) => {
            stream.write_all(&head).await?;
            debug_assert!(body_len.is_none());
            let mut frame: Vec<u8> = Vec::with_capacity(8 * 1024);
            while let Some(b) = rx.recv().await {
                frame.clear();
                http1::frame_chunk(&mut frame, &b);
                stream.write_all(&frame).await?;
            }
            if failed.load(std::sync::atomic::Ordering::Acquire) {
                // The body ended early due to a backend error. Abort: omit the
                // terminating chunk and return an error so the connection drops —
                // the client sees an incomplete transfer, never a clean-but-
                // truncated 200. (See api::StreamBody / BUG-1.)
                return Err(std::io::Error::other("read aborted mid-stream"));
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

// ---------------- binary-append splice fast path (Linux) ----------------

#[cfg(target_os = "linux")]
enum SpliceOutcome {
    /// Append committed via splice; `keep_alive` carries the connection decision.
    Done { keep_alive: bool },
    /// A response was written but the body was NOT consumed (producer dup,
    /// closed, etc.) — the connection must close.
    Reject,
    /// Stream not splice-eligible; the caller reads the body normally.
    Fallback,
}

/// Attempt the zero-copy binary append. Hands the handler a callback that, under
/// the appender lock, writes any over-read (prebuffered) body bytes then splices
/// the rest of the body from the socket into the file — exactly `clen` body
/// bytes total. On Fallback nothing is read from the socket body, so the normal
/// path stays valid.
#[cfg(target_os = "linux")]
async fn try_splice_append(
    store: &Arc<Store>,
    stream: &mut TcpStream,
    buf: &mut BytesMut,
    head: &http1::ReqHead,
    clen: usize,
) -> std::io::Result<SpliceOutcome> {
    use crate::handlers::{self, BeginResult, BinaryAppendReq};

    let req = BinaryAppendReq {
        content_length: clen as u64,
        headers: head.headers.clone(),
    };

    // The over-read: head parsing may have pulled body bytes into `buf`. Take up
    // to `clen` of them; the rest comes off the socket via splice. We move them
    // out of `buf` here (advance) so the buffer is clean for the next request.
    let prebuffered_len = buf.len().min(clen);
    let prebuffered = buf.split_to(prebuffered_len).freeze();

    // The splice callback borrows the socket only as `&TcpStream` (shared — it
    // needs readiness + the raw fd, never a mutable op), which keeps the
    // connection future `Send` (a `&mut` / raw pointer would not be). `stream`
    // is otherwise untouched while the splice runs (awaited to completion below)
    // and reused only to write the response. `prebuffered` is cloned (a refcount
    // bump) for the closure so the Fallback branch — where the closure never
    // runs — can restore the original bytes to `buf`.
    let sock = &*stream;
    let pre_for_splice = prebuffered.clone();
    let result = handlers::try_binary_append_splice(
        store.clone(),
        head.path.clone(),
        req,
        (),
        move |file_path, offset| async move {
            splice_body_to_file(sock, pre_for_splice, clen, file_path, offset).await
        },
    )
    .await;

    match result {
        BeginResult::Done(resp) => {
            let keep_alive = head.keep_alive;
            write_response(stream, resp, false, keep_alive).await?;
            Ok(SpliceOutcome::Done { keep_alive })
        }
        BeginResult::Reject(resp) => {
            // Body not consumed → close the connection (framing is unknown).
            write_response(stream, resp, false, false).await?;
            Ok(SpliceOutcome::Reject)
        }
        BeginResult::Fallback(()) => {
            // Put the prebuffered body bytes back at the front of `buf` so the
            // normal read path sees the full body again.
            if !prebuffered.is_empty() {
                let mut restored = BytesMut::with_capacity(prebuffered.len() + buf.len());
                restored.extend_from_slice(&prebuffered);
                restored.extend_from_slice(buf);
                *buf = restored;
            }
            Ok(SpliceOutcome::Fallback)
        }
    }
}

/// Write `prebuffered` body bytes to the file at `offset`, then move the
/// remaining `clen - prebuffered.len()` body bytes from socket → pipe → file at
/// the following offset with splice(2). Opens a FRESH O_WRONLY (non-append) fd
/// to `file_path`: splice(2) refuses an O_APPEND target (EINVAL), and the
/// positioned write needs a real offset, so the shared O_APPEND data fd can't be
/// used. The explicit offset is safe — the caller holds the per-stream appender
/// lock.
///
/// The socket leg is driven *inline* on the async worker via tokio readiness
/// (`stream.readable().await` + `try_io`): the worker parks (yields to other
/// tasks) whenever the socket has no data, so a slow/large upload never
/// monopolizes it — and no per-request blocking-pool handoff / fd dup. The
/// file-write leg is a fast page-cache copy done synchronously between socket
/// reads. Consumes exactly `clen` body bytes from the socket, so keep-alive /
/// pipelining stay correctly framed.
#[cfg(target_os = "linux")]
async fn splice_body_to_file(
    stream: &TcpStream,
    prebuffered: Bytes,
    clen: usize,
    file_path: std::path::PathBuf,
    offset: u64,
) -> std::io::Result<()> {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::fs::FileExt;

    // Fresh non-append fd for splice (explicit-offset writes).
    let out = std::fs::OpenOptions::new().write(true).open(&file_path)?;
    let file_fd = out.as_raw_fd();
    let mut file_off = offset;

    // The over-read prefix is already in userspace — positioned write, no splice.
    if !prebuffered.is_empty() {
        out.write_all_at(&prebuffered, file_off)?;
        file_off += prebuffered.len() as u64;
    }
    let mut remaining = clen - prebuffered.len();
    if remaining == 0 {
        return Ok(());
    }

    // Kernel pipe pair: splice cannot go fd→fd directly, only via a pipe buffer.
    let mut fds = [0i32; 2];
    let r = unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC) };
    if r != 0 {
        return Err(std::io::Error::last_os_error());
    }
    let pipe_r = unsafe { OwnedFd::from_raw_fd(fds[0]) };
    let pipe_w = unsafe { OwnedFd::from_raw_fd(fds[1]) };
    let pipe_r = pipe_r.as_raw_fd();
    let pipe_w = pipe_w.as_raw_fd();
    let sock_fd = stream.as_raw_fd();

    const CHUNK: usize = 1 << 20; // 1 MiB per splice request
    while remaining > 0 {
        let want = remaining.min(CHUNK);
        // Leg 1: socket → pipe, on the async worker via readiness. A WouldBlock
        // parks this task on the socket (worker stays free) instead of spinning.
        let in_pipe = loop {
            stream.readable().await?;
            let res = stream.try_io(tokio::io::Interest::READABLE, || {
                let n = unsafe {
                    libc::splice(
                        sock_fd,
                        std::ptr::null_mut(),
                        pipe_w,
                        std::ptr::null_mut(),
                        want,
                        libc::SPLICE_F_MOVE | libc::SPLICE_F_MORE,
                    )
                };
                if n < 0 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(n as usize)
                }
            });
            match res {
                Ok(0) => {
                    // Peer closed before sending the full content-length body.
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        "client closed before full body",
                    ));
                }
                Ok(n) => break n,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
                Err(e) if e.raw_os_error() == Some(libc::EINTR) => continue,
                Err(e) => return Err(e),
            }
        };

        // Leg 2: pipe → file at the explicit offset (page-cache copy; fast).
        // Drain the whole pipe chunk before refilling.
        let mut left = in_pipe;
        while left > 0 {
            let mut off_out = file_off as libc::loff_t;
            let n = unsafe {
                libc::splice(
                    pipe_r,
                    std::ptr::null_mut(),
                    file_fd,
                    &mut off_out,
                    left,
                    libc::SPLICE_F_MOVE | libc::SPLICE_F_MORE,
                )
            };
            if n < 0 {
                let err = std::io::Error::last_os_error();
                match err.raw_os_error() {
                    Some(libc::EINTR) | Some(libc::EAGAIN) => continue,
                    _ => return Err(err),
                }
            }
            if n == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::WriteZero,
                    "splice to file made no progress",
                ));
            }
            let n = n as usize;
            file_off += n as u64;
            left -= n;
        }
        remaining -= in_pipe;
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
