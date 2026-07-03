---
"@electric-ax/durable-streams-server-rust": patch
---

Write-path performance overhaul plus three crash-recovery correctness fixes.

Performance:

- Remove the WAL write-saturation coordination ceiling: dedicated
  group-commit committer threads (off the shared Tokio runtime, no
  per-commit `spawn_blocking` hop), lock-free epoch-gated dirty-stream
  registration, and coalesced durability wakeups (only satisfied waiters
  are woken). +55–60% saturated write throughput at 200k–500k streams
  (2.37M ops/s @ 32 vCPU), p99 41→12 ms.
- Fix the high-stream-cardinality (200k–1M streams) write cliff: O(1)
  checkpoint drain, checkpoint fully off the async runtime, meta sidecar
  flush moved from per-append to the checkpoint. 1M streams now sustains
  1.11M ops/s on 16 vCPU (was 862k).
- Remove the zero-copy splice append path: `--durability memory` is now
  the buffered append path with the WAL stage/wait skipped — 4× faster at
  sync-sized payloads (96k vs 23k ops/s on 2 vCPU) — and no longer
  Linux-only. Per-stream SSE wake coalescing keeps live delivery complete
  under write saturation (previously collapsed past ~16k writes/s).
- New flags: `--wal-stats <secs>` (contention telemetry) and
  `--worker-threads <n>` (pin the runtime pool size).

Fixes (found by the new seeded crash/fault simulation, `src/wal/sim_tests.rs`):

- WAL recovery no longer loses acked data when the WAL spans multiple
  segments: boot re-preallocated the first segment unconditionally, so a
  sealed `1.wal` grew a zero tail that replay mis-read as end-of-log
  (dropping every later segment's acked records), and a
  checkpoint-recycled `1.wal` was recreated empty. Boot now opens
  existing segments non-destructively.
- Recovery now truncates a torn, never-acked tail on streams with no
  surviving WAL record and no checkpoint tails entry (e.g. a stream
  created after the last checkpoint whose only in-flight append was torn
  by power loss) — previously the torn fragment became reader-visible.
  The `.meta` sidecar persists a `durable_tail` proof (no new hot-path
  fsyncs).
- An acked DELETE is now durable before the 204: the unlinks (plus a
  parent-directory fsync) previously ran on a detached task, so a crash
  right after the ack resurrected the stream on the next boot.
