# Bugs surfaced by the restart-aware oracle property test

These were uncovered while wiring `RESTART_SERVER_EVERY` into
`test/integration/oracle_property_test.exs`. The harness now restarts the
`Electric.StackSupervisor` mid-test to exercise restore-from-file. Each bug
below is a real Electric issue that prevents the test from passing in restart
mode unless mitigated. The harness no longer mitigates them — the test fails
in their presence so they get noticed.

## Bug 1: Subquery shape materializer state is not restored from disk — FIXED

**Symptom**

After a stack restart with a persistent replication slot, shapes whose
predicates contain subqueries (`level_3_id IN (SELECT id FROM level_3 …)`,
`NOT IN (...)`, etc.) diverged from the oracle. Two failure modes were
seen: a `409 (must-refetch)` on `optimized: true` shapes, and missing rows
after a refetch.

**Root cause**

Two compounding issues:

1. **Materializer only replayed the first chunk of source-shape history on
   startup.** `Storage.get_log_stream/3` returns at most one chunk per call
   (a snapshot chunk, or one main-log chunk). The materializer's
   `handle_continue({:read_stream, …})` called it once and treated the
   stream as the full history, silently dropping every subsequent snapshot
   chunk and every persisted log entry. On restart the source shape's log
   contained the post-snapshot updates that drove dependent
   move-in/move-out events, so the materializer's `value_counts` was wrong
   from the moment it came up.

2. **Dependent (outer) consumers were not restarted after a stack restart.**
   The router only delivers events to a consumer when its own `root_table`
   changes, so a shape whose movement is driven entirely by a dependency
   stayed dormant after a restart. Without its consumer running, the
   materializer for its dependency was never started, the SubqueryIndex
   was never seeded, and the dependent shape's on-disk view was never
   updated when the dependency changed.

**Fix**

- `lib/electric/shapes/consumer/materializer.ex#handle_continue({:read_stream, …})`:
  iterate `Storage.get_log_stream/3` and `Storage.get_chunk_end_log_offset/2`
  until `state.subscribed_offset` is reached, instead of reading a single
  chunk.
- `lib/electric/shape_cache.ex#handle_continue(:wait_for_restore, …)`:
  after marking the log collector ready, eagerly call
  `restore_shape_and_dependencies/3` for every shape with
  `shape_dependencies != []` whose consumer isn't already running, so
  materializer subscriptions are re-established.

**Regression test**

`test/integration/oracle_restore_test.exs#test "bug 1: subquery shape
diverges from oracle after server restart"` — single-shape, two-batch,
deterministic reproduction that fails on `main` and passes after the fix.

## Bug 4: Materializer re-reads main-log entries on startup recovery — FIXED

**Symptom**

Same surface as Bug 1 (a 409 must-refetch on an `optimized: true` subquery
shape after a server restart), but reproducible only when the source
shape's persisted main log spans more than one chunk. The heavy property
run with `RESTART_SERVER_EVERY=7 RESTART_CLIENT_EVERY=11 SHAPE_COUNT=800
…` reliably tripped this on shape definitions like
`level_3_id IN (SELECT id FROM level_3 WHERE active = true)`.

**Root cause**

The Bug 1 fix added an iteration loop in `Materializer.read_history_up_to_subscribed/2`
that calls `Storage.get_log_stream/3` repeatedly, advancing through chunk
boundaries via `Storage.get_chunk_end_log_offset/2`.

`get_log_stream/3` returns one snapshot chunk per call, so iteration is
correct for the snapshot. But for the **main log** it returns the *entire*
requested range (`[min_offset, subscribed_offset]`) in a single call.
When the main log spans multiple chunks, the loop's next-iteration offset
was the end of the *first* main-log chunk, so the next call streamed the
remainder of the main log — entries the previous call had already
applied. Re-applying inserts hits the materializer's "Key already exists"
guard, which crashes the materializer; the dependent shape's consumer
goes down with it and the server returns 409 must-refetch on the next
poll.

**Fix**

