mod api;
mod engine_hyper;
mod engine_raw;
#[cfg(target_os = "linux")]
mod engine_uring;
mod handlers;
mod http1;
mod store;
mod subs;

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
                engine = args.next().expect("--http-engine requires hyper|raw|uring");
                match engine.as_str() {
                    "hyper" | "raw" => {}
                    "uring" => {
                        #[cfg(not(target_os = "linux"))]
                        {
                            eprintln!("--http-engine uring is Linux-only");
                            std::process::exit(2);
                        }
                    }
                    _ => {
                        eprintln!("--http-engine must be 'hyper', 'raw', or 'uring'");
                        std::process::exit(2);
                    }
                }
            }
            "--long-poll-timeout-ms" => {
                let ms: u64 = args
                    .next()
                    .and_then(|v| v.parse().ok())
                    .expect("--long-poll-timeout-ms requires a number");
                handlers::set_long_poll_timeout(ms);
            }
            "--read-offload" => {
                let v = args
                    .next()
                    .expect("--read-offload requires inline|tail|always");
                match engine_raw::ReadOffload::parse(&v) {
                    Some(mode) => engine_raw::set_read_offload(mode),
                    None => {
                        eprintln!("--read-offload must be inline|tail|always");
                        std::process::exit(2);
                    }
                }
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

    // The io_uring engine manages its own per-core current-thread runtimes, so
    // it runs here instead of on the shared multi-threaded tokio runtime below.
    #[cfg(target_os = "linux")]
    if engine == "uring" {
        let store = Arc::new(Store::new(data_dir.clone()).expect("failed to init store"));
        let _ = store.subs.set(Arc::new(subs::SubsManager::new()));
        let std_listener = std::net::TcpListener::bind((host, port)).expect("bind failed");
        let addr = std_listener.local_addr().unwrap_or_else(|_| (host, port).into());
        println!(
            "durable-streams-server listening on http://{addr} (engine: uring, data: {})",
            data_dir.display()
        );
        println!(
            "note: __ds control plane is in-memory only — subscriptions and the \
             webhook-signing key reset on restart"
        );
        engine_uring::serve(store, std_listener, workers);
        return;
    }

    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .enable_all()
        .build()
        .expect("failed to build runtime");

    rt.block_on(async move {
        let store = Arc::new(Store::new(data_dir.clone()).expect("failed to init store"));
        let _ = store.subs.set(Arc::new(subs::SubsManager::new()));
        let addr: SocketAddr = (host, port).into();
        let listener = TcpListener::bind(addr).await.expect("bind failed");
        println!(
            "durable-streams-server listening on http://{addr} (engine: {engine}, data: {})",
            data_dir.display()
        );
        // The stream data is durable, but the __ds control plane is not: see
        // the README "Control-plane durability" note.
        println!(
            "note: __ds control plane is in-memory only — subscriptions and the \
             webhook-signing key reset on restart"
        );
        match engine.as_str() {
            "hyper" => engine_hyper::serve(store, listener).await,
            "raw" => engine_raw::serve(store, listener).await,
            _ => unreachable!(),
        }
    });
}
