---
'@core/sync-service': patch
---

Emit `shape_snapshot.execute_for_shape` and `shape_snapshot.query_fn` spans for `move_in_query` operations. Previously these spans were silently dropped because the spawned move-in task had no parent span context, and `with_child_span` skips emission when no parent exists. A `shape_snapshot.move_in_task` root span is now opened inside the task (mirroring `shape_snapshot.create_snapshot_task` for initial snapshots) so the existing child spans are emitted with `shape.query_reason="move_in_query"`.
