use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// Router performance metrics
#[derive(Serialize, Deserialize)]
pub struct RouterMetrics {
    // Counters
    #[serde(skip)]
    presence_checks: AtomicU64,
    #[serde(skip)]
    presence_hits: AtomicU64,
    #[serde(skip)]
    route_calls: AtomicU64,
    #[serde(skip)]
    route_hits: AtomicU64,
    #[serde(skip)]
    route_misses: AtomicU64,
    #[serde(skip)]
    false_positives: AtomicU64,
    #[serde(skip)]
    rebuilds: AtomicU64,

    // Latency tracking (in nanoseconds)
    #[serde(skip)]
    total_presence_ns: AtomicU64,
    #[serde(skip)]
    total_route_ns: AtomicU64,
    #[serde(skip)]
    total_rebuild_ns: AtomicU64,

    // Shape match distribution
    #[serde(skip)]
    total_shapes_matched: AtomicU64,
}

impl RouterMetrics {
    pub fn new() -> Self {
        Self {
            presence_checks: AtomicU64::new(0),
            presence_hits: AtomicU64::new(0),
            route_calls: AtomicU64::new(0),
            route_hits: AtomicU64::new(0),
            route_misses: AtomicU64::new(0),
            false_positives: AtomicU64::new(0),
            rebuilds: AtomicU64::new(0),
            total_presence_ns: AtomicU64::new(0),
            total_route_ns: AtomicU64::new(0),
            total_rebuild_ns: AtomicU64::new(0),
            total_shapes_matched: AtomicU64::new(0),
        }
    }

    pub fn record_presence_check(&self, duration: Duration, hit: bool) {
        self.presence_checks.fetch_add(1, Ordering::Relaxed);
        if hit {
            self.presence_hits.fetch_add(1, Ordering::Relaxed);
        }
        self.total_presence_ns.fetch_add(duration.as_nanos() as u64, Ordering::Relaxed);
    }

    pub fn record_route_hit(&self, duration: Duration, shape_count: usize) {
        self.route_calls.fetch_add(1, Ordering::Relaxed);
        self.route_hits.fetch_add(1, Ordering::Relaxed);
        self.total_route_ns.fetch_add(duration.as_nanos() as u64, Ordering::Relaxed);
        self.total_shapes_matched.fetch_add(shape_count as u64, Ordering::Relaxed);
    }

    pub fn record_route_miss(&self, duration: Duration) {
        self.route_calls.fetch_add(1, Ordering::Relaxed);
        self.route_misses.fetch_add(1, Ordering::Relaxed);
        self.total_route_ns.fetch_add(duration.as_nanos() as u64, Ordering::Relaxed);
    }

    pub fn record_false_positive(&self, duration: Duration) {
        self.false_positives.fetch_add(1, Ordering::Relaxed);
        self.total_route_ns.fetch_add(duration.as_nanos() as u64, Ordering::Relaxed);
    }

    pub fn record_rebuild(&self, duration: Duration, _key_count: usize) {
        self.rebuilds.fetch_add(1, Ordering::Relaxed);
        self.total_rebuild_ns.fetch_add(duration.as_nanos() as u64, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> MetricsSnapshot {
        let presence_checks = self.presence_checks.load(Ordering::Relaxed);
        let presence_hits = self.presence_hits.load(Ordering::Relaxed);
        let route_calls = self.route_calls.load(Ordering::Relaxed);
        let route_hits = self.route_hits.load(Ordering::Relaxed);
        let route_misses = self.route_misses.load(Ordering::Relaxed);
        let false_positives = self.false_positives.load(Ordering::Relaxed);
        let rebuilds = self.rebuilds.load(Ordering::Relaxed);
        let total_presence_ns = self.total_presence_ns.load(Ordering::Relaxed);
        let total_route_ns = self.total_route_ns.load(Ordering::Relaxed);
        let total_rebuild_ns = self.total_rebuild_ns.load(Ordering::Relaxed);
        let total_shapes_matched = self.total_shapes_matched.load(Ordering::Relaxed);

        MetricsSnapshot {
            presence_checks,
            presence_hits,
            presence_hit_rate: if presence_checks > 0 {
                presence_hits as f64 / presence_checks as f64
            } else {
                0.0
            },
            route_calls,
            route_hits,
            route_misses,
            false_positives,
            false_positive_rate: if presence_hits > 0 {
                false_positives as f64 / presence_hits as f64
            } else {
                0.0
            },
            avg_presence_us: if presence_checks > 0 {
                (total_presence_ns as f64 / presence_checks as f64) / 1000.0
            } else {
                0.0
            },
            avg_route_us: if route_calls > 0 {
                (total_route_ns as f64 / route_calls as f64) / 1000.0
            } else {
                0.0
            },
            avg_shapes_per_hit: if route_hits > 0 {
                total_shapes_matched as f64 / route_hits as f64
            } else {
                0.0
            },
            rebuilds,
            avg_rebuild_ms: if rebuilds > 0 {
                (total_rebuild_ns as f64 / rebuilds as f64) / 1_000_000.0
            } else {
                0.0
            },
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct MetricsSnapshot {
    pub presence_checks: u64,
    pub presence_hits: u64,
    pub presence_hit_rate: f64,
    pub route_calls: u64,
    pub route_hits: u64,
    pub route_misses: u64,
    pub false_positives: u64,
    pub false_positive_rate: f64,
    pub avg_presence_us: f64,
    pub avg_route_us: f64,
    pub avg_shapes_per_hit: f64,
    pub rebuilds: u64,
    pub avg_rebuild_ms: f64,
}

impl Serialize for RouterMetrics {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.snapshot().serialize(serializer)
    }
}
