// Opt-in OpenTelemetry instrumentation (feature `telemetry`, OFF BY DEFAULT).
//
// The rest of the server calls the public `record_*` / `init` API here with NO
// `#[cfg]` at the call sites. Two implementations live behind a cfg switch:
//
//   * feature on  → real OTLP span + metric export, with a `Metrics` struct of
//     pre-resolved instruments stored in a `OnceLock`.
//   * feature off → empty `#[inline(always)]` no-ops and a unit `Guard`. The
//     optimiser deletes the calls entirely, so a default build pays nothing.
//
// `tracing` spans (see handlers.rs / handlers' SSE spawn) are ALWAYS compiled —
// they are cheap and inert unless a subscriber with the OTel layer is installed,
// which only happens when this feature is on. Bounded label sets only (see the
// cardinality rule in the design): engine, live, cache, outcome, is_json,
// method, status_class — never a stream path/id, producer id, offset, etag, …

// ===========================================================================
// Real implementation (feature `telemetry`).
// ===========================================================================
#[cfg(feature = "telemetry")]
mod imp {
    use std::sync::OnceLock;

    use opentelemetry::metrics::{Counter, Histogram, Meter};
    use opentelemetry::{global, KeyValue};
    use opentelemetry_otlp::{MetricExporter, SpanExporter};
    use opentelemetry_sdk::metrics::{Instrument, PeriodicReader, SdkMeterProvider, Stream, Temporality};
    use opentelemetry_sdk::trace::{Sampler, SdkTracerProvider};
    use opentelemetry_sdk::Resource;
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;
    use tracing_subscriber::{fmt, EnvFilter};

    /// Latency histogram bucket boundaries (seconds).
    const LATENCY_BUCKETS: &[f64] = &[
        0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5,
    ];
    /// Batch-size histogram bucket boundaries (count).
    const BATCH_BUCKETS: &[f64] = &[1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0, 128.0];

    /// Pre-resolved instrument handles. Resolving an instrument is cheap but not
    /// free, so we do it once at startup and store the handles here.
    pub struct Metrics {
        http_requests: Counter<u64>,
        append_fsync_duration: Histogram<f64>,
        append_fsync_batch_size: Histogram<u64>,
        append_lock_wait: Histogram<f64>,
        append_duration: Histogram<f64>,
        read_duration: Histogram<f64>,
        read_tail_cache: Counter<u64>,
        // Recorded only from the Linux-only blocking-sendfile offload path.
        #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
        read_offload_wait: Histogram<f64>,
    }

    impl Metrics {
        fn new(meter: &Meter) -> Self {
            Metrics {
                http_requests: meter
                    .u64_counter("ds.http.requests")
                    .with_description("HTTP requests handled, by method and status class.")
                    .build(),
                append_fsync_duration: meter
                    .f64_histogram("ds.append.fsync.duration")
                    .with_unit("s")
                    .with_description("Leader barrier-fsync duration for coalesced appends.")
                    .build(),
                append_fsync_batch_size: meter
                    .u64_histogram("ds.append.fsync.batch_size")
                    .with_description("Appends coalesced into one group-commit fsync.")
                    .build(),
                append_lock_wait: meter
                    .f64_histogram("ds.append.lock_wait.duration")
                    .with_unit("s")
                    .with_description("Time spent waiting for the per-stream append lock.")
                    .build(),
                append_duration: meter
                    .f64_histogram("ds.append.duration")
                    .with_unit("s")
                    .with_description("End-to-end append handler duration, by outcome.")
                    .build(),
                read_duration: meter
                    .f64_histogram("ds.read.duration")
                    .with_unit("s")
                    .with_description("Read handler duration, by live mode and cache result.")
                    .build(),
                read_tail_cache: meter
                    .u64_counter("ds.read.tail_cache")
                    .with_description("Resident tail-chunk cache hits / misses, by live mode.")
                    .build(),
                read_offload_wait: meter
                    .f64_histogram("ds.read.offload.wait")
                    .with_unit("s")
                    .with_description("Blocking-pool queue wait before a cold offloaded read runs.")
                    .build(),
            }
        }
    }

    static METRICS: OnceLock<Metrics> = OnceLock::new();

