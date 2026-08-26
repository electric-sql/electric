---
"@core/sync-service": patch
"@core/electric-telemetry": patch
---

Replace the non-ASCII `µs`/`μs` microsecond suffix used in several telemetry metric and span attribute names with the plain-ASCII `us`. Some metrics backends (e.g. Mimir/Prometheus) reject metric names containing non-ASCII characters, which previously caused ingestion of the affected metrics to fail.
