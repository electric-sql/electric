mod handlers;
mod store;

use std::net::SocketAddr;
use std::sync::Arc;

use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

use store::Store;

fn main() {
    let mut port: u16 = 4438;
    let mut data_dir = std::env::temp_dir().join("durable-streams-rust");
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--port" => {
                port = args
                    .next()
                    .and_then(|v| v.parse().ok())
                    .expect("--port requires a number");
            }
            "--data-dir" => {
                data_dir = args.next().expect("--data-dir requires a path").into();
            }
            "--long-poll-timeout-ms" => {
                let ms: u64 = args
                    .next()
                    .and_then(|v| v.parse().ok())
                    .expect("--long-poll-timeout-ms requires a number");
                handlers::set_long_poll_timeout(ms);
            }
            other => {
                eprintln!("unknown argument: {other}");
                std::process::exit(2);
            }
        }
    }

    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .enable_all()
        .build()
        .expect("failed to build runtime");

    rt.block_on(async move {
        let store = Arc::new(Store::new(data_dir.clone()).expect("failed to init store"));
        let addr: SocketAddr = ([127, 0, 0, 1], port).into();
        let listener = TcpListener::bind(addr).await.expect("bind failed");
        println!(
            "durable-streams-server listening on http://{addr} (data: {})",
            data_dir.display()
        );
        loop {
            let (stream, _) = match listener.accept().await {
                Ok(s) => s,
                Err(_) => continue,
            };
            let _ = stream.set_nodelay(true);
            let store = store.clone();
            tokio::spawn(async move {
                let io = TokioIo::new(stream);
                let svc = service_fn(move |req| {
                    let store = store.clone();
                    async move { Ok::<_, std::convert::Infallible>(handlers::handle(store, req).await) }
                });
                let _ = http1::Builder::new()
                    .serve_connection(io, svc)
                    .await;
            });
        }
    });
}
