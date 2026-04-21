# Populate unpopulated telemetry columns

Upstream issue: electric-sql/stratovolt#1465

## Summary

Several Honeycomb columns are defined but never populated:

- `num_bytes` — should be emitted on `ServeShapePlug` streaming completion (alongside `http.response_size`).
- `chunk_size` — should be emitted per chunk as a histogram at the shape chunk buffer flush point.
- `shape_snapshot.query.duration_us` — already landed via electric#4110; no code change needed, only confirm wiring.
- `electric.subqueries.subset_result.bytes` — should be emitted after subset materialisation.

## Investigation findings (worktree main @ b32d2128e)

- `Electric.Shapes.Api.Response.send_stream/2` already wraps each chunk with a `shape_get.plug.stream_chunk` span and sets `chunk_size` as an attribute. The total `streaming_bytes_sent` assign is used for `http.response_size`.
- `Electric.Plug.ServeShapePlug.end_telemetry_span/2` already emits the `[:electric, :plug, :serve_shape]` telemetry event with a `bytes` measurement but never sets `num_bytes` as a span attribute — hence the empty Honeycomb column.
- `Electric.Shapes.PartialModes.record_subset_metrics/4` emits `[:electric, :subqueries, :subset_result]` telemetry with `bytes` but does not set any span attribute, so the Honeycomb column `electric.subqueries.subset_result.bytes` remains empty.
- `shape_snapshot.query.duration_µs` is set as a span attribute via `OpenTelemetry.stop_and_save_intervals` in `SnapshotQuery.execute_for_shape/4` (PR #4110). The issue uses `_us` but the column in Honeycomb is the literal attribute name (Unicode `µ`). Not touching.

## Plan

1. In `ServeShapePlug.end_telemetry_span`, add `num_bytes` span attribute mirroring the existing `bytes` measurement.
2. In `PartialModes.record_subset_metrics`, add span attributes `electric.subqueries.subset_result.bytes`, `electric.subqueries.subset_result.rows`, `electric.subqueries.subset_result.duration_µs` to the current span.
3. Confirm `chunk_size` already set on `shape_get.plug.stream_chunk` child span; no change needed.
4. Add a changeset and a lightweight test if feasible.