In `lib/electric/shapes/consumer/materializer.ex#read_history_up_to_subscribed/2`,
stop iterating as soon as the read steps into the main log. Two new
short-circuits cover this:

- if `state.offset` is already a real or last-virtual offset, the call
  just made was `stream_main_log` and is complete;
- if the next chunk boundary is a real offset, the call we just made
  exhausted the snapshot and entered `stream_main_log`, so iterating
  further would re-read.

**Regression test**

`test/integration/oracle_restore_test.exs#test "bug 4: subquery shape
returns 409 after restart with many persisted log entries"` —
deterministic single-shape reproduction with `chunk_size: 200` to force
the source shape's main log to span multiple chunks. Fails on the broken
iteration; passes with the fix.

## Bug 2: Snapshot+log replay can produce duplicate / orphan operations after restart

**Symptom**

A fresh client polling a shape after server restart receives a sequence of
operations where the same row appears as two inserts, or where an `update` /
`delete` arrives for a row the client never saw inserted. The
`ShapeChecker.apply_message/2` invariants flunk with messages like:

```
shape=shape_4: insert for row that already exists: {"l4-20"}
shape=shape_8: update for row that does not exist: {"l4-18"}
```

This appears to happen when the snapshot streamed to the new client overlaps
with the log entries that follow, instead of the snapshot ending exactly at
the offset where the log resumes.

**Reproduce**

Same command as Bug 1; many seeds without subqueries also show this
intermittently when batches deliver row movements that straddle the snapshot
boundary.

**Where to look**

- `lib/electric/shape_cache/pure_file_storage.ex` — the boundary between the
  on-disk snapshot and the persisted log file. After restore, both are
  streamed to the client; the snapshot's last offset must be strictly before
  the log's first offset.
- `lib/electric/shapes/api.ex#do_serve_shape_log/1` and the streaming
  pipeline — confirm that the catch-up replay starts at exactly
  `last_persisted_txn_offset + 1` and does not include any rows already in
  the snapshot.

## Bug 3: Long-poll completes with HTTP 400 "offset out of bounds" after multiple restarts

**Symptom**

After the second `StackSupervisor` restart in a session, a fresh client poll
sometimes receives:

```
%Electric.Client.Error{
  message: %{"errors" => %{"offset" => ["out of bounds for this shape"]},
             "message" => "Invalid request"},
  resp: %{status: 400, …}
}
```

This happens on simple (non-subquery) shapes when the long-poll timeout
expires before the post-restart replication client has caught up enough to
deliver new transactions. Bumping `LONG_POLL_TIMEOUT` from the test default
of 100ms to 2000ms hides it; the underlying issue is that after a restart
the server's view of "last available offset" briefly trails Postgres' actual
state, and the long-poll's out-of-bounds-recovery loop times out before the
gap closes.

**Reproduce**

```sh
CHECK_TIMEOUT=60000 SHAPE_COUNT=10 MUTATIONS_PER_TXN=10 TXNS_PER_BATCH=10 \
  BATCH_COUNT=15 RESTART_SERVER_EVERY=7 LONG_POLL_TIMEOUT=100 \
  SKIP_REPATCH_PREWARM=true \
  mix test --seed 1 --only oracle test/integration/oracle_property_test.exs
```

**Where to look**

- `lib/electric/shapes/api.ex#determine_log_chunk_offset/1` and the long-poll
  branch around line 880 (`@offset_out_of_bounds`).
- `lib/electric/connection/manager.ex#handle_continue(:start_streaming, …)`
  vs. the `Electric.StatusMonitor.wait_until_active/2` readiness signal —
  there's a window where the stack reports `:active` but the replication
  stream hasn't yet forwarded transactions that Postgres committed during
  the restart, and a poll arriving in that window can be told the offset is
  out of bounds.
- Possibly Electric.LsnTracker — the new replication client may be
  reporting a stale `last_processed_lsn` until the first batch streams.

## Bug 5: Post-restart move-in events lost when source-shape main log spans multiple chunks

