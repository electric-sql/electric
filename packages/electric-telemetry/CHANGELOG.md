# @core/electric-telemetry

## 0.1.2

### Patch Changes

- 10bee98: Restore the inclusion of stack_id in CallHomeReporter's static_info.

## 0.1.1

### Patch Changes

- c28e8ed: Extract telemetry code from Electric into a separate package, for easier modification and sharing of the telemetry code between Electric and Cloud.
- 5e5bbaf: Fix an issue where default Otel values defined in ElectricTelemetry.Opts were not used.
- 96cacdc: Fix the name of the metrics that reports replication slot's confirmed flush lag and add two new metrics: retained WAL size (the diff between PG's current LSN and the slot's restart_lsn) and the current PG LSN itself which can be used to plot the write rate happening in the database at any given time.