    fn metrics() -> Option<&'static Metrics> {
        METRICS.get()
    }

    /// Held for the lifetime of the process; its `Drop`/`shutdown` flushes the
    /// batch span processor and the periodic metric reader.
    pub struct Guard {
        tracer_provider: Option<SdkTracerProvider>,
        meter_provider: Option<SdkMeterProvider>,
    }

    impl Guard {
        /// Flush and shut down the exporters. Idempotent.
        pub fn shutdown(&mut self) {
            if let Some(p) = self.tracer_provider.take() {
                let _ = p.shutdown();
            }
            if let Some(p) = self.meter_provider.take() {
                let _ = p.shutdown();
            }
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            self.shutdown();
        }
    }

    /// Build the OTel resource, honoring OTEL_SERVICE_NAME / OTEL_RESOURCE_ATTRIBUTES
    /// (Resource::builder() reads those env vars) with sensible defaults from the
    /// crate metadata.
    fn build_resource() -> Resource {
        Resource::builder()
            .with_service_name(env!("CARGO_PKG_NAME"))
            .with_attribute(KeyValue::new(
                opentelemetry_semantic_conventions::resource::SERVICE_VERSION,
                env!("CARGO_PKG_VERSION"),
            ))
            .build()
    }

    /// Parent-based sampler from OTEL_TRACES_SAMPLER / OTEL_TRACES_SAMPLER_ARG.
    /// Defaults to parentbased_traceidratio with ratio 1.0 (sample everything).
    fn build_sampler() -> Sampler {
        let kind = std::env::var("OTEL_TRACES_SAMPLER")
            .unwrap_or_else(|_| "parentbased_traceidratio".to_string());
        let arg: f64 = std::env::var("OTEL_TRACES_SAMPLER_ARG")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1.0);
        match kind.as_str() {
            "always_on" => Sampler::AlwaysOn,
            "always_off" => Sampler::AlwaysOff,
            "traceidratio" => Sampler::TraceIdRatioBased(arg),
            "parentbased_always_on" => Sampler::ParentBased(Box::new(Sampler::AlwaysOn)),
            "parentbased_always_off" => Sampler::ParentBased(Box::new(Sampler::AlwaysOff)),
            // "parentbased_traceidratio" and anything unrecognised.
            _ => Sampler::ParentBased(Box::new(Sampler::TraceIdRatioBased(arg))),
        }
    }

    /// Explicit-bucket view for the named instrument (boundaries in `buckets`).
    fn bucket_view(name: &'static str, buckets: &'static [f64]) -> impl Fn(&Instrument) -> Option<Stream> {
        move |i: &Instrument| {
            if i.name() == name {
                Some(
                    Stream::builder()
                        .with_aggregation(
                            opentelemetry_sdk::metrics::Aggregation::ExplicitBucketHistogram {
                                boundaries: buckets.to_vec(),
                                record_min_max: true,
                            },
                        )
                        .build()
                        .unwrap(),
                )
            } else {
                None
            }
        }
    }

    /// Initialise tracing + OTLP export. Endpoint/protocol/timeout all come from
    /// the standard OTEL_EXPORTER_OTLP_* env vars (WithExportConfig defaults read
    /// them). Returns a `Guard` that must be held for the process lifetime and
    /// whose shutdown flushes pending spans/metrics.
    pub fn init() -> Guard {
        let resource = build_resource();

        // ---- traces ----
        let span_exporter = SpanExporter::builder().with_tonic().build();
        let tracer_provider = match span_exporter {
            Ok(exporter) => Some(
                SdkTracerProvider::builder()
                    .with_resource(resource.clone())
                    .with_sampler(build_sampler())
                    .with_batch_exporter(exporter)
                    .build(),
            ),
            Err(e) => {
                eprintln!("telemetry: span exporter init failed: {e}; spans disabled");
                None
            }
        };

        // ---- metrics ----
        let meter_provider = match MetricExporter::builder()
            .with_tonic()
            .with_temporality(Temporality::Cumulative)
            .build()
        {
            Ok(exporter) => {
                let reader = PeriodicReader::builder(exporter).build();
                let provider = SdkMeterProvider::builder()
                    .with_resource(resource)
                    .with_reader(reader)
                    .with_view(bucket_view("ds.append.fsync.duration", LATENCY_BUCKETS))
                    .with_view(bucket_view("ds.append.lock_wait.duration", LATENCY_BUCKETS))
                    .with_view(bucket_view("ds.append.duration", LATENCY_BUCKETS))
                    .with_view(bucket_view("ds.read.duration", LATENCY_BUCKETS))
                    .with_view(bucket_view("ds.read.offload.wait", LATENCY_BUCKETS))
                    .with_view(bucket_view("ds.append.fsync.batch_size", BATCH_BUCKETS))
                    .build();
                Some(provider)
            }
            Err(e) => {
                eprintln!("telemetry: metric exporter init failed: {e}; metrics disabled");
                None
            }
        };

        // ---- global providers + tracing subscriber ----
        let registry = tracing_subscriber::registry()
            .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
            .with(fmt::layer());

        if let Some(tp) = &tracer_provider {
            global::set_tracer_provider(tp.clone());
            use opentelemetry::trace::TracerProvider as _;
            let tracer = tp.tracer(env!("CARGO_PKG_NAME"));
            let otel_layer = tracing_opentelemetry::layer().with_tracer(tracer);
            let _ = registry.with(otel_layer).try_init();
        } else {
            let _ = registry.try_init();
        }

        if let Some(mp) = &meter_provider {
            global::set_meter_provider(mp.clone());
            let _ = METRICS.set(Metrics::new(&global::meter(env!("CARGO_PKG_NAME"))));
        }

        Guard {
            tracer_provider,
            meter_provider,
        }
    }

    // ---- record functions (no-ops until init() resolves the instruments) ----

    pub fn record_request(method: &'static str, status_class: &'static str) {
        if let Some(m) = metrics() {
            m.http_requests.add(
                1,
                &[
                    KeyValue::new("method", method),
                    KeyValue::new("status_class", status_class),
                ],
            );
        }
    }

    pub fn record_fsync(secs: f64, batch: u64) {
        if let Some(m) = metrics() {
            m.append_fsync_duration.record(secs, &[]);
            m.append_fsync_batch_size.record(batch, &[]);
        }
    }

    pub fn record_append_lock_wait(secs: f64) {
        if let Some(m) = metrics() {
            m.append_lock_wait.record(secs, &[]);
        }
    }

    pub fn record_append(secs: f64, outcome: &'static str, is_json: bool) {
        if let Some(m) = metrics() {
            m.append_duration.record(
                secs,
                &[
                    KeyValue::new("outcome", outcome),
                    KeyValue::new("is_json", is_json),
                ],
            );
        }
    }

    pub fn record_read(secs: f64, live: &'static str, cache_hit: bool) {
        if let Some(m) = metrics() {
            m.read_duration.record(
                secs,
                &[
                    KeyValue::new("live", live),
                    KeyValue::new("cache", if cache_hit { "hit" } else { "miss" }),
                ],
            );
        }
    }

    pub fn record_tail_cache(hit: bool, live: &'static str) {
        if let Some(m) = metrics() {
            m.read_tail_cache.add(
                1,
                &[
                    KeyValue::new("result", if hit { "hit" } else { "miss" }),
                    KeyValue::new("live", live),
                ],
            );
        }
    }

    // Called only from the Linux-only blocking-sendfile offload path.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub fn record_offload_wait(secs: f64) {
        if let Some(m) = metrics() {
            m.read_offload_wait.record(secs, &[]);
        }
    }
}

