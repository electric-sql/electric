---
'@core/sync-service': patch
---

Propagate OpenTelemetry context into spawned snapshot and move-in tasks so that spans created via `with_child_span` (e.g. `shape_snapshot.execute_for_shape`, `shape_snapshot.query_fn`, `shape_snapshot.checkout_wait`) are linked to the originating trace instead of being silently dropped.
