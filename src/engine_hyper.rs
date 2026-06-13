// hyper-based HTTP engine. Adapts engine-agnostic Req/Resp (api.rs) to hyper.
//
// FileRange bodies are served by copying through userspace buffers (hyper's
// Body abstraction cannot express sendfile); small ranges are materialized in
// one read, large ranges stream in 1 MB chunks.

use std::convert::Infallible;
use std::os::unix::fs::FileExt;
use std::sync::Arc;

use bytes::{Bytes, BytesMut};
use http_body_util::{BodyExt, Either, Full};
use hyper::body::{Body as HyperBody, Frame, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use tokio::sync::mpsc;

use crate::api::{Body, Method, Req, Resp};
use crate::handlers;
use crate::store::{materialize_segments, Segment, Store};

pub type RespBody = Either<Full<Bytes>, ChannelBody>;

pub struct ChannelBody {
    rx: mpsc::Receiver<Bytes>,
}

impl HyperBody for ChannelBody {
    type Data = Bytes;
    type Error = Infallible;

    fn poll_frame(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        match self.rx.poll_recv(cx) {
            std::task::Poll::Ready(Some(b)) => std::task::Poll::Ready(Some(Ok(Frame::data(b)))),
            std::task::Poll::Ready(None) => std::task::Poll::Ready(None),
            std::task::Poll::Pending => std::task::Poll::Pending,
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
        Either::Left(Full::new(buf))
    } else {
        let (tx, rx) = mpsc::channel::<Bytes>(4);
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
                        return;
                    }
                    pos += n as u64;
                    if tx.blocking_send(buf.freeze()).is_err() {
                        return;
                    }
                }
            }
            if !suffix.is_empty() {
                let _ = tx.blocking_send(Bytes::from_static(suffix));
            }
        });
        Either::Right(ChannelBody { rx })
    }
}

async fn to_req(req: Request<Incoming>) -> Result<Req, ()> {
    let method = Method::parse(req.method().as_str());
    let path = req.uri().path().to_string();
    let query = req.uri().query().map(|s| s.to_string());
    let headers = req
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_string(), v.to_string())))
        .collect();
    let body = req.into_body().collect().await.map_err(|_| ())?.to_bytes();
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
    let body = match resp.body {
        Body::Empty => Either::Left(Full::new(Bytes::new())),
        Body::Full(b) => Either::Left(Full::new(b)),
        Body::Channel(rx) => Either::Right(ChannelBody { rx }),
        Body::FileRange {
            segments,
            prefix,
            suffix,
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
                        Err(_) => {
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
