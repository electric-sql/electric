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

## Bug 5: Post-restart move-in events lost when source-shape main log spans multiple chunks — FIXED

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

**Root cause (narrowed by trace logging)**

The outer shape's consumer, when re-initialized after a stack restart,
seeds `state.views` from the **current materializer view** via
`EventHandlerBuilder.build/2`:

```elixir
view = Materializer.get_link_values(materializer_opts)
```

But the outer shape's **on-disk storage** reflects the state at the
*pre-restart* shutdown LSN, while the materializer is rebuilt from disk
and then advanced by any events the source consumer processes during
the eager-restart window — including events from the replication
slot's catch-up replay and from the next test mutation (`batch_2`'s
deactivate). The two views diverge.

Concretely, in the failing test:

| Stage | Outer storage view (level_3_id values) | Materializer view |
|---|---|---|
| End of batch_1 | `{l3-3, l3-5}` (correct) | `{l3-3, l3-5}` (correct) |
| Server restarts; outer consumer re-initialized | `{l3-3, l3-5}` (still on disk) | replays history, momentarily `{l3-3, l3-5}` |
| `batch_2` deactivate(l3-2) lands at the materializer **before** outer consumer's `EventHandlerBuilder.build` runs | `{l3-3, l3-5}` | now `{l3-2, l3-3, l3-5}` |
| Outer's `state.views` is seeded **from the materializer** | `{l3-3, l3-5}` | view = `{l3-2, l3-3, l3-5}` |

Then the materializer's `move_in: [{"l3-2", _}]` event arrives at the
outer consumer. `MoveQueue.enqueue/4` runs `redundant?/2`, which checks:

```elixir
defp redundant?(%{kind: :move_in, move_value: {value, _}}, base_view) do
  MapSet.member?(base_view, value)
end
```

`l3-2` is in the seeded view, so the move-in is treated as redundant
and **dropped**. The outer storage never gets the `level_4` rows for
`level_3_id = l3-2` — those are the rows missing from the materialized
view in the test failure.

**Why single-shape doesn't expose it**

With one shape there's only one materializer, only one outer consumer,
and the timing rarely interleaves the outer consumer's
`EventHandlerBuilder.build` between the materializer's
`new_changes(...)` for batch_2 and the materializer's flush of the
move event back to the outer consumer. The race is exposed by
multi-shape eager-start: my `eagerly_start_subquery_shape_consumers/1`
restores shapes sequentially and `initialize_shape/3` is async, so
by the time outer-shape #2's consumer init runs `EventHandlerBuilder.build`,
its dependency materializer has already absorbed batch_2's update.

**Fix**

Eager-start the outer subquery shape consumers *before*
`ShapeLogCollector.mark_as_ready/1` opens the event-dispatch gate.
Concretely, `ShapeCache.handle_continue(:wait_for_restore)` now:

1. Calls `eagerly_start_subquery_shape_consumers/1`, which iterates
   shapes with `shape_dependencies != []` and runs
   `restore_shape_and_dependencies/3` for each, then blocks on
   `Consumer.await_snapshot_start/2` so each outer consumer's
   `EventHandlerBuilder.build/2` has run and `state.views` is seeded
   from the materializer.
2. Only after all subquery consumers are fully initialized does it call
   `ShapeLogCollector.mark_as_ready/1`.

This guarantees the materializer view and the outer consumer's seeded
view are both derived from on-disk state alone — no events have flowed
yet. So the materializer view = outer-storage view = pre-restart state,
and any subsequent move-in is correctly enqueued (not dropped as
redundant against a view that has already advanced past it).

The chosen approach is essentially option (3) reduced to its simplest
form: instead of threading per-dep offsets through the subscription
protocol, we hold the dispatch gate closed until every subquery
consumer has caught up to a known consistent point on disk.

**Regression test**

`test/integration/oracle_restore_test.exs#test "bug 5: multiple
subquery shapes diverge after restart with long persisted log"`
reproduces this deterministically with two shapes
(`level_3 WHERE active=true` and `level_3 WHERE active=false`),
200 toggles in batch_1, server restart, and a single
`UPDATE level_3 SET active = false WHERE id = 'l3-2'` in batch_2.
The `@tag chunk_size: 200` is required to make the source shape's
main log span more than one chunk so the timing race exposes itself
reliably.

**Regression test**

`test/integration/oracle_restore_test.exs#test "bug 5: multiple
subquery shapes diverge after restart with long persisted log"` —
deterministic two-shape reproduction. Fails today with the listed
mutation pattern; passes for the single-shape variants.

## Bug 6: Mid-restart shape cleanup leaves shape removed from on-disk metadata — FIXED

**Symptom**

After a `RESTART_SERVER_EVERY` restart, the new clients sometimes get a
`409 (must-refetch)` from a shape that was healthy before the restart.
With `optimized: true` shapes the test flunks immediately. Reliably
reproduces at `SHAPE_COUNT >= 10`, `RESTART_SERVER_EVERY=7` with the
default `seed`. The failing shape varies between runs (shape_5,
shape_8, shape_9, …) but is always one with a subquery dependency.

**Root cause**

`ShapeStatus.remove_shape/2` at
`lib/electric/shape_cache/shape_status.ex:207` removes a shape from
the persistent SQLite store *and* the in-memory ETS cache as its
*first* step:

