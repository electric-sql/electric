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

/// Take a flag's value or exit(2) with a clean usage error (not a panic).
fn val(o: Option<String>, flag: &str) -> String {
    o.unwrap_or_else(|| {
        eprintln!("error: {flag} requires a value");
        std::process::exit(2);
    })
}

/// Parse a flag's value or exit(2) with a clean error.
fn parse_val<T: std::str::FromStr>(o: Option<String>, flag: &str) -> T {
    let s = val(o, flag);
    s.parse().unwrap_or_else(|_| {
        eprintln!("error: {flag} got an invalid value: {s:?}");
        std::process::exit(2);
    })
}

/// Raise the open-file-descriptor soft limit to the hard limit at startup. Each
/// connection costs ≥1 fd (plus per-stream data-file fds), so the default soft
/// limit (commonly 1024) caps concurrency far below what the server can handle
/// and makes `accept()` fail with EMFILE under load. Best-effort: errors are
/// ignored (the accept loop also backs off on EMFILE as a safety net).
#[cfg(unix)]
fn raise_nofile_limit() {
    unsafe {
        let mut lim = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        if libc::getrlimit(libc::RLIMIT_NOFILE, &mut lim) != 0 {
            return;
        }
        // macOS rejects RLIM_INFINITY for NOFILE (and caps at kern.maxfilesperproc);
        // pick a high concrete target so the raise succeeds across platforms.
        let target = if lim.rlim_max == libc::RLIM_INFINITY {
            1_048_576
        } else {
            lim.rlim_max
        };
        if lim.rlim_cur < target {
            lim.rlim_cur = target;
            let _ = libc::setrlimit(libc::RLIMIT_NOFILE, &lim);
        }
    }
}

fn main() {
    #[cfg(unix)]
    raise_nofile_limit();
    let mut port: u16 = 4437; // protocol default (PROTOCOL.md §13.1)
    let mut host: std::net::IpAddr = [127, 0, 0, 1].into();
    let mut data_dir = std::env::temp_dir().join("durable-streams-rust");
    let mut tier = tier::TierConfig::default();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--host" => host = parse_val(args.next(), "--host"),
            "--port" => port = parse_val(args.next(), "--port"),
            "--data-dir" => data_dir = val(args.next(), "--data-dir").into(),
            "--long-poll-timeout-ms" => {
                handlers::set_long_poll_timeout(parse_val(args.next(), "--long-poll-timeout-ms"));
            }
            "--splice-appends" => {
                engine_raw::set_splice_appends(true);
            }
            "--read-offload" => {
                let v = val(args.next(), "--read-offload");
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
                let v = val(args.next(), "--tier");
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
                tier.segment_bytes = parse_val(args.next(), "--tier-segment-bytes");
            }
            "--tier-compact-bytes" => {
                tier.compact_bytes = parse_val(args.next(), "--tier-compact-bytes");
            }
            "--tier-key-prefix" => tier.key_prefix = val(args.next(), "--tier-key-prefix"),
            "--tier-endpoint" => tier.endpoint = Some(val(args.next(), "--tier-endpoint")),
            "--tier-region" => tier.region = Some(val(args.next(), "--tier-region")),
            "--tier-bucket" => tier.bucket = Some(val(args.next(), "--tier-bucket")),
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
                tier.local_dir = Some(val(args.next(), "--tier-local-dir").into());
            }
            "--durability" => {
                let v = val(args.next(), "--durability");
                match v.as_str() {
                    "strict" => handlers::set_durability_relaxed(false),
                    "relaxed" => handlers::set_durability_relaxed(true),
                    _ => {
                        eprintln!("--durability must be strict|relaxed");
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
            _ = shutdown_signal() => {
                // Stop accepting (the serve future is dropped here), let in-flight
                // requests — including their group-commit fsync — finish, then flush
                // telemetry. Bounded so a stuck request can't block shutdown forever.
                engine_raw::drain(std::time::Duration::from_secs(25)).await;
                telemetry_guard.shutdown();
            }
        }
    });
}

/// Resolve on SIGINT (Ctrl-C) or SIGTERM (systemd/Kubernetes stop). On non-Unix,
/// only Ctrl-C.
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = signal(SignalKind::terminate()).expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
