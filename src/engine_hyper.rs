// hyper-based HTTP engine. Adapts engine-agnostic Req/Resp (api.rs) to hyper.
//
// FileRange bodies are served by copying through userspace buffers (hyper's
// Body abstraction cannot express sendfile); small ranges are materialized in
// one read, large ranges stream in 1 MB chunks.

use std::convert::Infallible;
use std::os::unix::fs::FileExt;
use std::sync::Arc;

use bytes::{Bytes, BytesMut};
use http_body_util::{BodyExt, Full};
use hyper::body::{Body as HyperBody, Frame, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use tokio::sync::mpsc;

use crate::api::{Body, Method, Req, Resp, MAX_BODY_BYTES};
use crate::handlers;
use crate::store::{materialize_segments, Segment, Store};

/// Why building a `Req` from the incoming hyper request failed.
enum ReqError {
    /// Body could not be read (transport error).
    BadBody,
    /// Body exceeds `MAX_BODY_BYTES` — answered with `413 Payload Too Large`,
    /// matching the raw engine.
    TooLarge,
}

/// Response body: a buffered `Full` or a streamed `Channel`. The error type is
/// `io::Error` (not `Infallible`) precisely so the streamed arm can ABORT: when
/// the producer set the `failed` flag, `poll_frame` yields `Err`, which makes
/// hyper drop the connection instead of emitting a clean chunked terminator —
/// so a failed/short read is never served as a complete-looking response. The
/// `Full` arm never errors (its `Infallible` is mapped away). See BUG-1.
pub enum RespBody {
    Full(Full<Bytes>),
    Channel(ChannelBody),
}

pub struct ChannelBody {
    rx: mpsc::Receiver<Bytes>,
    failed: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl HyperBody for RespBody {
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        use std::task::Poll;
        match self.get_mut() {
            // Full<Bytes>::Error is Infallible; map it away.
            RespBody::Full(f) => match std::pin::Pin::new(f).poll_frame(cx) {
                Poll::Ready(Some(Ok(fr))) => Poll::Ready(Some(Ok(fr))),
                Poll::Ready(Some(Err(e))) => match e {},
                Poll::Ready(None) => Poll::Ready(None),
                Poll::Pending => Poll::Pending,
            },
            RespBody::Channel(c) => match c.rx.poll_recv(cx) {
                Poll::Ready(Some(b)) => Poll::Ready(Some(Ok(Frame::data(b)))),
                Poll::Ready(None) => {
                    if c.failed.load(std::sync::atomic::Ordering::Acquire) {
                        // Abort: hyper drops the connection (no clean terminator).
                        Poll::Ready(Some(Err(std::io::Error::other("read aborted mid-stream"))))
                    } else {
                        Poll::Ready(None)
                    }
                }
                Poll::Pending => Poll::Pending,
            },
        }
    }
}

const INLINE_READ_MAX: u64 = 4 * 1024 * 1024;
const STREAM_CHUNK: usize = 1024 * 1024;

async fn file_range_to_body(
    segments: Vec<Segment>,
    prefix: &'static [u8],
    suffix: &'static [u8],
) -> RespBody {
    let data_len: u64 = segments.iter().map(|s| s.len).sum();
    if data_len <= INLINE_READ_MAX {
        // Materialize small ranges into one sized body (content-length).
        let buf =
            tokio::task::spawn_blocking(move || materialize_segments(&segments, prefix, suffix))
                .await
                .unwrap_or_default();
        RespBody::Full(Full::new(buf))
    } else {
        let (tx, rx) = mpsc::channel::<Bytes>(4);
        let failed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let failed_producer = failed.clone();
        tokio::task::spawn_blocking(move || {
            if !prefix.is_empty() {
                let _ = tx.blocking_send(Bytes::from_static(prefix));
            }
            for seg in &segments {
                let mut pos = seg.file_start;
                let seg_end = seg.file_end();
                while pos < seg_end {
                    let n = ((seg_end - pos) as usize).min(STREAM_CHUNK);
                    let mut buf = BytesMut::zeroed(n);
                    if seg.file.read_exact_at(&mut buf, pos).is_err() {
                        // Local read failed mid-stream — abort so the connection
                        // drops rather than serving a truncated 200 (BUG-1).
                        failed_producer.store(true, std::sync::atomic::Ordering::Release);
                        return;
                    }
                    pos += n as u64;
                    if tx.blocking_send(buf.freeze()).is_err() {
                        return; // client gone
                    }
                }
            }
            if !suffix.is_empty() {
                let _ = tx.blocking_send(Bytes::from_static(suffix));
            }
        });
        RespBody::Channel(ChannelBody { rx, failed })
    }
}

async fn to_req(req: Request<Incoming>) -> Result<Req, ReqError> {
    let method = Method::parse(req.method().as_str());
    let path = req.uri().path().to_string();
    let query = req.uri().query().map(|s| s.to_string());
    let headers = req
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_string(), v.to_string())))
        .collect();
    let incoming = req.into_body();
    // Reject before buffering when the body advertises a size over the cap, so
    // an oversized declared length can't force us to read it all first.
    if incoming.size_hint().lower() > MAX_BODY_BYTES as u64 {
        return Err(ReqError::TooLarge);
    }
    let body = incoming.collect().await.map_err(|_| ReqError::BadBody)?.to_bytes();
    // Chunked / unframed bodies have no advance size hint; cap on the bytes we
    // actually received so the limit holds regardless of framing — same cap
    // (`MAX_BODY_BYTES`) and status (413) as the raw engine.
    if body.len() > MAX_BODY_BYTES {
        return Err(ReqError::TooLarge);
    }
    Ok(Req {
        method,
        path,
        query,
        headers,
        body,
    })
}

async fn to_hyper(resp: Resp) -> Response<RespBody> {
    let mut builder = Response::builder().status(StatusCode::from_u16(resp.status).unwrap());
    for (k, v) in resp.headers {
        builder = builder.header(k, v);
    }
    for (k, v) in crate::api::SECURITY_HEADERS {
        builder = builder.header(*k, hyper::header::HeaderValue::from_static(v));
    }
    let body = match resp.body {
        Body::Empty => RespBody::Full(Full::new(Bytes::new())),
        Body::Full(b) => RespBody::Full(Full::new(b)),
        Body::Channel(sb) => RespBody::Channel(ChannelBody {
            rx: sb.rx,
            failed: sb.failed,
        }),
        Body::FileRange {
            segments,
            prefix,
            suffix,
            // hyper always serves file ranges via its own spawn_blocking
            // buffered path, so the raw engine's hot/cold hint is unused here.
            hot: _,
        } => file_range_to_body(segments, prefix, suffix).await,
    };
    builder.body(body).unwrap()
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
            let io = TokioIo::new(stream);
            let svc = service_fn(move |hreq| {
                let store = store.clone();
                async move {
                    let resp = match to_req(hreq).await {
                        Ok(req) => handlers::handle(store, req).await,
                        // 413 with an empty body mirrors the raw engine's
                        // `413 Payload Too Large` response shape.
                        Err(ReqError::TooLarge) => Resp::new(413),
                        Err(ReqError::BadBody) => {
                            let mut r = Resp::new(400);
                            r.body = Body::Full(Bytes::from_static(b"body read error"));
                            r
                        }
                    };
                    Ok::<_, Infallible>(to_hyper(resp).await)
                }
            });
            let _ = http1::Builder::new().serve_connection(io, svc).await;
        });
    }
}
