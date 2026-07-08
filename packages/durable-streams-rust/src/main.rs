mod api;
mod blobstore;
mod engine_raw;
mod handlers;
mod http1;
#[cfg(target_os = "linux")]
mod sse_reactor;
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

/// True if `<data_dir>/wal` holds a `*.wal` segment that contains at least one
/// RECORD (`wal/<shard>/*.wal` layout, or directly under `wal/`). Used to fail
/// fast when `--durability memory` is pointed at a data dir left behind by a
/// previous `--durability wal` run — memory mode never opens/replays a WAL, so it
/// would silently ignore those records (and drop any not yet folded into the
/// per-stream files). A clean rejection beats a silent divergence.
///
/// A segment with a record begins with a non-zero header (`[0..4)` framed `len`,
/// `[8..16)` `lsn ≥ 1`); a fresh/`fallocate`-zeroed segment reads as all-zero. We
/// therefore ignore empty (never-written or reset) segments — but this is
/// FAIL-CLOSED: records that were already checkpointed into the per-stream files
/// still physically occupy the segment until the next startup recycles it, so
/// this can over-report (reject a dir that is actually safe), never under-report.
fn wal_dir_has_segments(wal_dir: &std::path::Path) -> bool {
    // A segment holds a record iff its first 16 header bytes are not all zero.
    fn has_record(path: &std::path::Path) -> bool {
        use std::io::Read;
        let Ok(mut f) = std::fs::File::open(path) else {
            return false;
        };
        let mut hdr = [0u8; 16];
        matches!(f.read_exact(&mut hdr), Ok(())) && hdr != [0u8; 16]
    }
    let is_wal = |p: &std::path::Path| p.extension().and_then(|e| e.to_str()) == Some("wal");
    let Ok(entries) = std::fs::read_dir(wal_dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if is_wal(&path) && has_record(&path) {
            return true;
        }
        if path.is_dir() {
            if let Ok(inner) = std::fs::read_dir(&path) {
                for e in inner.flatten() {
                    let p = e.path();
                    if is_wal(&p) && has_record(&p) {
                        return true;
                    }
                }
            }
        }
    }
    false
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
    // N is rejected with exit 2 (spec §5).
    let mut wal_shards: Option<usize> = None;
    // `--worker-threads N` sizes the tokio runtime's worker-thread pool (and the
    // default WAL shard count). `None` ⇒ `available_parallelism()`. This is
    // load-bearing under a cgroup cpu limit: `available_parallelism()` reads
    // `cpu.max`, so on a big node with a small limit it would under-size the pool;
    // an explicit value (e.g. the ds-bench pool suites' `--worker-threads 32`)
    // pins the pool to the intended core count regardless.
    let mut worker_threads: Option<usize> = None;
    // `--wal-segment-bytes N` overrides the per-shard WAL segment size (the
    // `fallocate` size + segment-roll threshold). `None` ⇒ the 128 MiB default.
    // Useful for forcing rolls in tests and benches without writing a full 128 MiB segment.
    let mut wal_segment_bytes: Option<u64> = None;
    // `--wal-stats N`: every N seconds print a `WAL_CONT` line of per-interval WAL
    // contention rates (lock-wait, wakeup fan-out, coalescing) to stderr, and arm
    // the hot-path timing that feeds it. OFF by default (no clock reads on the
    // append path). Dependency-free — the measurement vehicle for the contention
    // investigation, independent of the heavy `telemetry` OTLP feature.
    let mut wal_stats_secs: Option<u64> = None;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--host" => host = parse_val(args.next(), "--host"),
            "--port" => port = parse_val(args.next(), "--port"),
            "--data-dir" => data_dir = val(args.next(), "--data-dir").into(),
            "--long-poll-timeout-ms" => {
                handlers::set_long_poll_timeout(parse_val(args.next(), "--long-poll-timeout-ms"));
            }
            // Resident tail-cache cap (bytes); 0 disables it (reads → sendfile/pread).
            // Default is platform-dependent (off on Linux, 64 KiB on macOS).
            "--tail-cache-bytes" => {
                store::set_tail_cache_bytes(parse_val(args.next(), "--tail-cache-bytes"));
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
            "--wal-shards" => {
                let n: usize = parse_val(args.next(), "--wal-shards");
                if n == 0 {
                    eprintln!("--wal-shards must be ≥ 1");
                    std::process::exit(2);
                }
                wal_shards = Some(n);
            }
            "--worker-threads" => {
                let n: usize = parse_val(args.next(), "--worker-threads");
                if n == 0 {
                    eprintln!("--worker-threads must be ≥ 1");
                    std::process::exit(2);
                }
                worker_threads = Some(n);
            }
            "--wal-segment-bytes" => {
                let n: u64 = parse_val(args.next(), "--wal-segment-bytes");
                if n == 0 {
                    eprintln!("--wal-segment-bytes must be ≥ 1");
                    std::process::exit(2);
                }
                wal_segment_bytes = Some(n);
            }
            "--wal-stats" => {
                let n: u64 = parse_val(args.next(), "--wal-stats");
                if n == 0 {
                    eprintln!("--wal-stats must be ≥ 1 (seconds)");
                    std::process::exit(2);
                }
                wal_stats_secs = Some(n);
            }
            "--durability" => {
                let v = val(args.next(), "--durability");
                match handlers::parse_durability(&v) {
                    Some(m) => handlers::set_durability(m),
                    None => {
                        eprintln!("--durability must be wal|memory");
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

    // Apply --durability memory AFTER the arg loop. Memory mode is the buffered
    // append path with the WAL stage/wait skipped (no splice intercept, no forced
    // tail-cache-off — those belonged to the removed zero-copy path); the only
    // gate is refusing to silently ignore a WAL left by a previous wal run.
    if handlers::durability() == handlers::DurabilityMode::Memory {
        // Fail fast on a WAL left by a previous `--durability wal` run: memory mode
        // never opens/replays it, so starting here would silently ignore those
        // records (and drop any not yet folded into the per-stream files). Refuse
        // rather than diverge quietly; the operator can replay with `--durability
        // wal` first, or remove the `wal/` directory to discard it deliberately.
        let wal_dir = data_dir.join("wal");
        if wal_dir_has_segments(&wal_dir) {
            eprintln!(
                "error: --durability memory refuses to start: {} holds a WAL from a previous \
                 --durability wal run. Memory mode would ignore it and could drop un-checkpointed \
                 records. Replay it first with --durability wal, or remove {} to discard it.",
                wal_dir.display(),
                wal_dir.display()
            );
            std::process::exit(2);
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

    let workers = worker_threads.unwrap_or_else(|| std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4));
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
        // Batched meta-sidecar sweeper (#4691): flushes every stream queued by
        // `Store::mark_meta_dirty` (memory-mode appends, TTL read touches) in
        // one pass per tick, replacing the per-stream 100 ms debounce timer.
        // Spawned in BOTH durability modes — wal mode still queues TTL read
        // touches here (its append path flushes via the checkpoint instead).
        spawn_meta_sweeper(Arc::clone(&store));

        // ---- WAL wiring (Wal mode only) ----
        //
        // Skipped entirely in `--durability memory` mode — no WAL is opened,
        // recovered, or attached, and no committers/ticker spawn. The buffered
        // append path (`write_wire` → `maybe_sync_on_ack`) acks on the
        // page-cache file write alone (see `DurabilityMode::Memory` no-op).
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
        // Held so the shutdown path can stop + join the dedicated committer
        // threads (Tier-2a) after draining in-flight requests. `None` in
        // `--durability memory` mode (no committers spawned).
        let mut wal_for_shutdown: Option<Arc<wal::walset::WalSet>> = None;
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
            store
                .wal
                .set(Arc::clone(&walset))
                .unwrap_or_else(|_| panic!("WAL already attached"));
            // Arm the contention timing + spawn the dependency-free stderr
            // emitter BEFORE committers/serving start, so every acquisition from
            // the first append is timed. No-op (and no clock reads) when the flag
            // is absent.
            if let Some(secs) = wal_stats_secs {
                wal::telemetry::set_stats_enabled(true);
                wal::telemetry::spawn_stats_emitter(
                    Arc::clone(&walset),
                    std::time::Duration::from_secs(secs),
                );
            }
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
            wal_for_shutdown = Some(walset);
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
                // Close reactor-served SSE subscribers first so their permits are
                // released and `drain` doesn't wait out the full grace period.
                #[cfg(target_os = "linux")]
                sse_reactor::shutdown();
                engine_raw::drain(std::time::Duration::from_secs(25)).await;
                // Stop + join the dedicated committer threads (Tier-2a) AFTER the
                // request drain, so any commit a just-drained request staged is
                // covered by each committer's final drain before the thread exits.
                if let Some(walset) = wal_for_shutdown.take() {
                    walset.stop_committers();
                }
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
            // All shards checkpoint CONCURRENTLY. Each checkpoint is one
            // spawn_blocking task (capture + per-stream fdatasyncs + tails/ckpt
            // persist + recycle), so a serial walk makes every per-stream fsync
            // across the whole server queue behind a single shard's — at high
            // stream cardinality that serialization is what stretches the
            // checkpoint wave (and on real disks wastes the device's parallelism).
            let mut wave = tokio::task::JoinSet::new();
            for shard in walset.shards() {
                let shard = Arc::clone(shard);
                wave.spawn(async move {
                    if let Err(e) = shard.checkpoint().await {
                        eprintln!("WAL checkpoint failed for shard {:?}: {e}", shard.dir());
                    }
                });
            }
            while wave.join_next().await.is_some() {}
        }
    });
}

/// How often the meta sweeper flushes dirty sidecars (#4691). The sidecar's
/// producer/access state is a non-durable, lagging flush by contract; 1 s keeps
/// the lag tighter than the wal checkpoint's 3 s cadence while still batching
/// away the per-stream timer + per-append rewrite the 100 ms debounce cost.
const META_SWEEP_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);

/// Spawn the store-level meta-sidecar sweeper: each tick drains the
/// `mark_meta_dirty` queue and writes every still-dirty stream's sidecar in one
/// `spawn_blocking` task (vs one timer task + one blocking task PER STREAM per
/// 100 ms under the old debounce — the ~5x memory-mode CPU overhead of #4691).
fn spawn_meta_sweeper(store: Arc<Store>) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(META_SWEEP_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        // Skip the immediate first tick — nothing can be dirty at boot.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if store.meta_sweep.lock().unwrap().is_empty() {
                continue;
            }
            let s = Arc::clone(&store);
            let _ = tokio::task::spawn_blocking(move || s.sweep_meta_once()).await;
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