```elixir
def remove_shape(stack_id, shape_handle) when is_stack_id(stack_id) do
  with :ok <- ShapeDb.remove_shape(stack_id, shape_handle) do
    :ets.delete(shape_meta_table(stack_id), shape_handle)
    decrement_shape_counts(stack_id, shape_cached_as_indexed?(stack_id, shape_handle))
    :ok
  end
end
```

`ShapeCleaner.remove_shape_immediate/3` then proceeds through:

1. `Consumer.stop(stack_id, shape_handle, reason)`
2. `Storage.cleanup!(stack_storage, shape_handle)`
3. `ShapeLogCollector.remove_shape(stack_id, shape_handle)` ← can fail

If the call at step 3 fails (because the SLC's `RequestBatcher` is
already gone — exactly what happens during stack shutdown), the shape
has already been deleted from SQLite. After the new stack restores
shape state from disk, the handle is missing → `validate_shape_handle`
returns `:no_shape` → API returns 409 must-refetch.

The trigger for the cleanup task: a consumer crashes with a non-shutdown
reason during the stop sequence (e.g., a materializer dies with `:killed`
because the supervisor's graceful shutdown timed out, and the dependent
consumer's `handle_materializer_down/2` falls through the `case` to
`stop_and_clean/1`). `stop_and_clean` exits with
`@stop_and_clean_reason = {:shutdown, :cleanup}`, and the consumer's
`terminate/2` calls `ShapeCleaner.handle_writer_termination/3` with that
reason, which schedules `remove_shape_async`. The async task then races
the rest of the stack shutdown.

**Fix**

The materializer was the upstream trigger for the cleanup cascade — a
crash there sets off `handle_materializer_down/2` → `stop_and_clean/1`
on the dependent consumer → `@shutdown_cleanup` →
`remove_shape_async/2`. The cleanup task then races stack shutdown and
leaves the shape half-deleted.

Two changes block the cascade:

1. **Resilient `apply_changes/2` in
   `lib/electric/shapes/consumer/materializer.ex`.** Every "this looks
   impossible" branch now logs a warning and continues rather than
   raising, so an inconsistent inner-shape log can't kill the
   materializer:
   - `DeletedRecord` for a key not in the index → log + skip
   - `NewRecord` for a key already in the index → log + skip
   - `UpdatedRecord` only enters the rewrite path when
     `is_map_key(index, old_key)` holds
   - move-out / move-in iterations switch from `Map.fetch!` to
     `Map.fetch` with a skip branch
   - `decrement_value/3` treats a missing value-count as a no-op

2. **Catch `:noproc` on consumer→materializer call in
   `lib/electric/shapes/consumer.ex#notify_materializer_of_new_changes/3`.**
   When the materializer dies, the `:DOWN` is in our mailbox but the
   inline `GenServer.call` exits the consumer process before
   `handle_materializer_down/2` runs. Catching the exit lets the
   pending `:DOWN` drive a clean stop instead of cascading into
   `@shutdown_cleanup`.

Plus two ergonomic guardrails for the inflight-request window:

- `ShapeStatus.validate_shape_handle/3` rescues `ArgumentError →
  :error` so a held long-poll waking up between old/new
  `ShapeStatusOwner` doesn't 500.
- `Api.check_for_disk_updates/1` rescues `ArgumentError → :no_change`
  for the same window.

**Regression**

The original repro
(`CHECK_TIMEOUT=60000 SHAPE_COUNT=10 MUTATIONS_PER_TXN=10 TXNS_PER_BATCH=10
BATCH_COUNT=10 RESTART_SERVER_EVERY=7 SKIP_REPATCH_PREWARM=true
mix test --seed 8 --only oracle test/integration/oracle_property_test.exs`)
no longer hits a 409 must-refetch. The next blocker exposed by these
fixes is Bug 2 — duplicate inserts in the post-restart move-in
snapshot, which was previously masked by the cascade-409 path
swallowing the failing shape entirely.

## Note for triage

Bugs 1, 4, 5, and 6 are fixed.

Bug 2 is now the next blocker. With the materializer hardening and
ETS-rescue from Bug 6 in place, the cascading 409 is gone — and
underneath it is a real duplicate-insert problem. Repro:

```sh
CHECK_TIMEOUT=60000 SHAPE_COUNT=10 MUTATIONS_PER_TXN=10 TXNS_PER_BATCH=10 \
  BATCH_COUNT=10 RESTART_SERVER_EVERY=7 LONG_POLL_TIMEOUT=2000 \
  SKIP_REPATCH_PREWARM=true \
  mix test --seed 8 --only oracle test/integration/oracle_property_test.exs
```

Failure: `shape=shape_6: insert for row that already exists: {"l4-16"}`.
The shape is a subquery shape (`level_3_id IN (SELECT id FROM
level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE level_1_id =
'l1-4'))`). Pre-restart, `l4-16` is already in the shape's view.
Post-restart, the move-in query attached to a SplicePlan re-emits
`l4-16` as an INSERT even though the snapshot already covered it,
because the move-in's `views_after_move` minus `views_before_move`
includes a value the row was already keyed on through a *different*
path. The fix likely needs `move_in_where_clause` to exclude rows
already present in the outer shape's storage, or for SplicePlan to
dedupe its emitted ops against pre-existing on-disk state.

Bug 3 only manifests under restart and is likely related to the
active-readiness signal — small fix once Bug 2 is closed.
