---
"@electric-ax/durable-streams-server-rust": patch
---

fix: WAL recovery no longer loses acked data when the WAL spans multiple
segments. Boot re-preallocated the first segment unconditionally, so a sealed
(exactly-packed) `1.wal` grew a zero tail that replay mis-read as the end of
the durable log — dropping every later segment's acked records and truncating
the per-stream files to the stale frontier — and a checkpoint-recycled `1.wal`
was recreated empty, making replay recover nothing. Boot now opens existing
segments non-destructively. Found by the new seeded crash/fault simulation
(`src/wal/sim_tests.rs`, findings in `CRASH_SIM_FINDINGS.md`).
