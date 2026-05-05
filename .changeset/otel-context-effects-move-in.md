---
'@core/sync-service': patch
---

Propagate OpenTelemetry context so that child spans in ShapeStatus and SnapshotQuery are linked to originating traces:

- `Effects.query_move_in_async`: propagate context into spawned task
- `ShapeCache.handle_call({:create_or_wait_shape_handle, ...})`: set context before calling ShapeStatus functions
- `ShapeCache.handle_call({:start_consumer_for_handle, ...})`: accept and set context from ConsumerRegistry
