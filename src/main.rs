mod api;
mod engine_hyper;
mod handlers;
mod store;

use std::net::SocketAddr;
use std::sync::Arc;

use tokio::net::TcpListener;

use store::Store;

fn main() {
    let mut port: u16 = 4438;
    let mut host: std::net::IpAddr = [127, 0, 0, 1].into();
    let mut data_dir = std::env::temp_dir().join("durable-streams-rust");
    let mut engine = String::from("hyper");
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--host" => {
                host = args
                    .next()
                    .and_then(|v| v.parse().ok())
                    .expect("--host requires an IP address");
            }
            "--port" => {
                port = args
                    .next()
                    .and_then(|v| v.parse().ok())
                    .expect("--port requires a number");
            }
            "--data-dir" => {
                data_dir = args.next().expect("--data-dir requires a path").into();
            }
            "--http-engine" => {
                engine = args.next().expect("--http-engine requires hyper|raw");
                if engine != "hyper" && engine != "raw" {
                    eprintln!("--http-engine must be 'hyper' or 'raw'");
                    std::process::exit(2);
                }
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
        let addr: SocketAddr = (host, port).into();
        let listener = TcpListener::bind(addr).await.expect("bind failed");
        println!(
            "durable-streams-server listening on http://{addr} (engine: {engine}, data: {})",
            data_dir.display()
        );
        match engine.as_str() {
            "hyper" => engine_hyper::serve(store, listener).await,
            _ => unreachable!(),
        }
    });
}
