# Implementation Plan

## Overview
Add ETS table observability by integrating the existing `ElectricTelemetry.EtsTables` module into the telemetry pipeline, following the same pattern as `process_memory`.

## Steps

### Step 1: Add config option
File: `packages/electric-telemetry/lib/electric/telemetry/opts.ex`
- Add `top_ets_table_count: [type: :integer, default: 10]` to `intervals_and_thresholds`

### Step 2: Add periodic measurement and metrics to ApplicationTelemetry
File: `packages/electric-telemetry/lib/electric/telemetry/application_telemetry.ex`
- Add `ets_table_memory/1` function that calls `EtsTables.top_by_type/1` and emits `[:ets_table, :memory]` telemetry events with `%{total: memory}` measurements and `%{table_type: type}` metadata
- Add `:ets_table_memory` to the list in `builtin_periodic_measurements/1`
- Add `last_value("ets_table.memory.total", tags: [:table_type], unit: :byte)` to `metrics/1`

### Step 3: Run tests
- Run existing tests in the electric-telemetry package
- Verify compilation

### Step 4: Commit and create changeset
- Commit the integration changes separately from the existing WIP commits
- Create a changeset entry via `pnpm changeset`
