# Progress log

## Session: 2026-04-21--sv1465--populate-telemetry-columns

### 2026-04-21

- Cloned worktree `sv1465-telemetry-columns` off electric main (`b32d2128e`).
- Audited the four columns called out in stratovolt#1465:
  - `num_bytes`: missing span attribute in `ServeShapePlug.end_telemetry_span/2`. Need to add.
  - `chunk_size`: already emitted as span attribute in `Api.Response.send_stream/2` (child span `shape_get.plug.stream_chunk`). No change needed.
  - `shape_snapshot.query.duration_us`: landed in electric#4110 as `shape_snapshot.query.duration_µs` (Unicode µ). Leaving as-is per the issue note (PR already merged).
  - `electric.subqueries.subset_result.bytes`: `PartialModes.record_subset_metrics/4` only calls `:telemetry.execute`, never sets a span attribute. Need to add span attributes.
- Decided to mirror the span-attribute naming that Honeycomb already expects: dotted `electric.subqueries.subset_result.*` paths.

### Implementation

- Added `num_bytes` attribute to the ServeShapePlug root span alongside the existing `bytes` telemetry measurement.
- Added span attributes `electric.subqueries.subset_result.bytes`, `.rows`, `.duration_µs` on the subset materialisation span.
- `chunk_size` left untouched; already wired.

### Operational issues

- `gclone` is a fish function; had to invoke it via `fish -c` from bash sessions (noted in instructions).
