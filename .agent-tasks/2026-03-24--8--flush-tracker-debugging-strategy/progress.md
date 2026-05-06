# Progress Log

## 2026-03-24

### 09:00 - Task started
- This is a repeat task. Previous agent (round 1) wrote tests in PR #4035.
- Human returned task with follow-up: need a production debugging strategy, not code changes.
- Two customers affected: "edison" and "faraday". Neither has subqueries. One has `suspend_consumers`.
- Production state dumps available locally.

### 09:05 - Research phase
- Launched 4 parallel research agents for:
  1. FlushTracker/ShapeLogCollector/ConsumerRegistry code deep dive
  2. Production state dump analysis
  3. Previous investigation review (turbo, autarc)
  4. PR #4011 / issue #4013 / PR #4035 study
- Also performed direct code reading of key modules while agents ran

### Key Code Findings

**FlushTracker** (`flush_tracker.ex`):
- Tracks shapes by shape_handle, NOT by consumer PID
- No process monitoring of consumers
- Only cleanup paths: `handle_flush_notification` (consumer-initiated) and `handle_shape_removed` (shape removal)

**Consumer** (`consumer.ex`):
- Calls `ShapeLogCollector.notify_flushed` only on storage flush events (line 276)
- On termination, calls `ShapeCleaner.handle_writer_termination` — does NOT clean FlushTracker
- Suspension: exits with `ShapeCleaner.consumer_suspend_reason()` after hibernate_after timeout

**ShapeCleaner** (`shape_cleaner.ex:108-119`):
- Suspend reason → only calls `ConsumerRegistry.remove_consumer` (NO FlushTracker cleanup!)
- `:normal/:killed/:shutdown/{:shutdown,_}` → does NOTHING
- Only abnormal exits trigger full shape removal (which does clean FlushTracker)

**This is the root cause gap:** Consumer death with clean exit reasons leaves FlushTracker entries orphaned.

**ConsumerRegistry** (`consumer_registry.ex`):
- `publish` detects crashed consumers via `:DOWN` messages during broadcast
- Returns crashed shapes as "undeliverable" to SLC
- SLC's current code (PR #4011) handles undeliverable shapes by removing them from FlushTracker
- BUT: only during active transaction processing — not for shapes stuck from previous transactions

### Production State Analysis

**Edison:** 33 shapes stuck at same `last_sent` offset `(8458315976, 1066)`, all with different `last_flushed` sub-offsets within that transaction. WAL gap: ~836MB.

**Faraday:** 100+ shapes stuck across two distinct base offsets. WAL gap: ~15.7GB. Two snapshots taken at different times show identical stuck state, confirming no recovery.

### Previous Investigations
- Turbo (2026-03-05): throughput bottleneck, not FlushTracker staling
- Autarc (2026-03-19): WAL growth from replication lag, not stale entries
- Neither investigation identified the FlushTracker stale entry bug specifically

### Strategy Document Written
- Comprehensive debugging strategy with 4 phases:
  1. Runtime state inspection (immediate, non-invasive)
  2. Targeted tracing (requires deploy)
  3. Honeycomb telemetry
  4. ETS table inspection
- Includes 4 hypothesized root causes with code path analysis
- Proposes 3 fix options once root cause is confirmed

## Operational Issues
- Background agents took longer than expected; proceeded with direct code reading in parallel
- Production state dump files are large (some exceed Read tool limits) — used Bash head command as workaround
