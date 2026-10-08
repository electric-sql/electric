---
"@electric-ax/durable-streams-server-rust": patch
---

Complete the `DS_BENCH_FAST_FSYNC` → `DS_UNSAFE_FAST_FSYNC` rename in `wal/segment.rs`. The previous rename missed the WAL segment's copy of the check — the fsync that gates append acks — so the documented `DS_UNSAFE_FAST_FSYNC` name had no effect on WAL-mode write latency (macOS bench/experimentation only; never set in production).
