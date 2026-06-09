---
'@core/electric-telemetry': patch
'@core/sync-service': patch
---

Expose key stack-level metrics on the Prometheus `/metrics` endpoint: number of
defined shapes, number of active shapes, replication lag (byte-based slot lag
and time-based receive-lag histogram), retained WAL size, and per-status-code
counts of shape-endpoint HTTP responses
(`electric_plug_serve_shape_requests_count{status="200"}`, `409`, `503`, ...),
and admission-control concurrency/rejection counts
(`electric_admission_control_acquire_current{kind=...}`,
`electric_admission_control_reject_count{kind=...}`).
These metrics were already collected and exported to OTel/StatsD/Call-Home but
not to Prometheus, which previously only served system-level (CPU/RAM/BEAM)
metrics. A new `additional_prometheus_metrics` telemetry option routes them
through the single shared Prometheus aggregator without double-reporting via the
other reporters. Assumes a single stack per instance.
