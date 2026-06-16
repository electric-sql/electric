// io_uring HTTP/1.1 engine ("uring", Linux only).
//
// Where `raw` drives sockets through tokio's epoll reactor and serves reads with
// sendfile (parking a blocking-pool thread on a cold page fault), this engine
// runs a current-thread tokio runtime per core backed by io_uring (via
// tokio-uring). Socket recv/send — and, for cold reads, file reads — are
// submitted as io_uring operations: the kernel completes them asynchronously, so
// there is no epoll readiness round-trip and no spawn_blocking handoff. The
// per-stream resident tail cache (see store::StreamState::last_chunk) means hot
// reads are served straight from memory; only cold/backlog reads touch the file.
//
// The HTTP/1.1 request parser is shared with `raw` (engine_raw::try_parse_head);
// the async request handlers (handlers::handle) are reused unchanged — they only
// need a tokio runtime, which tokio-uring provides on each core.

use std::os::fd::AsRawFd;
use std::sync::Arc;

use bytes::{Bytes, BytesMut};
use tokio_uring::buf::BoundedBuf;
use tokio_uring::net::{TcpListener, TcpStream};

use crate::api::{Body, Req, Resp, MAX_BODY_BYTES};
use crate::handlers;
use crate::http1::{self, find_crlf, try_parse_head, MAX_HEADER_BYTES};
use crate::store::{Segment, Store};

const READ_CHUNK: usize = 64 * 1024;
/// Per-connection buffer for streaming file reads to the socket (bounds memory).
const STREAM_CHUNK: usize = 256 * 1024;

/// Run the io_uring engine: one current-thread runtime per core, each accepting
/// on a clone of `std_listener` (the kernel load-balances connections across the
/// rings). Blocks until all worker threads exit.
pub fn serve(store: Arc<Store>, std_listener: std::net::TcpListener, workers: usize) {
    let workers = workers.max(1);
    let mut handles = Vec::new();
    for _ in 1..workers {
        let store = store.clone();
        let listener = match std_listener.try_clone() {
            Ok(l) => l,
            Err(_) => continue,
        };
        handles.push(std::thread::spawn(move || {
            tokio_uring::start(acceptor(store, listener));
        }));
    }
    // Run one acceptor on the calling thread too.
    tokio_uring::start(acceptor(store, std_listener));
    for h in handles {
        let _ = h.join();
    }
}

async fn acceptor(store: Arc<Store>, std_listener: std::net::TcpListener) {
    let listener = TcpListener::from_std(std_listener);
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                set_nodelay(&stream);
                let store = store.clone();
                tokio_uring::spawn(async move {
                    let _ = conn_loop(store, stream).await;
                });
            }
            Err(_) => continue,
        }
    }
}

fn set_nodelay(stream: &TcpStream) {
    let fd = stream.as_raw_fd();
    let one: libc::c_int = 1;
    unsafe {
        libc::setsockopt(
            fd,
            libc::IPPROTO_TCP,
            libc::TCP_NODELAY,
            &one as *const _ as *const libc::c_void,
            std::mem::size_of::<libc::c_int>() as libc::socklen_t,
        );
    }
}

/// Read more bytes from the socket into `acc`, reusing `rbuf`'s allocation.
/// Returns Ok(false) on clean EOF.
async fn fill(stream: &TcpStream, acc: &mut Vec<u8>, rbuf: Vec<u8>) -> std::io::Result<(bool, Vec<u8>)> {
    let (res, rbuf) = stream.read(rbuf).await;
    let n = res?;
    if n == 0 {
        return Ok((false, rbuf));
    }
    acc.extend_from_slice(&rbuf[..n]);
    Ok((true, rbuf))
}

