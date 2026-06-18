mod api;
mod blobstore;
mod engine_raw;
mod handlers;
mod http1;
mod store;
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
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .enable_all()
        .build()
        .expect("failed to build runtime");

    rt.block_on(async move {
        // Telemetry is OFF by default (feature-gated); a no-op unless built with
        // `--features telemetry`. Held across the run and flushed on Ctrl-C —
        // `serve()` never returns on its own.
        let mut telemetry_guard = telemetry::init();
        let store = Arc::new(
            Store::new_with_tier(data_dir.clone(), tier.clone()).expect("failed to init store"),
        );
        let addr: SocketAddr = (host, port).into();
        let listener = TcpListener::bind(addr).await.expect("bind failed");
        println!(
            "durable-streams-server listening on http://{addr} (data: {})",
            data_dir.display()
        );
        tokio::select! {
            _ = engine_raw::serve(store, listener) => {}
            _ = tokio::signal::ctrl_c() => {
                telemetry_guard.shutdown();
            }
        }
    });
}
