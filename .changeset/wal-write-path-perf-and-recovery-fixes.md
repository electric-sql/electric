---
"@electric-ax/durable-streams-server-rust": patch
---

Write-path performance overhaul plus three crash-recovery correctness fixes.

Performance: removed the WAL group-commit coordination ceiling (+55–60% saturated write throughput, p99 41→12 ms), fixed the 200k–1M stream-cardinality write cliff (1M streams now sustains 1.11M ops/s on 16 vCPU), and made `--durability memory` the buffered append path (4× faster, no longer Linux-only). New flags: `--wal-stats <secs>` and `--worker-threads <n>`.

Fixes (found by the new seeded crash/fault simulation): multi-segment WAL recovery no longer drops acked records after the first segment; a torn, never-acked tail on a quiet stream is truncated instead of becoming reader-visible; an acked DELETE is now durable before the 204.
