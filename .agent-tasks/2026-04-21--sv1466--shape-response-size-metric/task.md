# Task: Per-shape response-size metrics

Session ID: `2026-04-21--sv1466--shape-response-size-metric`
Upstream issue: electric-sql/stratovolt#1466

## Problem

Operators lack per-shape visibility into response sizes. Request-handler binary
memory grows significantly and it's unclear which shapes contribute. The data
needed for a per-shape histogram already exists on
`conn.assigns[:streaming_bytes_sent]` inside `ServeShapePlug.end_telemetry_span/_`.

## Fix

Emit a new telemetry event `[:electric, :shape, :response_size]` with a `bytes`
measurement, and labels `root_table`, `is_live`, `stack_id`.

Register it as a `distribution` metric (exported as OTel histogram via
`OtelMetricExporter`) at the name `electric.shape.response_size.bytes`,
keeping all three tags.

## Scope

- `packages/sync-service/lib/electric/plug/serve_shape_plug.ex`: emit
  the new event alongside the existing `[:electric, :plug, :serve_shape]`
  event, pulling `root_table` from the loaded request params and `is_live` from
  `get_live_mode/1`.
- `packages/electric-telemetry/lib/electric/telemetry/stack_telemetry.ex`:
  register the distribution metric with `tags: [:root_table, :is_live, :stack_id]`
  and `unit: :byte`.
- Add a changeset entry.

## Out of scope

- Any correlation with `process.bin_memory.total` — handled separately.
- Adjusting existing `[:electric, :plug, :serve_shape]` event (used by other
  metrics and traces).
