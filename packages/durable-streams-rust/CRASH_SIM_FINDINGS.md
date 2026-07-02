# Crash/recovery simulation — findings (2026-07-02)

A seeded randomized crash/fault simulation for the WAL recovery path now lives at
`src/wal/sim_tests.rs` (design: `docs/superpowers/specs/2026-07-02-wal-crash-simulation-design.md`).
Each seed drives the real handler path with a random workload (creates, appends,
client-disconnect cancellations, closes, forks, deletes, checkpoints), crashes by dropping
the generation's tokio runtime + stopping committers, injects power-loss disk faults
constrained to the documented fault model, reboots through the real recovery sequence, and
checks a no-loss/no-torn/consistency oracle across multiple generations per seed.

Run it:

```sh
# CI-fast deterministic smoke (4 seeds)
cargo test crash_recovery_randomized_simulation

# long hunt
DS_SIM_SEEDS=1000 DS_SIM_SEED0=20000 DS_SIM_GENS=4 DS_SIM_STEPS=150 \
  cargo test crash_recovery_randomized_simulation -- --nocapture

# reproduce a failure (the panic message prints the seed)
DS_SIM_SEEDS=1 DS_SIM_SEED0=<seed> cargo test crash_recovery_randomized_simulation
# forensics: DS_SIM_SNAPSHOT=1 snapshots each generation's pre-boot disk state;
# `DS_DUMP_DIR=<dir> cargo test wal_forensic_dump -- --ignored --nocapture` decodes it.
```

## Finding 1 (CRITICAL, fixed): boot clobbered sealed/recycled WAL segments → acked-data loss

Found by the very first seed (89837), gen 1. `Shard::open` unconditionally ran
`FileSegment::create(1.wal, segment_size)`, which re-preallocates to full segment size.
Two on-disk states the segment roll/recycle feature (11a) introduced made that destructive:

- **Sealed `1.wal`** — sealing truncates a rolled segment to its exactly-packed length,
  and that exact length is what lets `replay_from_checkpoint` walk across the segment seam
  (`off == raw.len()` → next segment). Re-preallocating grafted a `fallocate`/`set_len`
  zero tail onto the sealed segment; replay decoded the zeros as `Incomplete` — the clean
  end of the durable log — and **silently dropped every acked record in all later
  segments**. Worse than a skip: `reconcile_tail` then **truncated the per-stream files**
  back to the stale frontier, destroying acked bytes that were sitting intact in the page
  cache. Pure process crash (no power loss) suffices to trigger it.
- **Recycled `1.wal`** — after a checkpoint recycles the first segment(s), boot re-created
  a fresh all-zero `1.wal`. The walk visits segments in start-lsn order, decoded zero
  records in the spurious `1.wal`, and stopped — **replaying nothing**: every acked append
  since the last checkpoint was truncated away.

The trigger threshold in production is one segment roll (128 MiB of WAL traffic, or any
`--wal-segment-bytes` override) between two boots — no fault injection required.

**Fix:** boot now discovers existing `*.wal` files and opens the newest one as a
non-destructive placeholder handle (`FileSegment::open_existing`); only a genuinely fresh
shard dir creates + preallocates `1.wal`. The in-memory cursor stays a placeholder until
`reset_after_recovery` rebuilds it, per the documented boot order.
Regression tests: `e2e_multi_segment_acked_records_after_first_seal_survive_crash`,
`e2e_recycled_first_segment_acked_records_survive_crash` (both fail on the pre-fix code).

## Finding 2 (fixed): recovery debug assert panicked on a healthy multi-boot recovery

Seed 89840, gen 2+. `recovery.rs` asserted that a stream rebuilt purely from replayed
records (no checkpoint-persisted tail) must have its first record at `file_base`. That
premise is false across the boot cycle: after `recover` + `reset_after_recovery`, a
stream's post-boot appends produce WAL records starting at its _recovered tail_ — with no
persisted-tails entry until the next checkpoint. The durable prefix below the first
replayed record came from the previous boot's recovery reconcile (which `fdatasync`s the
repaired file), a third proof source the assert didn't model. Debug builds panicked the
recovery thread (release builds were unaffected).

**Fix:** the assert now checks the actual invariant — no _hole_ between the file's
pre-replay logical end and the first replayed record.

## Finding 3 (docs, fixed): ARCHITECTURE.md described pre-fsync visibility; the code gates visibility on durability

`ARCHITECTURE.md` claimed "visibility is never gated on durability" (tail published before
the WAL fsync). The implementation deliberately does the opposite: `write_wire` advances
only the writer tail; `publish_durable_tail` advances the reader-observable `durable_tail`,
populates the tail cache, and fires the `watch` **after** `wait_durable_lsn` — readers
never observe bytes a crash could roll back (PROTOCOL.md §4.1). The doc's write-path
diagram, §Durability invariant, and fan-out technique list were updated to match the code.

## Observation (by design, worth knowing): cancelled appends leave a lagging reader tail

A client that disconnects mid-append can leave the handler task cancelled at
`wait_durable_lsn`: the bytes are in the data file (and staged in the WAL, becoming durable
via the group commit), `Shared.tail` is advanced, but `publish_durable_tail` never runs for
that record. The reader-observable tail lags the file until the next successful append
publishes a higher frontier (monotonic heal) or a crash-recovery exposes the frontier.
Contract-consistent (the append never acked), but operators reading `Stream-Next-Offset`
may see it hold still despite durable bytes existing past it on a quiet stream.

## Residual gap (unfixed, edge): WAL-quiet streams have no torn-tail proof after power loss

For a stream with **zero surviving WAL records and no persisted-tails entry** (nothing
acked since the current WAL era began), recovery never reconciles it — the sidecar pass
trusts `tail = file_base + file size`. Under real power loss an _unacked_ in-flight
append's data-file bytes can persist torn/zeroed (size metadata committed, data pages not,
WAL record torn), and boot then exposes that torn fragment to readers — the C1 shape, for
streams whose durable-boundary proof was recycled or never recorded. Requires power loss
(not just process crash) plus a specific flush interleaving; no acked data is at risk.
Possible fixes: record a durable tail for a stream at first-append-of-era (hot-path cost),
or an fsync'd tail marker in the sidecar on close/idle. Not addressed in this pass; the
simulator's fault injector deliberately stays within the provable model, so this gap is
documented rather than asserted.

## Simulation results

- Pre-fix: seed 89837 (the first default seed) hit Finding 1 in generation 1.
- Post-fix: 4 default smoke seeds + 50-seed and 1000-seed hunts (4 generations × 150 steps
  each, 1–3 shards, 32 KiB segments to force rolls/recycles) pass with faults enabled
  (data-file truncate/scribble/zero within the un-fsynced region; WAL suffix zero/scribble
  above the durable LSN; torn staged appends; client-disconnect cancellations;
  in-flight-at-crash appends).
