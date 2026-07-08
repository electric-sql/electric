//! Lightweight, always-cheap server-side load telemetry for bottleneck analysis
//! (cardinality-cliff performance work). Answers the core question — is the server
//! CPU-bound, fsync/durability-bound, or lock-bound? — for BOTH wal and memory
//! modes, which the WAL-only `--wal-stats` counters cannot.
//!
//! Enabled by `--server-stats N` (seconds). Off by default and gated by
//! `STATS_ON`, so the hot-path instrumentation is a single relaxed load + branch
//! when disabled. Each tick prints a `SRV_STATS` line and resets the interval
//! accumulators.
//!
//! Fields:
//! - `cpu_cores`   process CPU utilization in cores (utime+stime delta / wall);
//!                 ≈ the cgroup cpu quota ⇒ CPU-bound. Linux only (`-1` elsewhere).
//! - `appends_s`   acked appends/sec over the interval.
//! - `inflight`    in-flight append handlers sampled at tick time (queue depth).
//! - `svc_us`      mean append handler wall time (service time).
//! - `applock_us`  mean time waiting to acquire the per-stream appender lock.
//! - `durwait_us`  mean time in `wait_durable_lsn` (WAL fsync wait; ~0 in memory).

use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::time::Instant;

static STATS_ON: AtomicBool = AtomicBool::new(false);
static APPENDS: AtomicU64 = AtomicU64::new(0);
static INFLIGHT: AtomicI64 = AtomicI64::new(0);
static SVC_US: AtomicU64 = AtomicU64::new(0);
static APPLOCK_US: AtomicU64 = AtomicU64::new(0);
static DURWAIT_US: AtomicU64 = AtomicU64::new(0);

pub fn set_enabled(v: bool) {
    STATS_ON.store(v, Ordering::Relaxed);
}
#[inline]
pub fn enabled() -> bool {
    STATS_ON.load(Ordering::Relaxed)
}

/// RAII probe for one append handler: bumps the in-flight gauge on creation and,
/// on drop (covering every early return), records the service time and counts the
/// append. Create it once `enabled()` is true.
pub struct AppendProbe {
    start: Instant,
}
impl AppendProbe {
    #[inline]
    pub fn start() -> Option<Self> {
        if !enabled() {
            return None;
        }
        INFLIGHT.fetch_add(1, Ordering::Relaxed);
        Some(Self { start: Instant::now() })
    }
}
impl Drop for AppendProbe {
    fn drop(&mut self) {
        INFLIGHT.fetch_sub(1, Ordering::Relaxed);
        SVC_US.fetch_add(self.start.elapsed().as_micros() as u64, Ordering::Relaxed);
        APPENDS.fetch_add(1, Ordering::Relaxed);
    }
}

#[inline]
pub fn record_applock_wait(d: std::time::Duration) {
    if enabled() {
        APPLOCK_US.fetch_add(d.as_micros() as u64, Ordering::Relaxed);
    }
}
#[inline]
pub fn record_durwait(d: std::time::Duration) {
    if enabled() {
        DURWAIT_US.fetch_add(d.as_micros() as u64, Ordering::Relaxed);
    }
}

/// Read process CPU time (utime+stime) in seconds from `/proc/self/stat`. Linux
/// only; `None` elsewhere (macOS dev boxes — use a Linux container to profile).
#[cfg(target_os = "linux")]
fn cpu_secs() -> Option<f64> {
    let s = std::fs::read_to_string("/proc/self/stat").ok()?;
    // comm (field 2) may contain spaces/parens — parse after the final ')'.
    let rest = &s[s.rfind(')')? + 1..];
    let f: Vec<&str> = rest.split_whitespace().collect();
    // After ')': [state, ppid, ...]; utime is field 14 ⇒ index 11, stime ⇒ 12.
    let utime: f64 = f.get(11)?.parse().ok()?;
    let stime: f64 = f.get(12)?.parse().ok()?;
    let hz = 100.0; // _SC_CLK_TCK is 100 on all our targets.
    Some((utime + stime) / hz)
}
#[cfg(not(target_os = "linux"))]
fn cpu_secs() -> Option<f64> {
    None
}

/// Spawn the periodic printer. Each tick emits one `SRV_STATS` line and resets the
/// interval accumulators.
pub fn spawn(secs: u64) {
    set_enabled(true);
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(secs));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        ticker.tick().await;
        let mut last_cpu = cpu_secs();
        let mut last = Instant::now();
        loop {
            ticker.tick().await;
            let now = Instant::now();
            let wall = now.duration_since(last).as_secs_f64();
            last = now;

            let appends = APPENDS.swap(0, Ordering::Relaxed);
            let svc = SVC_US.swap(0, Ordering::Relaxed);
            let applock = APPLOCK_US.swap(0, Ordering::Relaxed);
            let durwait = DURWAIT_US.swap(0, Ordering::Relaxed);
            let inflight = INFLIGHT.load(Ordering::Relaxed);

            let cpu_cores = match (cpu_secs(), last_cpu) {
                (Some(c), Some(p)) if wall > 0.0 => {
                    last_cpu = Some(c);
                    (c - p) / wall
                }
                (Some(c), _) => {
                    last_cpu = Some(c);
                    -1.0
                }
                _ => -1.0,
            };

            let n = appends.max(1) as f64;
            eprintln!(
                "SRV_STATS cpu_cores={:.2} appends_s={:.0} inflight={} svc_us={:.0} applock_us={:.1} durwait_us={:.1}",
                cpu_cores,
                appends as f64 / wall.max(0.001),
                inflight,
                svc as f64 / n,
                applock as f64 / n,
                durwait as f64 / n,
            );
        }
    });
}
