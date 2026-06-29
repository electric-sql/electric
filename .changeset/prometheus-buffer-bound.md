---
'@core/sync-service': patch
'@core/electric-telemetry': patch
---

Fix unbounded memory growth in the Prometheus metrics reporter. When `ELECTRIC_PROMETHEUS_PORT` was set but the `/metrics` endpoint was scraped infrequently (or never — e.g. on OpenTelemetry-only deployments), distribution metrics such as `receive_lag` buffered one ETS row per observation without limit, eventually exhausting memory. Pins `telemetry_metrics_prometheus_core` to a fork that bounds the buffer by aggregating automatically on a size threshold and time fallback (upstream PR: https://github.com/beam-telemetry/telemetry_metrics_prometheus_core/pull/77).
