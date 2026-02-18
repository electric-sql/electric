# @core/electric-telemetry

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
