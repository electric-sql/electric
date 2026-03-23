# Improve ETS Observability

## Goal
Rebase and complete WIP PR #3632 which adds ETS table observability to electric-telemetry.

## What the WIP PR already has
- `ElectricTelemetry.EtsTables` module with functions to collect top N ETS tables by memory and by type
- Comprehensive tests for the module

## What needs to be added
1. Integration with the telemetry system:
   - Add `ets_table_memory` periodic measurement function in `ApplicationTelemetry` (similar to `process_memory`)
   - Add metric definitions for `ets_table.memory.total` (grouped by `table_type`) in `ApplicationTelemetry.metrics/1`
   - Add `top_ets_table_count` config option in `Opts`
2. Rebase the branch on latest main
3. Create a changeset entry
