mod api;
mod blobstore;
mod engine_hyper;
mod engine_raw;
#[cfg(target_os = "linux")]
mod engine_uring;
mod handlers;
mod http1;
mod store;
mod subs;
mod telemetry;
mod tier;

use std::net::SocketAddr;
use std::sync::Arc;

use tokio::net::TcpListener;

use store::Store;

fn main() {
    let mut port: u16 = 4438;
    let mut host: std::net::IpAddr = [127, 0, 0, 1].into();
    let mut data_dir = std::env::temp_dir().join("durable-streams-rust");
    let mut engine = String::from("hyper");
    let mut tier = tier::TierConfig::default();
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
            "--splice-appends" => {
                engine_raw::set_splice_appends(true);
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
            // ---- hot/cold tiering (OFF by default) ----
            "--tier" => {
                let v = args.next().expect("--tier requires off|local|s3");
                tier.kind = match v.as_str() {
                    "off" => tier::TierKind::Off,
                    "local" => tier::TierKind::Local,
                    "s3" => tier::TierKind::S3,
                    _ => {
                        eprintln!("--tier must be off|local|s3");
                        std::process::exit(2);
                    }
                };
            }
            "--tier-segment-bytes" => {
                tier.segment_bytes = args
                    .next()
                    .and_then(|v| v.parse().ok())
                    .expect("--tier-segment-bytes requires a number");
            }
            "--tier-key-prefix" => {
                tier.key_prefix = args.next().expect("--tier-key-prefix requires a value");
            }
            "--tier-endpoint" => {
                tier.endpoint = Some(args.next().expect("--tier-endpoint requires a URL"));
            }
            "--tier-region" => {
                tier.region = Some(args.next().expect("--tier-region requires a value"));
            }
            "--tier-bucket" => {
                tier.bucket = Some(args.next().expect("--tier-bucket requires a value"));
            }
            "--tier-path-style" => {
                tier.path_style = true;
            }
            "--tier-virtual-hosted" => {
                tier.path_style = false;
            }
            "--tier-allow-http" => {
                tier.allow_http = true;
            }
            "--tier-local-dir" => {
                tier.local_dir = Some(args.next().expect("--tier-local-dir requires a path").into());
            }
            other => {
                eprintln!("unknown argument: {other}");
                std::process::exit(2);
            }
        }
    }

    // S3 credentials come from env (never CLI flags), matching the OTEL_*/AWS
    // convention. Honour both the DS_* names and the standard AWS_* fallbacks.
    if tier.kind == tier::TierKind::S3 {
        tier.access_key_id = std::env::var("DS_S3_ACCESS_KEY_ID")
            .or_else(|_| std::env::var("AWS_ACCESS_KEY_ID"))
            .ok();
        tier.secret_access_key = std::env::var("DS_S3_SECRET_ACCESS_KEY")
            .or_else(|_| std::env::var("AWS_SECRET_ACCESS_KEY"))
            .ok();
    }

    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);

    // The io_uring engine manages its own per-core current-thread runtimes, so
    // it runs here instead of on the shared multi-threaded tokio runtime below.
    #[cfg(target_os = "linux")]
    if engine == "uring" {
        // Telemetry is OFF by default (feature-gated); this is a no-op unless
        // built with `--features telemetry`. The guard flushes on drop — for
        // uring, `serve` blocks the calling thread until shutdown, after which
        // the guard drops and the batch processor flushes.
        let _telemetry = telemetry::init();
        let store = Arc::new(Store::new_with_tier(data_dir.clone(), tier.clone()).expect("failed to init store"));
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
        // Telemetry is OFF by default (feature-gated); a no-op unless built with
        // `--features telemetry`. The guard is held across the run and flushed on
        // Ctrl-C — `serve()` never returns on its own, so without the signal path
        // the batch span processor would never get a chance to flush.
        let mut telemetry_guard = telemetry::init();
        let store = Arc::new(Store::new_with_tier(data_dir.clone(), tier.clone()).expect("failed to init store"));
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
        tokio::select! {
            _ = async {
                match engine.as_str() {
                    "hyper" => engine_hyper::serve(store, listener).await,
                    "raw" => engine_raw::serve(store, listener).await,
                    _ => unreachable!(),
                }
            } => {}
            // Flush telemetry on shutdown. serve() above never returns, so this
            // signal branch is the only path that lets the batch processor flush.
            _ = tokio::signal::ctrl_c() => {
                telemetry_guard.shutdown();
            }
        }
    });
}