**Symptom**

After a server restart, the next replication-driven mutation that would
move rows in or out of a subquery shape's view is silently dropped:
the materialized view stays at its post-restart-restored state, while
the oracle (PG) correctly reflects the post-batch state. Manifests as a
"View mismatch" in the oracle harness, with the materialized view
missing rows the oracle has.

Reproduces only with **multiple subquery shapes** AND a source-shape
main log that spans **more than one chunk** (forced via
`@tag chunk_size: 200`). Single-shape variants of the same scenario
(`bug 1` and `bug 4` regression tests) pass, so the bug is in an
interaction between concurrent materializer recoveries and post-restart
event delivery — possibly a stale `last_persisted_offset` that causes
the source consumer to ignore the incoming mutation, or a missed
materializer-subscription handshake that means the dependent consumer
isn't on the materializer's subscriber list when the move-in event
fires.

**Reproduce**

```sh
CHECK_TIMEOUT=10000 SKIP_REPATCH_PREWARM=true \
  mix test --seed 1 --only oracle_restore_bug_5 \
  test/integration/oracle_restore_test.exs
```

Two shapes (`level_3 WHERE active=true` and `level_3 WHERE active=false`),
200 toggles in batch_1, server restart, single deactivate in batch_2.
After batch_2 the dependent `shape_active_false` view is missing the
level_4 rows whose level_3 parent just transitioned to `active=false`.

**Where to look**

The flow up to and including the materializer is healthy after restart
(verified by trace logging):

1. Source consumer's `materializer_subscribed?` is set back to `true`
   when the materializer subscribes — `notify_materializer_of_new_changes`
   does call into the materializer for batch_2.
2. The materializer's `handle_call({:new_changes, {range_start,
   range_end}, ...})` runs and applies `value_counts` updates correctly.
3. `maybe_flush_pending_events/2` emits the right `move_in` / `move_out`
   events (e.g. `move_in: [{"l3-2", "l3-2"}]` for the active=false
   source) to each materializer's single subscriber (the dependent
   shape's consumer).
4. The dependent consumer's `handle_info({:materializer_changes, ...})`
   fires with the right move counts.

The break is **after** the consumer receives the `:materializer_changes`
message — its move-in handling fails to add the moved-in level_4 rows
to the shape's on-disk view. Suspect chain:

- `lib/electric/shapes/consumer/event_handler/subqueries/steady.ex`
  `handle_event/2` dispatches into `Buffering.start/6` for `:move_in`,
  which schedules a `query_move_in` effect.
- `lib/electric/shapes/consumer/event_handler/subqueries/buffering.ex`
  and the `ActiveMove` / `SplicePlan` machinery — verify the move-in
  query actually executes and its results are appended to the shape's
  log.
- `lib/electric/shapes/consumer/event_handler/subqueries/active_move.ex`
  — `state.views` is seeded by `EventHandlerBuilder` from
  `Materializer.get_link_values`. After restart the seeded view has the
  pre-batch_2 state (correctly). Confirm the `dep_view` passed to
  `MoveQueue.enqueue` reflects the post-batch_2 state by the time the
  move-in query runs.

The likely root cause is a stale view / timing race in the
move-in-query lifecycle when a materializer is replayed concurrently
with its first post-restart event. Single-shape variants don't expose
it, so the trigger is concurrent materializer recoveries.

**Regression test**

`test/integration/oracle_restore_test.exs#test "bug 5: multiple
subquery shapes diverge after restart with long persisted log"` —
deterministic two-shape reproduction. Fails today with the listed
mutation pattern; passes for the single-shape variants.

## Note for triage

Bug 1 is the most material; restore-from-file with subquery shapes is a
documented production scenario. Bugs 2 and 3 only manifest under restart and
are likely to be related to slot/timeline transitions. Bug 1 should be
investigated independently; Bug 2 may resolve once the snapshot/log boundary
is checked carefully (see `last_persisted_txn_offset` handling); Bug 3 is
likely a small fix in the active-readiness signal.
