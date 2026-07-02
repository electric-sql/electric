# WAL crash/recovery randomized simulation — design

**Date:** 2026-07-02
**Goal:** find correctness issues in the durable-streams Rust server's recovery path under
network failures (client drops), disk failures (power-loss page-cache loss, torn writes),
and arbitrary crash points — via seeded, reproducible randomized simulation.

## Why this shape

The existing coverage (`src/wal/e2e_tests.rs`, `src/wal/recovery.rs` unit tests) is
deterministic: each test hand-picks one crash scenario. A randomized simulator explores the
scenario space — interleavings of creates/appends/closes/forks/checkpoints, crash points,
and fault combinations — that nobody thought to write a test for.

Approaches considered:

1. **In-process randomized crash simulation (chosen).** A `#[cfg(test)]` module that drives
   the real handler path (`handlers::handle`), simulates crashes exactly like the existing
   e2e `Harness` (stop committers, drop store + WalSet, keep the data dir), injects disk
   faults constrained to the documented fault model, and re-runs the real boot sequence
   (`WalSet::open` → sidecar pass → `wal::recovery::recover` → `reset_after_recovery`).
   Deterministic per seed; can consult internal state (durable LSN, checkpoint tails) to
   keep injected faults inside the fault model.
2. Black-box process-level fuzzer (kill -9 the real binary over HTTP). Higher socket-layer
   fidelity, but kill -9 preserves the page cache, so it cannot simulate power loss — the
   most interesting failure class here — and reproduction is flaky.
3. cargo-fuzz on the WAL codec. Narrow; the codec already has CRC framing + unit tests.

## Fault model (what the simulator may break)

Grounded in ARCHITECTURE.md + recovery.rs:

- **Process crash:** committers stop, process state vanishes, all file bytes written so far
  survive (page cache == disk from the test's point of view).
- **Power loss / disk failure**, applied on top of a crash:
  - _Per-stream data files_ are fsynced only at checkpoint (and at recovery repair). Any
    byte beyond a stream's last checkpointed durable tail may be lost or garbage. The
    simulator may truncate, zero, or scribble the region past that floor.
  - _WAL segments_ are fdatasync'd up to the durable LSN (that is what releases acks).
    Bytes of records with `lsn > durable_lsn` at crash time may be torn: the simulator
    scans the segment with the real codec, finds the byte offset where staged-but-unacked
    records start, and corrupts/zeroes a random suffix from a random point at or past it.
  - `.meta` sidecars: create/close fsync them; the lazy tail flush does not. The simulator
    does not corrupt sidecars in v1 (identity durability is a separate contract).
- **Network failure:** a client connection dropping mid-append is modeled by aborting the
  spawned append task at a random await point (tokio cancellation), and by crashing with
  appends still in flight. Such appends are **maybe-applied**: the oracle accepts their
  presence or absence, but never a torn fragment of them.

## Workload generator

Seeded xorshift PRNG (no new dependencies; `rand` stays out of the dependency tree — the
existing crate has zero dev-deps and tests use std only). Per step, weighted choice of:

- create stream (octet or JSON content type)
- append a self-describing record (`<stream>#<seq>|` for octet; `{"s":..,"i":..}` for
  JSON) via the real POST path — sizes varied, occasionally multi-KB
- append with cancellation: spawn, then abort after a random yield count (maybe-applied)
- close a stream (real POST close path)
- fork a stream at a random offset ≤ parent tail (exercises `file_base > 0` recovery)
- delete a stream (recovery must not resurrect it)
- checkpoint a random shard (`shard.checkpoint()`), then refresh that shard's per-stream
  durable-tail floors from `read_durable_tails()` (governs data-file fault legality)
- read a random range via the real GET path and check it against the oracle

## Crash / fault / recover cycle

Each seed runs G generations (default 4). Per generation: run K workload steps, then
crash (with 0..3 appends deliberately still in flight), then with independent
probabilities inject data-file faults and WAL-suffix faults as bounded above, then boot
the real recovery sequence and run the oracle. Subsequent generations continue the
workload on the recovered store — recovery-of-recovery bugs (stale `appender.written`,
tail/watch mismatches) only show up this way.

## Oracle (checked after every recovery, and on every read)

Per stream, the oracle tracks: records issued (unique tokens, in order), ack status of
each (acked / maybe / rejected), closed status, expected file_base.

1. **No loss:** the recovered data file's bytes parse as a concatenation of whole issued
   records, in issue order, containing **every acked record** — i.e. an ordered
   subsequence of issued records ⊇ acked records. (Maybe-applied records may appear or
   not; nothing else may.)
2. **No torn record:** the parse consumes the file exactly — no trailing fragment, no
   interior garbage. For JSON streams every recovered record re-parses as JSON.
3. **Tail consistency:** `Shared.tail == file_base + file_len`, `durable_tail == tail`,
   and the watch channel publishes the same tail.
4. **Closed-ness durability:** a stream whose close was acked recovers `closed == true`
   (position may lawfully shrink only under power-loss faults, and never below the
   checkpointed floor).
5. **No resurrection:** a deleted stream does not reappear after recovery.
6. **Read correctness:** GETs (catch-up path) return exactly the oracle's bytes for the
   requested range.
7. **Recovery never panics** and never errors on in-model faults.

On violation: print the seed, generation, step trace tail, and the diff — everything
needed to replay deterministically.

## Placement & running

- New module `src/wal/sim_tests.rs` (`#[cfg(test)]`, registered in `wal/mod.rs`), reusing
  the `Harness` boot/crash idiom from `e2e_tests.rs` and `DurabilityGuard::wal()`.
- CI-friendly default: a small fixed seed set (fast, deterministic).
- Long-run mode via env: `DS_SIM_SEEDS=<n>` and `DS_SIM_STEPS=<k>` scale the exploration;
  a wrapper invocation runs thousands of seeds locally to hunt for issues.

## Out of scope (v1)

Tiering/offload faults (S3), `.meta` corruption (byzantine tier), memory-mode recovery,
multi-process concurrency, and the HTTP socket layer itself. Each can be layered on later.
