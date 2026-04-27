---
'@core/electric-telemetry': patch
---

Fix telemetry metric exports to match emitted events

- Fix wrong event name: `shape_cache.create_snapshot_task` → `shape_snapshot.create_snapshot_task`
- Remove exports for metrics that are not emitted: `shape_monitor.active_reader_count`, `consumers_ready.failed_to_recover`
- Add missing exports: `plug.serve_shape.count`, `plug.serve_shape.bytes`, `storage.transaction_stored.operations`, `storage.snapshot_stored.operations`, `subqueries.move_in_triggered.count`, `postgres.info_looked_up.pg_version`, `shape_db.pool.checkout.queue_time_μs`
