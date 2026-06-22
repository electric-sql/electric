mod api;
mod blobstore;
mod engine_raw;
mod handlers;
mod http1;
mod store;
mod telemetry;
mod tier;
mod wal;

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
    // `--wal-shards N` (the WAL shard count). `None` ⇒ on a fresh data dir use the
    // core count; on an existing one reuse the persisted N. A value ≠ the persisted
    // N is rejected with exit 2 (spec §5). Only consulted under `--durability wal`.
    let mut wal_shards: Option<usize> = None;
    // `--wal-segment-bytes N` overrides the per-shard WAL segment size (the
    // `fallocate` size + segment-roll threshold). `None` ⇒ the 128 MiB default.
    // Only consulted under `--durability wal`; useful for forcing rolls in tests
    // and benches without writing a full 128 MiB segment.
    let mut wal_segment_bytes: Option<u64> = None;
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
                match handlers::parse_durability(&v) {
                    Some(mode) => handlers::set_durability(mode),
                    None => {
                        eprintln!("--durability must be strict|wal|fast");
                        std::process::exit(2);
                    }
                }
            }
            "--wal-shards" => {
                let n: usize = parse_val(args.next(), "--wal-shards");
                if n == 0 {
                    eprintln!("--wal-shards must be ≥ 1");
                    std::process::exit(2);
                }
                wal_shards = Some(n);
            }
            "--wal-segment-bytes" => {
                let n: u64 = parse_val(args.next(), "--wal-segment-bytes");
                if n == 0 {
                    eprintln!("--wal-segment-bytes must be ≥ 1");
                    std::process::exit(2);
                }
                wal_segment_bytes = Some(n);
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

        // ---- WAL wiring (`--durability wal` only) ----
        //
        // Order is load-bearing for crash-correctness (spec §9):
        //   1. `WalSet::open` is NON-DESTRUCTIVE — it opens the existing on-disk
        //      `wal/<i>/*.wal` segments (so recovery can read the pre-crash bytes)
        //      while resetting the in-memory cursor to lsn 1 / offset 0. A
        //      `--wal-shards` ≠ the persisted N is rejected here → exit 2 (spec §5).
        //   2. `recovery::recover` replays every durable WAL record into the
        //      per-stream files and `fdatasync`s them — after this the per-stream
        //      files are durable up to the frontier, so the OLD WAL is REDUNDANT.
        //      (The non-sharded sidecar pass that owns stream identity already ran
        //      inside `Store::new_with_tier`, so the streams exist here.)
        //   3. `reset_after_recovery` then WIPES each shard's WAL to a fresh,
        //      zero-filled segment at lsn 1. This closes the recover-before-clobber
        //      hole: without it, the live committer/appenders (which start at lsn 1
        //      / offset 0 per step 1) would write a new — possibly shorter — record
        //      over the old segment, leaving a stale suffix of whole framed records
        //      that a SECOND crash's recovery would mis-replay. After the reset the
        //      decoder hits `fallocate` zeros right after the live tail = clean EOL.
        //   4. ONLY THEN attach the WalSet (append path sees it), spawn the
        //      per-shard committers, and start the checkpoint ticker. No append can
        //      run before this point (we have not begun serving yet), so no durable
        //      record is lost and no new append collides with un-recovered WAL data.
        if handlers::durability() == handlers::DurabilityMode::Wal {
            let open_res = match wal_segment_bytes {
                Some(sz) => wal::walset::WalSet::open_with_segment_size(
                    &data_dir, wal_shards, workers, sz,
                ),
                None => wal::walset::WalSet::open(&data_dir, wal_shards, workers),
            };
            let walset = open_res.unwrap_or_else(|e| {
                eprintln!("error: {e}");
                std::process::exit(2);
            });
            wal::recovery::recover(&store, &walset).expect("WAL recovery failed");
            walset
                .reset_after_recovery()
                .expect("WAL reset after recovery failed");
            // Attach so the append path's `maybe_sync_on_ack` sees it (lock-free
            // `OnceLock::get` on the hot path). Empty for strict/fast = inert.
            store
                .wal
                .set(Arc::clone(&walset))
                .unwrap_or_else(|_| panic!("WAL already attached"));
            walset.spawn_committers();
            // Per-shard checkpoint ticker (spec §7): periodically `fdatasync` each
            // shard's touched per-stream files and recycle its WAL below the
            // checkpoint. Non-blocking w.r.t. acks (those gate on the committer's
            // durable_lsn, never on checkpoint).
            spawn_checkpoint_ticker(Arc::clone(&walset));
            // 1 Hz per-shard `WAL_STATS` emitter (spec §11): batch-size
            // distribution + durability gauges. No-op unless built with
            // `--features telemetry`; off the hot commit/append path.
            wal::telemetry::spawn_emitter(Arc::clone(&walset));
        }

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

/// How often the checkpoint ticker drives each shard's `checkpoint` (spec §7).
/// A sane v1 constant: frequent enough that the WAL doesn't grow unbounded on a
/// busy server, infrequent enough that the batched per-stream `fdatasync`s stay
/// amortized. Checkpoint is non-blocking w.r.t. acks, so this is purely the
/// WAL-recycle / per-stream-durability cadence (tunable is follow-up #9).
const CHECKPOINT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(3);

/// Spawn the per-shard checkpoint ticker (spec §7). One `tokio::time::interval`
/// driver that, each tick, runs every shard's `checkpoint` (each: batched
/// `fdatasync` of its touched per-stream files → persist `checkpoint_lsn` →
/// recycle WAL segments below it). A checkpoint error is logged, not fatal — a
/// failed/lagging checkpoint only delays WAL recycling (the disk-bounded safety
/// valve, spec §7), never blocks appends.
fn spawn_checkpoint_ticker(walset: Arc<wal::walset::WalSet>) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(CHECKPOINT_INTERVAL);
        // Skip the immediate first tick — there is nothing to checkpoint at boot.
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        ticker.tick().await;
        loop {
            ticker.tick().await;
            for shard in walset.shards() {
                if let Err(e) = shard.checkpoint().await {
                    eprintln!("WAL checkpoint failed for shard {:?}: {e}", shard.dir());
                }
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