// ===========================================================================
// No-op implementation (feature off). Everything compiles out.
// ===========================================================================
// The no-op surface mirrors the real API exactly; some entry points (e.g.
// `record_offload_wait`, only called from the Linux-gated blocking sendfile path)
// are unused on a given host build, which is expected for a stable API shim.
#[cfg(not(feature = "telemetry"))]
#[allow(dead_code)]
mod imp {
    /// Unit guard; dropping it does nothing.
    pub struct Guard;

    impl Guard {
        #[inline(always)]
        pub fn shutdown(&mut self) {}
    }

    /// Initialise nothing. Returns a unit guard.
    #[inline(always)]
    pub fn init() -> Guard {
        Guard
    }

    #[inline(always)]
    pub fn record_request(_method: &'static str, _status_class: &'static str) {}
    #[inline(always)]
    pub fn record_fsync(_secs: f64, _batch: u64) {}
    #[inline(always)]
    pub fn record_append_lock_wait(_secs: f64) {}
    #[inline(always)]
    pub fn record_append(_secs: f64, _outcome: &'static str, _is_json: bool) {}
    #[inline(always)]
    pub fn record_read(_secs: f64, _live: &'static str, _cache_hit: bool) {}
    #[inline(always)]
    pub fn record_tail_cache(_hit: bool, _live: &'static str) {}
    #[inline(always)]
    pub fn record_offload_wait(_secs: f64) {}
}

// `Guard` and `record_offload_wait` are unused on some host/feature combinations
// (offload is a Linux-only sendfile path; Guard is held but not named on macOS),
// but are part of the stable public surface — keep the re-export complete.
#[allow(unused_imports)]
pub use imp::{
    init, record_append, record_append_lock_wait, record_fsync, record_offload_wait, record_read,
    record_request, record_tail_cache, Guard,
};
