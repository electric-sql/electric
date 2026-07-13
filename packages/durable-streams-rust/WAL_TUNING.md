# WAL write-path tuning — the ideal configuration

**Status:** validated 2026-07-13 on GCP `c4d-standard-64-lssd` (6× Titanium local
NVMe, raw block), 256 B appends, 8 vCPU server, up to 100k streams. Campaign:
ds-bench suites `wal-decomp-lane0`, `wal-splitlane`, `wal-sizetrigger`,
`wal-cpubind` (see ds-bench `results/<suite>/report.md` + `AGENTS.md`).
**Verdict: the write cardinality cliff is eliminated** — WAL-durable throughput
is flat from 10k → 100k streams (−5%) at ~26–32× the pre-fix baseline.

## The ladder (what each step bought, @100k streams)

| configuration | ops/s |
|---|---|
| pre-fix: streams on network PD, per-stream checkpoint fdatasync storm | 10.4k |
| + `--wal-checkpoint-syncfs on` (PR #4697) | 13.6k |
| + stream files on local NVMe (not the boot disk) | 46k |
| + split-lane layout (WAL shards on their own NVMe devices) | 272k |
| + size-triggered checkpoint (PR #4704, `--wal-checkpoint-wal-bytes 1GiB`) | 303k |
| + exclusive pinned cores (Guaranteed QoS + static CPU manager) | 328k |
| **all of the above stacked** (suite `wal-stacked-1m`) | **383k** |
| reference: memory durability (no fsync anywhere) | 512k |

At extreme cardinality the stacked config on ONE data lane hits a second wall —
checkpoint writeback (~40× metadata amplification of small appends) saturates
the single data device (`syncfs` = 60–74 s at 1M streams): 244k @500k, 56–68k
@1M. `--stream-lanes 3` (suite `wal-streamlanes-1m`, 3 data lanes + 3 WAL
lanes) breaks it: **374k @100k, 285k @500k, 212k @1M** (`syncfs` 5.7–11 s).

The residual ~1.6× gap to memory mode is WAL machinery (staging + double-write),
not fsync — future work: io_uring segment writer (`wal/segment.rs` seam),
batched mark-written.

## The ideal configuration

### 1. Hardware / storage layout (the #1 lever)

Use an instance with **multiple physically attached NVMe devices** (GCP: 4th-gen
`-lssd` types, raw block via `--local-nvme-ssd-block`; do NOT use
`--ephemeral-storage-local-ssd`, which RAID0-stripes every device into one fsync
barrier). Then:

- **One device for stream data files** — mount it and point `--data-dir` at it.
  The per-stream files and the checkpoint's `syncfs` domain live here.
- **One device per WAL shard** — mount device *j* at `<data-dir>/wal/<i>` (the
  server opens shard *i* at that path automatically). `--wal-shards` = number of
  dedicated WAL devices.
- **Never share a device between WAL and stream data.** Commit `fdatasync` vs
  checkpoint writeback contention on one queue was worth 5× by itself
  (55k → 272k). On dedicated lanes the commit-fsync cost is ~zero (checkpoint-off
  measured *below* an all-lanes-shared no-fsync control).
- **Never leave stream data on the boot disk / network PD.** On Kubernetes
  raw-block node pools the default emptyDir sits on the boot PD — this single
  mistake mismeasures (and misdeploys) WAL mode by 5–26×.

Split the box between data lanes and WAL lanes **by cardinality**:

- ≤ ~100k streams: 1 data lane is enough — e.g. device 0 → data root,
  devices 1–5 → 5 WAL shards: `--data-dir /data/wal/0 --wal-shards 5`
- ≥ ~500k streams: checkpoint writeback dominates; give data more lanes — e.g.
  device 0 → data root (stream lane 0), devices 1–2 → stream lanes 1–2
  (mounted at `<data-dir>/streams/1`, `/2`), devices 3–5 → 3 WAL shards:
  `--data-dir /data/wal/0 --wal-shards 3 --stream-lanes 3`
  (`--stream-lanes` is a LAYOUT choice like the shard count: it must match the
  on-disk layout across restarts.)

### 2. Server flags

```
--wal-checkpoint-wal-bytes 1073741824 # checkpoint a shard when ITS retained WAL
                                      # exceeds 1 GiB (PR #4704) — checkpoint cost ≈ 0,
                                      # crash-replay bounded to ≤1 GiB/shard (<1 s NVMe)
--wal-checkpoint-interval-ms 60000    # fallback timer so an idle shard still recycles
--wal-shards <number of WAL devices>  # shards = fsync lanes; on a SINGLE shared
                                      # device keep 2–4 (more only fragments batches)
--stream-lanes <number of data devices> # hash stream files across per-device dirs
                                      # (PR #4705); layout choice, default 1
--worker-threads <vCPUs>
```

The syncfs checkpoint barrier (PR #4697) is **default-on for Linux** — one
`syncfs` per stream lane instead of O(N-touched) per-stream `fdatasync`;
`--wal-checkpoint-syncfs off` is the escape hatch. `--wal-fsync-parallel` is
removed (regressed in every controlled test; accepted as a warning no-op).

### 3. CPU binding (+21–24%)

Give the server **exclusive pinned cores**. On Kubernetes: node pool with
`kubeletConfig.cpuManagerPolicy: static` + a **Guaranteed QoS** pod (every
container `requests == limits`, server CPU an integer). Measured 356k @10k /
328k @100k vs 286k/272k on shared cores, same layout and flags. Now that WAL is
no longer fsync-bound, it scales with cores again — don't starve it.

### 4. What you do NOT need to worry about

- **Read performance while tuning checkpoints.** Reads never touch the WAL and
  are served zero-copy (`sendfile`) from the data file's page cache, which is
  written *before* the WAL ack barrier. Checkpoint cadence has zero read-path
  cost.
- **Ack latency vs checkpoints.** Acks gate only on the WAL group-commit
  `fdatasync`; a checkpoint never blocks appends.
- **Recoverability.** The contract is unchanged by any of these knobs: a WAL
  segment is recycled only after its records' stream bytes are fsynced into
  their files **and** the durable-tail map is persisted (`wal/shard.rs`
  checkpoint ordering; crash-recovery e2e + randomized crash sim cover it).
  The size trigger only changes *when* that sequence runs.

## Caveats / follow-ups

- The 1M-stream writeback wall is diagnosed and broken (`--stream-lanes`, PR
  #4705: 68k → 212k @1M). The residual slope (374k @100k → 212k @1M on 3 data
  lanes) is per-file writeback amplification against total data-lane
  capacity — add data lanes, or see #4695 (log-structured store) for the
  structural end-state.
- fd ceiling: the server holds one fd per live stream — 1,005,724 fds at 1M
  streams = 96% of the default 1,048,576 limit. Not the throughput wall, but a
  hard scale ceiling just above 1M: raise LimitNOFILE, or see #4706 (lazy fd
  management).
- `--wal-checkpoint-syncfs` and the size trigger are opt-in; flipping defaults
  (syncfs on for Linux) is a candidate after soak.
- Larger retained WAL = longer replay: 1 GiB/shard ≈ sub-second on local NVMe,
  but budget it consciously on slower disks.
