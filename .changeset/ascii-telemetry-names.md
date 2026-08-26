---
"@core/sync-service": minor
"@core/electric-telemetry": minor
---

**Breaking change**: renamed several telemetry metric and span attribute names, replacing their non-ASCII `µs`/`μs` microsecond suffix with the plain-ASCII `us`. Some metrics backends (e.g. Mimir/Prometheus) reject metric names containing non-ASCII characters, which previously caused ingestion of the affected metrics to fail. Any dashboards, alerts, or queries referencing the old attribute names (e.g. `shape_db.pool.checkout.queue_time_μs`) need to be updated to the new ASCII names (e.g. `shape_db.pool.checkout.queue_time_us`).
