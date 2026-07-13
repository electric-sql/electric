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
| + exclusive pinned cores (Guaranteed QoS + static CPU manager) | 328k (measured separately; stacking projects ~360k) |
| reference: memory durability (no fsync anywhere) | 512k |

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

Example (6-device box): device 0 → data root, devices 1–5 → 5 WAL shards:

```
--data-dir /data/wal/0 --wal-shards 5
```

### 2. Server flags

```
--wal-checkpoint-syncfs on            # one syncfs barrier per checkpoint instead of
                                      # O(N-touched) per-stream fdatasync (PR #4697)
--wal-checkpoint-wal-bytes 1073741824 # checkpoint a shard when ITS retained WAL
                                      # exceeds 1 GiB (PR #4704) — checkpoint cost ≈ 0,
                                      # crash-replay bounded to ≤1 GiB/shard (<1 s NVMe)
--wal-checkpoint-interval-ms 60000    # fallback timer so an idle shard still recycles
--wal-shards <number of WAL devices>  # shards = fsync lanes; on a SINGLE shared
                                      # device keep 2–4 (more only fragments batches)
--worker-threads <vCPUs>
```

Leave `--wal-fsync-parallel` at its default (1): fanout parallelizes the
per-stream fsync loop that syncfs replaces, and measured as a regression.

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

- Validated to 100k streams, 256 B payloads, single node. 1M-stream behavior of
  this exact config is unmeasured (see `CARDINALITY_1M.md` for the older
  analysis); the mechanisms that caused the cliff are cardinality-independent
  now, but confirm before relying on it.
- The stacked best config (size trigger + pinned cores together) is projected
  ~360k @100k, measured only separately — one confirmation run pending.
- `--wal-checkpoint-syncfs` and the size trigger are opt-in; flipping defaults
  (syncfs on for Linux) is a candidate after soak.
- Larger retained WAL = longer replay: 1 GiB/shard ≈ sub-second on local NVMe,
  but budget it consciously on slower disks.
