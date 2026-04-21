# Progress

## Timeline

- 2026-04-21 — Session started. Worktree created at
  `~/code/electric-sql/worktrees/electric/sv1466-response-size-metric`.
- Read `ServeShapePlug.end_telemetry_span/_`. Confirmed
  `conn.assigns[:streaming_bytes_sent]` is accessible; existing event
  `[:electric, :plug, :serve_shape]` already reports bytes but without
  `root_table` tag.
- Looked at `ElectricTelemetry.StackTelemetry.metrics/1`: metrics are declared
  via `Telemetry.Metrics` macros (distribution/counter/sum/last_value). The
  OTel exporter (`OtelMetricExporter`) converts distributions to histograms.
  That's the established pattern.
- Decision: emit a **separate** telemetry event rather than augmenting the
  existing `[:electric, :plug, :serve_shape]` event. Reasons:
  1. That event is already used for a duration distribution (with a `keep`
     filter dropping live requests) and is consumed by spans; adding
     high-cardinality tags to it risks affecting other reporters.
  2. A dedicated event makes the histogram's intent obvious and independent
     of tracing plumbing.
- `root_table` source: `conn.query_params["table"]` or `request.params.table`
  (same sources used for the `shape.root_table` span attribute).
- `is_live` source: existing `get_live_mode/1` private helper.

## Operational issues

- Git identity on the freshly cloned worktree defaulted to Oleksii's global
  config; had to re-apply the `~/agents/github/erik/.gitconfig` settings
  (`user.name`, `user.email`, `user.signingkey`, `commit.gpgsign`, `gpg.format`)
  on the local clone. Possible improvement: make `gclone` honour per-agent
  gitconfig includes.
