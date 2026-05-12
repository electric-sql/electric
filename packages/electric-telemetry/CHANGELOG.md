# @core/electric-telemetry

## 0.2.5

### Patch Changes

- 4c52d76: Update Elixir deps to latest available versions

## 0.2.4

### Patch Changes

- 29a8cde: Add subset telemetry for query result rows and bytes, capture POST body params as request telemetry attributes, and expose subset result rows in stack telemetry.

## 0.2.3

### Patch Changes

- f541e65: Fix telemetry metric exports to match emitted events
  - Fix wrong event name: `shape_cache.create_snapshot_task` → `shape_snapshot.create_snapshot_task`
  - Remove exports for metrics that are not emitted: `shape_monitor.active_reader_count`, `consumers_ready.failed_to_recover`
  - Add missing exports: `plug.serve_shape.count`, `plug.serve_shape.bytes`, `storage.transaction_stored.operations`, `storage.snapshot_stored.operations`, `subqueries.move_in_triggered.count`, `postgres.info_looked_up.pg_version`, `shape_db.pool.checkout.queue_time_μs`

## 0.2.2

### Patch Changes

- c48f0bc: Export `electric.admission_control.acquire.limit` and `electric.admission_control.reject.limit` metrics so dashboards can plot fill percentage (`acquire.current / acquire.limit`) and over-limit pressure by `kind`.

## 0.2.1

### Patch Changes

- e9db22c: Add binary memory, average number of off-heap binaries and their ref counts to top processes by memory metric.
- 1a4d094: Remove unused stack-level Prometheus reporter to fix unbounded ETS table growth

## 0.2.0

### Minor Changes

- cc623d7: Add ETS table memory observability metrics, reporting top N table types by memory usage similar to process memory metrics

## 0.1.10

### Patch Changes

- 0aa8c00: Extend top processes by memory metric to collect processes until the specified mem usage threshold is covered.

  `ELECTRIC_TELEMETRY_TOP_PROCESS_COUNT` has been renamed to `ELECTRIC_TELEMETRY_TOP_PROCESS_LIMIT` with a new format: `count:<N>` or `mem_percent:<N>`. The old env var is still accepted as a fallback.

- 0aa8c00: Group request handler processes together to see their aggregated memory usage.

## 0.1.9

### Patch Changes

- 2659598: chore: ensure more metrics are pushed via statsd

## 0.1.8

### Patch Changes

- b1138d9: Include snapshot metrics in exports
- bc538c1: Track subset query metrics
- 69ba13c: Update all Elixir dependencies to latest versions

## 0.1.7

### Patch Changes

- fa61cc1: Export number of affected shapes per transaction into the global metrics
- 7e9791c: Delay first collection of statistics so that shape db system has time to start properly

## 0.1.6

### Patch Changes

- 2bf16e0: Fix call-home reporting of disk usage

## 0.1.5

### Patch Changes

- e63a054: Add transaction stored count in core metrics we export.
- b17eac8: Ensure storage dir exists before writing cached disk usage information

## 0.1.4

### Patch Changes

- 34a240b: fix: metrics from consumer seem to not be emitted because of a struct
- dfcfa40: Add disk usage telemetry to stacks.

## 0.1.3

### Patch Changes

- 6b7b453: Bring back previously removed median and mode fields to Summary metrics in CallHomeReporter's payload (applies to used_memory, run_queue_total, run_queue_cpu, run_queue_io, and wal_size). Their absence caused the remote collector server to reject incoming reports.

## 0.1.2

### Patch Changes

- 10bee98: Restore the inclusion of stack_id in CallHomeReporter's static_info.

## 0.1.1

### Patch Changes

- c28e8ed: Extract telemetry code from Electric into a separate package, for easier modification and sharing of the telemetry code between Electric and Cloud.
- 5e5bbaf: Fix an issue where default Otel values defined in ElectricTelemetry.Opts were not used.
- 96cacdc: Fix the name of the metrics that reports replication slot's confirmed flush lag and add two new metrics: retained WAL size (the diff between PG's current LSN and the slot's restart_lsn) and the current PG LSN itself which can be used to plot the write rate happening in the database at any given time.
