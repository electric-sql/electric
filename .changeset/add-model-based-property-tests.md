---
'@electric-sql/client': patch
---

Add fast-check model-based and micro-target property tests (plus static analysis for unbounded retry loops, unconditional 409 cache busters, tail-position awaits, and error-path `#publish` calls) and fix client bugs uncovered by the new PBT suite:

**Stream / retry-loop fixes (uncovered by model-based PBT):**
- Unconditionally create a new cache buster on every 409 response so that the follow-up request URL always differs from the pre-409 URL (prevents CDN infinite loops on cached 409s).
- Fix a parked stack-frame leak in `ShapeStream#start` where awaiting a never-resolving live fetch retained the full error handler chain.
- Add `EXPERIMENTAL_LIVE_SSE_QUERY_PARAM` to `ELECTRIC_PROTOCOL_QUERY_PARAMS` so `canonicalShapeKey` strips it; previously the SSE and long-polling code paths produced divergent cache keys for the same shape.
- Replace the raw 409 response body publish in `#requestShape` with a synthetic `must-refetch` control message so subscribers clear accumulated state rather than receiving stale data rows.
- Bound the `onError` retry loop at 50 consecutive retries so a broken `onError` handler can no longer spin forever.

**Micro-target PBT fixes:**
- `canonicalShapeKey` collapsing duplicate query params
- `Shape#process` clobbering notifications on `[up-to-date, insert]` batches
- `subset__limit=0` / `subset__offset=0` dropped on GET path due to truthiness check
- Non-canonical JSON keys in `Shape#reexecuteSnapshots` dedup
- `snakeToCamel` colliding multi-underscore columns
- `Shape#reexecuteSnapshots` swallowing errors silently
- `SnapshotTracker` leaving stale reverse-index entries on re-add/remove
- `Shape#awaitUpToDate` hanging forever on a terminally-errored stream

**Shape notification contract fix:**
- `Shape#process` no longer notifies subscribers on data messages while the shape is still `syncing` (i.e. before the first `up-to-date` control message). Previously, the sync-service's initial response (offset=-1) could cause subscribers to fire with a partial view while `stream.lastSyncedAt()` was still `undefined`. Shape now follows the N1/N2 invariants documented in `SPEC.md` (Shape notification semantics).
- `Shape#process` no longer fires an intermediate empty-rows notification on `must-refetch`. The status transitions back to `syncing` and subscribers receive the post-rotation state on the next `up-to-date`, matching the long-standing `should resync from scratch on a shape rotation` integration test.
