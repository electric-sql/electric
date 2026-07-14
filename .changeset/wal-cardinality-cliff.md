---
"@electric-ax/durable-streams-server-rust": patch
---

Eliminate the WAL write cardinality cliff (10.4k → 383k appends/s @100k streams; 212k @1M).

- Checkpoint durability now uses one `syncfs` barrier per stream lane on Linux (was O(touched-streams) per-file `fdatasync` — the barrier storm that collapsed throughput at high stream counts).
- New `--wal-checkpoint-interval-ms` (per-shard time trigger, default 3000) and `--wal-checkpoint-wal-bytes` (retained-WAL size budget, 0 = off): checkpoint cadence is an explicit crash-replay budget and shards self-stagger instead of storming together.
- New `--stream-lanes N` (default 1 = unchanged layout): hash stream data files across `streams/<0..N>/` dirs, one per device, spreading checkpoint writeback over N devices with N parallel barriers. The lane count is persisted and validated on open.
- New `--server-stats N` telemetry (`SRV_STATS`: cpu / inflight / service / lock / durability-wait per interval) — the dependency-free bottleneck diagnostics used to find all of the above. Memory-mode plain appends no longer queue redundant sidecar flushes.
- Removed dead/diagnostic flags: `--wal-fsync-parallel`, `--wal-meta-gate`, `--mem-meta-gate`, `--meta-sweep-disable`, `--meta-sweep-stats`, `--tier local` / `--tier-local-dir` (tier is `off|s3`). `--durability memory` combined with `--tier` is now rejected at startup. WAL records without `PAYLOAD_CHECKSUMMED` decode as torn (no released writer ever emitted them).

Deployment guidance (device layout, CPU pinning, checkpoint budgets): `WAL_TUNING.md`.