async fn conn_loop(store: Arc<Store>, stream: TcpStream) -> std::io::Result<()> {
    let mut acc: Vec<u8> = Vec::with_capacity(16 * 1024);
    let mut rbuf: Vec<u8> = vec![0u8; READ_CHUNK];
    loop {
        // ---- request head ----
        let (head, consumed) = loop {
            match try_parse_head(&acc) {
                Err(()) => {
                    let _ = write_all(&stream, bad_request()).await;
                    return Ok(());
                }
                Ok(Some(parsed)) => break parsed,
                Ok(None) => {
                    let (more, b) = fill(&stream, &mut acc, rbuf).await?;
                    rbuf = b;
                    if !more {
                        return Ok(()); // clean EOF between requests
                    }
                }
            }
        };
        acc.drain(..consumed);

        if head.expect_continue {
            write_all(&stream, b"HTTP/1.1 100 Continue\r\n\r\n".to_vec()).await?;
        }

        // ---- request body ----
        let body = if head.chunked {
            match read_chunked(&stream, &mut acc, &mut rbuf).await? {
                Some(b) => b,
                None => {
                    let _ = write_all(&stream, bad_request()).await;
                    return Ok(());
                }
            }
        } else {
            match head.content_length.unwrap_or(0) {
                0 => Bytes::new(),
                n if n > MAX_BODY_BYTES => {
                    let _ = write_all(&stream, payload_too_large()).await;
                    return Ok(());
                }
                n => {
                    while acc.len() < n {
                        let (more, b) = fill(&stream, &mut acc, rbuf).await?;
                        rbuf = b;
                        if !more {
                            return Ok(());
                        }
                    }
                    Bytes::copy_from_slice(&acc.drain(..n).collect::<Vec<u8>>())
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
        write_response(&stream, resp, is_head, keep_alive).await?;
        if !keep_alive {
            return Ok(());
        }
    }
}

/// Decode a chunked request body from `acc`, reading more as needed.
async fn read_chunked(
    stream: &TcpStream,
    acc: &mut Vec<u8>,
    rbuf: &mut Vec<u8>,
) -> std::io::Result<Option<Bytes>> {
    let mut out = BytesMut::new();
    loop {
        // size line
        let line_end = loop {
            if let Some(pos) = find_crlf(acc) {
                break pos;
            }
            if acc.len() > MAX_HEADER_BYTES {
                return Ok(None);
            }
            let (more, b) = fill(stream, acc, std::mem::take(rbuf)).await?;
            *rbuf = b;
            if !more {
                return Ok(None);
            }
        };
        let size_str = std::str::from_utf8(&acc[..line_end]).unwrap_or("");
        let size_str = size_str.split(';').next().unwrap_or("").trim();
        let size = match usize::from_str_radix(size_str, 16) {
            Ok(s) => s,
            Err(_) => return Ok(None),
        };
        acc.drain(..line_end + 2);
        if size == 0 {
            // trailers until blank line
            loop {
                if let Some(pos) = find_crlf(acc) {
                    acc.drain(..pos + 2);
                    if pos == 0 {
                        return Ok(Some(out.freeze()));
                    }
                } else {
                    if acc.len() > MAX_HEADER_BYTES {
                        return Ok(None);
                    }
                    let (more, b) = fill(stream, acc, std::mem::take(rbuf)).await?;
                    *rbuf = b;
                    if !more {
                        return Ok(None);
                    }
                }
            }
        }
        let need = match size.checked_add(2) {
            Some(n) if out.len().checked_add(size).map(|t| t <= MAX_BODY_BYTES).unwrap_or(false) => n,
            _ => return Ok(None),
        };
        while acc.len() < need {
            let (more, b) = fill(stream, acc, std::mem::take(rbuf)).await?;
            *rbuf = b;
            if !more {
                return Ok(None);
            }
        }
        out.extend_from_slice(&acc[..size]);
        acc.drain(..need);
    }
}

async fn write_response(
    stream: &TcpStream,
    resp: Resp,
    is_head: bool,
    keep_alive: bool,
) -> std::io::Result<()> {
    let status = resp.status;
    let body_len = resp.body.len();
    let mut head: Vec<u8> = Vec::with_capacity(512);
    http1::write_head(&mut head, status, &resp.headers, body_len, keep_alive);

    if is_head || http1::status_has_no_body(status) {
        return write_all(stream, head).await;
    }

    match resp.body {
        Body::Empty => write_all(stream, head).await,
        Body::Full(b) => {
            // Coalesce head + small body into one submission.
            if b.len() <= http1::COALESCE_MAX {
                head.extend_from_slice(&b);
                write_all(stream, head).await
            } else {
                write_all(stream, head).await?;
                write_all(stream, b.to_vec()).await
            }
        }
        Body::FileRange {
            segments,
            prefix,
            suffix,
            ..
        } => {
            // Cold / backlog / large read (small hot reads are served from the
            // resident cache as Body::Full). Stream it via io_uring: read a
            // bounded chunk and write it before reading the next, so memory stays
            // O(STREAM_CHUNK) per connection regardless of read size (a full
            // materialize would OOM on multi-GB reads). The kernel does each file
            // read asynchronously — a cold fault never blocks the runtime thread
            // and there is no spawn_blocking handoff.
            head.extend_from_slice(prefix);
            write_all(stream, head).await?;
            stream_segments(stream, &segments).await?;
            if !suffix.is_empty() {
                write_all(stream, suffix.to_vec()).await?;
            }
            Ok(())
        }
        Body::Channel(mut rx) => {
            write_all(stream, head).await?;
            debug_assert!(body_len.is_none());
            while let Some(b) = rx.recv().await {
                let mut frame = Vec::with_capacity(b.len() + 16);
                http1::frame_chunk(&mut frame, &b);
                write_all(stream, frame).await?;
            }
            write_all(stream, b"0\r\n\r\n".to_vec()).await
        }
    }
}

/// Stream file segments to the socket using io_uring file reads
/// (`IORING_OP_READ`) interleaved with sends, bounded to STREAM_CHUNK of memory
/// per connection. Each segment's fd is dup'd so the tokio-uring File owns its
/// own descriptor (its close never touches the Store's shared data-file fd). The
/// kernel performs the reads asynchronously: a cold fault parks nothing on the
/// runtime thread and there is no blocking-pool handoff.
async fn stream_segments(stream: &TcpStream, segments: &[Segment]) -> std::io::Result<()> {
    use std::os::fd::{FromRawFd, RawFd};
    for seg in segments {
        if seg.len == 0 {
            continue;
        }
        let dup: RawFd = unsafe { libc::dup(seg.file.as_raw_fd()) };
        if dup < 0 {
            return Err(std::io::Error::last_os_error());
        }
        let file = unsafe { tokio_uring::fs::File::from_raw_fd(dup) };
        let mut pos = seg.file_start;
        let end = seg.file_end();
        let mut buf = vec![0u8; STREAM_CHUNK];
        let mut err = None;
        while pos < end {
            // read_at fills up to buf.len(); the file region ends at `end`, so it
            // returns at most the bytes remaining in this segment.
            let (res, b) = file.read_at(buf, pos).await;
            buf = b;
            match res {
                Ok(0) => {
                    err = Some(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        "short file read",
                    ));
                    break;
                }
                Ok(n) => {
                    let n = n.min((end - pos) as usize);
                    buf = match write_all_n(stream, buf, n).await {
                        Ok(b) => b,
                        Err(e) => {
                            err = Some(e);
                            break;
                        }
                    };
                    pos += n as u64;
                }
                Err(e) => {
                    err = Some(e);
                    break;
                }
            }
        }
        let _ = file.close().await;
        if let Some(e) = err {
            return Err(e);
        }
    }
    Ok(())
}

/// Write the first `n` bytes of `buf` fully to the socket, returning the buffer
/// for reuse. Handles partial io_uring writes.
async fn write_all_n(stream: &TcpStream, buf: Vec<u8>, n: usize) -> std::io::Result<Vec<u8>> {
    let mut buf = buf;
    let mut off = 0usize;
    while off < n {
        let (res, slice) = stream.write(buf.slice(off..n)).submit().await;
        buf = slice.into_inner();
        let w = res?;
        if w == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::WriteZero,
                "socket write returned 0",
            ));
        }
        off += w;
    }
    Ok(buf)
}

/// Write an owned buffer fully to the socket, handling partial writes.
async fn write_all(stream: &TcpStream, data: Vec<u8>) -> std::io::Result<()> {
    let n = data.len();
    write_all_n(stream, data, n).await.map(|_| ())
}

fn bad_request() -> Vec<u8> {
    b"HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".to_vec()
}
fn payload_too_large() -> Vec<u8> {
    b"HTTP/1.1 413 Payload Too Large\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".to_vec()
}
