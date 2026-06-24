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

#[cfg(target_os = "linux")]
use std::sync::atomic::AtomicBool;
use std::sync::atomic::{AtomicU8, Ordering};
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

/// Process-global `--zero-copy` toggle. When on (Linux only), eligible binary
/// appends are served via the splice page-cache relay and the tail cache is off.
#[cfg(target_os = "linux")]
static ZERO_COPY: AtomicBool = AtomicBool::new(false);

/// Enable/disable the zero-copy append path (process-global).
#[cfg(target_os = "linux")]
pub fn set_zero_copy(on: bool) {
    ZERO_COPY.store(on, Ordering::Relaxed);
}

/// Whether the zero-copy append path is active.
#[cfg(target_os = "linux")]
#[inline]
pub fn zero_copy() -> bool {
    ZERO_COPY.load(Ordering::Relaxed)
}

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
        // Cap the kernel socket buffers. An idle keep-alive connection — most
        // visibly an SSE subscriber that sent one tiny GET and receives small
        // events — otherwise pins the autotuned TCP receive buffer, whose Linux
        // default is ~128 KiB and which is charged to the process/cgroup. With
        // ~40k subscribers that kernel memory, not the ~27 KiB of Rust per-conn
        // heap, dominates RSS and drives the OOM. A fixed 64 KiB recv / 64 KiB
        // send buffer is still ample for this server's traffic: SSE is receive-
        // light, and the sendfile upload+download paths read/write in
        // large chunks driven by socket readiness, so a 64 KiB kernel queue keeps
        // a normal link saturated — we only forgo autotuning's growth into the
        // MiB range, which is what bloats idle connections. Best-effort: clamped
        // by net.core.{r,w}mem_max and a no-op where unsupported.
        #[cfg(target_os = "linux")]
        {
            use std::os::fd::AsRawFd;
            const SOCK_BUF: libc::c_int = 64 * 1024;
            let fd = stream.as_raw_fd();
            for opt in [libc::SO_RCVBUF, libc::SO_SNDBUF] {
                unsafe {
                    libc::setsockopt(
                        fd,
                        libc::SOL_SOCKET,
                        opt,
                        &SOCK_BUF as *const _ as *const libc::c_void,
                        std::mem::size_of::<libc::c_int>() as libc::socklen_t,
                    );
                }
            }
        }
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
    // Initial capacity for the per-connection read buffer. Small on purpose:
    // it persists for the whole (possibly long-lived, idle) connection, and
    // `read_buf` grows it on demand, so a request head/body larger than this
    // still parses — it just triggers a reserve. 4 KiB covers a typical request
    // head in one read while keeping idle SSE subscribers cheap.
    let mut buf = BytesMut::with_capacity(4 * 1024);
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

        let keep_alive = head.keep_alive;
        let is_head = head.is_head;

        // ---- zero-copy binary-append intercept (Linux only) ----
        //
        // Eligible: --zero-copy on, POST, a known content-length (not chunked),
        // and the route is a binary append. We DON'T `read_sized` here; instead
        // the body is relayed socket→file→WAL via splice(2). The handler returns
        // `Fallback` for any edge case (producer dup/gap, closed, close request,
        // JSON, content-type mismatch, …), in which case we read the body
        // buffered below and run the normal handler — byte-for-byte unchanged.
        #[cfg(target_os = "linux")]
        if zero_copy()
            && matches!(head.method, crate::api::Method::Post)
            && !head.chunked
            && head.content_length.is_some_and(|n| n > 0)
        {
            use std::os::fd::AsRawFd;
            let content_len = head.content_length.unwrap();
            // The bytes the head parser over-read are the body prefix. Take up to
            // `content_len` of them (a tiny pipelined next-request tail must not be
            // counted as body); the rest of the body is still on the socket.
            let take = buf.len().min(content_len);
            let prefix = buf.split_to(take).freeze();
            let socket_fd = stream.as_raw_fd();
            let remaining = content_len - prefix.len();
            // splice_rest moves the remaining socket bytes into (file_fd, off).
            // The socket fd is `Copy` (i32), so capturing it does not borrow the
            // tokio `TcpStream` the handler is unaware of.
            let splice_rest = move |file_fd: std::os::fd::RawFd, off: i64| -> std::io::Result<()> {
                if remaining == 0 {
                    return Ok(());
                }
                let mut o = off;
                zerocopy::splice_all(socket_fd, None, file_fd, Some(&mut o), remaining)
            };
            let req = Req {
                method: head.method,
                path: head.path.clone(),
                query: head.query.clone(),
                headers: head.headers.clone(),
                body: Bytes::new(),
            };
            match handlers::handle_binary_append_zero_copy(
                store.clone(),
                &req,
                &prefix,
                content_len,
                splice_rest,
            )
            .await
            {
                handlers::ZeroCopyOutcome::Done(resp) => {
                    write_response(&mut stream, resp, is_head, keep_alive).await?;
                    if !keep_alive {
                        return Ok(());
                    }
                    continue;
                }
                handlers::ZeroCopyOutcome::Fallback => {
                    // Put the prefix back at the front of the buffer so the
                    // buffered read below sees the full body again.
                    let mut rebuilt = BytesMut::with_capacity(prefix.len() + buf.len());
                    rebuilt.extend_from_slice(&prefix);
                    rebuilt.extend_from_slice(&buf);
                    buf = rebuilt;
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
            // Small initial capacity: this buffer lives for the whole streaming
            // response (e.g. an SSE subscriber held open for up to SSE_MAX_DURATION),
            // and SSE events are small. `frame_chunk` grows it on demand for a
            // larger frame, so this only trades one reallocation for a large event
            // against ~7.5 KiB saved on every idle long-lived subscriber.
            let mut frame: Vec<u8> = Vec::with_capacity(512);
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

/// Zero-copy file-to-file / file-to-socket relay via `splice(2)`.
#[cfg(target_os = "linux")]
pub(crate) mod zerocopy {
    use std::io;
    use std::os::fd::RawFd;

    /// Move exactly `len` bytes from `src` to `dst` through an anonymous pipe, in-kernel.
    ///
    /// `*_off = None` uses the fd's own file offset (sockets); `Some(off)` is a
    /// positioned transfer (regular files) and is advanced as bytes move.
    pub fn splice_all(
        src: RawFd,
        mut src_off: Option<&mut i64>,
        dst: RawFd,
        mut dst_off: Option<&mut i64>,
        mut len: usize,
    ) -> io::Result<()> {
        let mut fds = [0i32; 2];
        // SAFETY: fds is a 2-element array; pipe2 fills both on success.
        if unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let (pr, pw) = (fds[0], fds[1]);
        let res = (|| {
            while len > 0 {
                // src → pipe
                let in_off = src_off.as_deref_mut().map_or(std::ptr::null_mut(), |p| p as *mut i64);
                // SAFETY: in_off is either null (use fd offset) or a valid &mut i64 cast
                // to *mut i64. pw is the write end of a valid pipe. splice does not alias
                // any Rust references and is called with valid fds only.
                let n = unsafe {
                    libc::splice(
                        src,
                        in_off,
                        pw,
                        std::ptr::null_mut(),
                        len,
                        (libc::SPLICE_F_MOVE | libc::SPLICE_F_MORE) as u32,
                    )
                };
                if n < 0 {
                    return Err(io::Error::last_os_error());
                }
                if n == 0 {
                    return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "splice src EOF"));
                }
                // pipe → dst (drain exactly n bytes)
                let mut moved = 0usize;
                while moved < n as usize {
                    let out_off = dst_off
                        .as_deref_mut()
                        .map_or(std::ptr::null_mut(), |p| p as *mut i64);
                    // SAFETY: out_off is either null (use fd offset) or a valid &mut i64
                    // cast to *mut i64. pr is the read end of the same pipe. We drain
                    // exactly the bytes placed in the pipe by the src splice above.
                    let m = unsafe {
                        libc::splice(
                            pr,
                            std::ptr::null_mut(),
                            dst,
                            out_off,
                            (n as usize) - moved,
                            (libc::SPLICE_F_MOVE | libc::SPLICE_F_MORE) as u32,
                        )
                    };
                    if m < 0 {
                        return Err(io::Error::last_os_error());
                    } else if m == 0 {
                        return Err(io::Error::new(
                            io::ErrorKind::UnexpectedEof,
                            "splice pipe drain returned 0",
                        ));
                    }
                    moved += m as usize;
                }
                len -= n as usize;
            }
            Ok(())
        })();
        // SAFETY: close both pipe ends regardless of outcome; the fds are valid
        // (pipe2 succeeded) and not used elsewhere after this point.
        unsafe {
            libc::close(pr);
            libc::close(pw);
        }
        res
    }
}

#[cfg(all(test, target_os = "linux"))]
mod zerocopy_tests {
    use super::zerocopy::splice_all;
    use std::io::{Read, Seek, SeekFrom, Write};
    use std::os::fd::AsRawFd;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Per-test nonce: combined with the process id this makes file names unique
    /// under `cargo test` parallelism so concurrent runs never race on the same
    /// path.
    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn unique_test_paths(stem: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let nonce = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let dir = std::env::temp_dir();
        let src = dir.join(format!("{stem}_src_{pid}_{nonce}"));
        let dst = dir.join(format!("{stem}_dst_{pid}_{nonce}"));
        (src, dst)
    }

    #[test]
    fn splice_all_file_to_file_copies_exact_bytes() {
        // Use temp_dir() files — no tempfile dev-dep needed.
        // File names embed the process id and a per-test counter so concurrent
        // `cargo test` runs cannot race on the same paths.
        let (src_path, dst_path) = unique_test_paths("splice_all");

        let mut src = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&src_path)
            .unwrap();
        let dst = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&dst_path)
            .unwrap();

        // > 64 KiB to exercise the loop past one pipe capacity.
        let data: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        src.write_all(&data).unwrap();

        let mut soff = 0i64;
        let mut doff = 0i64;
        splice_all(
            src.as_raw_fd(),
            Some(&mut soff),
            dst.as_raw_fd(),
            Some(&mut doff),
            data.len(),
        )
        .unwrap();

        let mut got = Vec::new();
        let mut dst2 = dst;
        dst2.seek(SeekFrom::Start(0)).unwrap();
        dst2.read_to_end(&mut got).unwrap();
        assert_eq!(got, data);

        // Cleanup — best-effort, ignore errors.
        let _ = std::fs::remove_file(&src_path);
        let _ = std::fs::remove_file(&dst_path);
    }
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
