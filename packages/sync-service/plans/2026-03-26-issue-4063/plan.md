# Deferred Flush Notification for Multi-Fragment Transactions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the race condition where a consumer sends an unaligned flush offset to FlushTracker when storage flushes data from a non-commit fragment before the commit fragment populates `txn_offset_mapping`.

**Architecture:** Two coordinated changes: (1) Revert FlushTracker to only track shapes from commit fragments (undoing the early-tracking approach from PR #3986). (2) In the Consumer, defer `{Storage, :flushed, offset}` notifications that arrive during a pending transaction, then process the deferred notification after the commit fragment has been handled and `txn_offset_mapping` is populated.

**Tech Stack:** Elixir, GenServer, ExUnit

**Ref:** https://github.com/electric-sql/electric/issues/4063

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/electric/replication/shape_log_collector/flush_tracker.ex` | Modify | Revert non-commit fragment tracking to no-op; commit tracks ALL delivered shapes |
| `lib/electric/shapes/consumer/state.ex` | Modify | Add `pending_flush_offset` field to struct |
| `lib/electric/shapes/consumer.ex` | Modify | Defer `:flushed` messages during pending txn; process deferred in `maybe_complete_pending_txn` and `skip_txn_fragment` |
| `test/electric/replication/shape_log_collector/flush_tracker_test.exs` | Modify | Update tests: non-commit fragment is now a no-op, commit tracks all affected shapes |
| `test/electric/shapes/consumer_test.exs` | Modify | Update regression test to verify deferred flush behavior |

---

### Task 1: Revert FlushTracker non-commit fragment tracking

**Files:**
- Modify: `lib/electric/replication/shape_log_collector/flush_tracker.ex:105-141`
- Modify: `test/electric/replication/shape_log_collector/flush_tracker_test.exs`

The non-commit clause currently calls `track_shapes()`. It needs to be removed so that only the clause that matches on %Commit{} remains. The commit clause currently filters `affected_shapes` to only those in `shapes_with_changes` or already tracked. Since non-commit fragments no longer track anything, `is_map_key(state.last_flushed, shape)` is always false for shapes not in the commit. Revert to tracking ALL `affected_shapes` delivered for the commit.

- [ ] **Step 1: Remove FlushTracker non-commit clause**

In `flush_tracker.ex`, replace lines 105-115:

```diff
-  # Non-commit fragment: track affected shapes but don't update last_seen_offset
-  # or notify. This ensures shapes are registered early so flush notifications
-  # from Consumers aren't lost when storage flushes before the commit arrives.
-  def handle_txn_fragment(
-        %__MODULE__{} = state,
-        %TransactionFragment{commit: nil, last_log_offset: last_log_offset},
-        affected_shapes,
-        _shapes_with_changes
-      ) do
-    track_shapes(state, last_log_offset, affected_shapes)
-  end
```

- [ ] **Step 2: Update FlushTracker commit clause to track all affected shapes**

In `flush_tracker.ex`, replace lines 117-141:

```elixir
  # Commit fragment: track all shapes affected by all fragments of the transaction and update last_seen_offset.
  def handle_txn_fragment(
        %__MODULE__{} = state,
        %TransactionFragment{commit: %Commit{}, last_log_offset: last_log_offset},
        affected_shapes,
        _shapes_with_changes
      ) do
    state = track_shapes(state, last_log_offset, affected_shapes)

    state = %{state | last_seen_offset: last_log_offset}

    if state.last_flushed == %{} do
      update_global_offset(state)
    else
      state
    end
  end
```

- [ ] **Step 3: Remove `last_seen_offset == before_all` guard from `handle_flush_notification`**

In `flush_tracker.ex`, lines 214-221, replace:

```elixir
    # Only update global offset if we've seen at least one commit.
    # Before any commit, last_seen_offset is before_all and there's
    # nothing meaningful to report.
    if state.last_seen_offset == LogOffset.before_all() do
      state
    else
      update_global_offset(state)
    end
```

with just:

```elixir
    update_global_offset(state)
```

This guard was added in PR #3986 because non-commit fragments could trigger flush notifications before any commit. With the deferred approach in Consumer, flush notifications only reach FlushTracker after a commit has been processed.

- [ ] **Step 4: Update FlushTracker tests**

Several tests exercise non-commit fragment tracking that no longer applies. Update:

**Test "non-commit fragment tracks shapes but does not notify or update last_seen"** (line 30):
Non-commit fragments are now raising FunctionClauseError. Add an assert_raise to the test

```elixir
    test "non-commit fragment is a no-op", %{tracker: tracker} do
      fragment = %TransactionFragment{
        xid: 1,
        lsn: 1,
        last_log_offset: LogOffset.new(1, 0),
        commit: nil
      }

      assert_raise FunctionClauseError, fn -> handle_txn(tracker, fragment, ["shape1"]) end
    end
```

**Test "shape tracked by non-commit fragment can be flushed before commit arrives"** (line 59):
This test's premise no longer holds (non-commit doesn't track). Replace with a test that verifies the commit tracks all affected shapes regardless of whether they had changes in the commit fragment:

```elixir
    test "commit tracks all affected shapes even those without changes in the commit fragment",
         %{tracker: tracker} do
      # shape1 had changes in a non-commit fragment (not tracked by FlushTracker).
      # The commit fragment lists it in affected_shapes (via shapes_in_txn).
      # shapes_with_changes is empty (no data changes in commit).
      tracker =
        FlushTracker.handle_txn_fragment(
          tracker,
          batch(xid: 1, lsn: 5, last_offset: 10),
          ["shape1"],
          MapSet.new()
        )

      refute FlushTracker.empty?(tracker)

      # Flush at the commit offset catches up
      tracker =
        FlushTracker.handle_flush_notification(tracker, "shape1", LogOffset.new(5, 10))

      assert_receive {:flush_confirmed, 5}
      assert FlushTracker.empty?(tracker)
    end
```

**Test "shape tracked by non-commit and still pending is updated by commit"** (line 95):
Remove this test — its premise (non-commit tracking + commit updating last_sent) no longer applies.

**Test "already-flushed shape with new changes in commit is re-tracked"** (line 163):
Remove this test — non-commit fragments no longer track, so there's nothing to "re-track".

**Test "multiple non-commit fragments update last_sent progressively"** (line 199):
Remove this test — non-commit fragments are no-ops.

**Test "shape only in commit (not in non-commit fragments) is tracked normally"** (line 128):
Simplify: just verify the commit tracks both shapes:

```elixir
    test "commit tracks all shapes including those that had changes only in earlier fragments",
         %{tracker: tracker} do
      # shape1 only had changes in non-commit fragment (not visible to FlushTracker).
      # shape2 has changes in the commit fragment. Both appear in affected_shapes.
      tracker =
        FlushTracker.handle_txn_fragment(
          tracker,
          batch(xid: 1, lsn: 5, last_offset: 10),
          ["shape1", "shape2"],
          MapSet.new(["shape2"])
        )

      refute FlushTracker.empty?(tracker)

      # Both shapes need to be flushed
      tracker =
        FlushTracker.handle_flush_notification(tracker, "shape1", LogOffset.new(5, 10))

      tracker =
        FlushTracker.handle_flush_notification(tracker, "shape2", LogOffset.new(5, 10))

      assert_receive {:flush_confirmed, 5}
      assert FlushTracker.empty?(tracker)
    end
```

- [ ] **Step 5: Run FlushTracker tests**

Run: `mix test test/electric/replication/shape_log_collector/flush_tracker_test.exs`
Expected: ALL PASS

- [ ] **Step 6: Format the code**

```
mix format
```

- [ ] **Step 7: Commit**

```
git add packages/sync-service/lib/electric/replication/shape_log_collector/flush_tracker.ex \
      packages/sync-service/test/electric/replication/shape_log_collector/flush_tracker_test.exs
git commit -m "Revert FlushTracker to commit-only tracking

Non-commit fragments no longer register shapes in FlushTracker.
The Consumer will defer flush notifications until the commit fragment
is processed, so early registration is no longer needed.

Refs: #4063"
```

---

### Task 2: Add `pending_flush_offset` to Consumer state

**Files:**
- Modify: `lib/electric/shapes/consumer/state.ex:19-46`

- [ ] **Step 1: Add `pending_flush_offset` field to the State struct**

In `state.ex`, add the field to the struct definition (after `pending_txn: nil`):

```elixir
    # When a {Storage, :flushed, offset} message arrives during a pending
    # transaction, we defer the notification and store the max flushed offset
    # here. It is processed in maybe_complete_pending_txn after txn_offset_mapping
    # is populated. Multiple deferred notifications are collapsed into the max offset.
    pending_flush_offset: nil
```

- [ ] **Step 2: Commit**

```
git add packages/sync-service/lib/electric/shapes/consumer/state.ex
git commit -m "Add pending_flush_offset field to Consumer.State"
```

---

### Task 3: Defer flush notifications in Consumer during pending transactions

**Files:**
- Modify: `lib/electric/shapes/consumer.ex:273-278,594-599,696-753`

This is the core fix. Three changes in `consumer.ex`:

1. Split the `:flushed` handler to defer during pending transactions
2. Add `process_pending_flush/1` helper
3. Call it from `maybe_complete_pending_txn` and `skip_txn_fragment`

- [ ] **Step 1: Split the `:flushed` handler into two clauses**

Replace lines 273-278:

```elixir
  def handle_info({ShapeCache.Storage, :flushed, offset_in}, state) do
    {state, offset_txn} = State.align_offset_to_txn_boundary(state, offset_in)

    ShapeLogCollector.notify_flushed(state.stack_id, state.shape_handle, offset_txn)
    {:noreply, state, state.hibernate_after}
  end
```

with:

```elixir
  # When a flush arrives during a pending transaction:
  # 1. Immediately notify SLC with the highest completed-txn boundary from
  #    txn_offset_mapping (if any entries are covered by this flush).
  # 2. Save the flushed offset for the current pending txn whose
  #    txn_offset_mapping entry doesn't exist yet.
  def handle_info(
        {ShapeCache.Storage, :flushed, offset_in},
        %{write_unit: State.write_unit_txn_fragment(), pending_txn: pending_txn} = state
      )
      when not is_nil(pending_txn) do
    state = notify_flushed_mappings(state, offset_in)

    # Save the flushed offset for the current pending txn.
    updated_offset = LogOffset.max(state.pending_flush_offset || offset_in, offset_in)
    {:noreply, %{state | pending_flush_offset: updated_offset}, state.hibernate_after}
  end

  def handle_info({ShapeCache.Storage, :flushed, offset_in}, state) do
    {state, offset_txn} = State.align_offset_to_txn_boundary(state, offset_in)

    ShapeLogCollector.notify_flushed(state.stack_id, state.shape_handle, offset_txn)
    {:noreply, state, state.hibernate_after}
  end
```

- [ ] **Step 2: Add `consume_flushed_mappings/2`, `notify_flushed_mappings/2`, and `process_pending_flush/1`**

Add these private functions near the end of the module (e.g. after `consider_flushed`):

```elixir
  # Walk txn_offset_mapping, dropping entries whose key <= offset_in,
  # keeping only the last seen boundary. Stops at the first key > offset_in.
  # Returns {nil, list} if nothing matched, {boundary, remaining} otherwise.
  defp consume_flushed_mappings([{key, boundary} | rest], offset_in)
       when LogOffset.is_log_offset_lte(key, offset_in) do
    consume_flushed_mappings(rest, offset_in, boundary)
  end

  defp consume_flushed_mappings(remaining, _offset_in), do: {nil, remaining}

  defp consume_flushed_mappings([{key, boundary} | rest], offset_in, _prev_boundary)
       when LogOffset.is_log_offset_lte(key, offset_in) do
    consume_flushed_mappings(rest, offset_in, boundary)
  end

  defp consume_flushed_mappings(remaining, _offset_in, boundary), do: {boundary, remaining}

  # Consume completed entries from txn_offset_mapping and send a single
  # flush notification with the highest boundary. FlushTracker keeps one
  # {last_sent, last_flushed} entry per shape, so one notification suffices.
  defp notify_flushed_mappings(state, offset_in) do
    case consume_flushed_mappings(state.txn_offset_mapping, offset_in) do
      {nil, _} ->
        state

      {boundary, remaining} ->
        ShapeLogCollector.notify_flushed(state.stack_id, state.shape_handle, boundary)
        %{state | txn_offset_mapping: remaining}
    end
  end

  # After a pending transaction completes and txn_offset_mapping is populated,
  # process the deferred flushed offset (if any).
  defp process_pending_flush(%{pending_flush_offset: nil} = state), do: state

  defp process_pending_flush(%{pending_flush_offset: flushed_offset} = state) do
    state = %{state | pending_flush_offset: nil}
    notify_flushed_mappings(state, flushed_offset)
  end
```

- [ ] **Step 3: Call `process_pending_flush` in `maybe_complete_pending_txn` (num_changes > 0 branch)**

In the `txn.num_changes > 0` branch of `maybe_complete_pending_txn` (around line 738), change:

```elixir
      %{
        state
        | writer: writer,
          pending_txn: nil,
          txn_offset_mapping:
            state.txn_offset_mapping ++ [{state.latest_offset, txn_fragment.last_log_offset}]
      }
```

to:

```elixir
      state = %{
        state
        | writer: writer,
          pending_txn: nil,
          txn_offset_mapping:
            state.txn_offset_mapping ++ [{state.latest_offset, txn_fragment.last_log_offset}]
      }

      process_pending_flush(state)
```

- [ ] **Step 4: Run the full consumer test suite**

Run: `mix test test/electric/shapes/consumer_test.exs`
Expected: ALL PASS (including the existing regression test for #4058 on the branch)

- [ ] **Step 5: Commit**

```
git add packages/sync-service/lib/electric/shapes/consumer.ex \
      packages/sync-service/lib/electric/shapes/consumer/state.ex
git commit -m "Defer flush notifications in Consumer during pending transactions

When a {Storage, :flushed, offset} message arrives while a multi-fragment
transaction is pending, the Consumer now saves the offset instead of
immediately notifying the ShapeLogCollector. After the commit fragment
populates txn_offset_mapping, the deferred offset is aligned and sent
as a single notification.

This fixes the race condition where the consumer sent an unaligned
flush offset to FlushTracker because txn_offset_mapping was empty
at the time of the storage flush.

Refs: #4063"
```

---

### Task 4: Update the regression test for the new behavior

**Files:**
- Modify: `test/electric/shapes/consumer_test.exs` (the test added on this branch starting at line 1777)

The existing regression test for #4058 traces `notify_flushed` calls after the non-commit fragment. With the deferred approach, the consumer should NOT call `notify_flushed` after the non-commit fragment. Instead, it should call it after the commit fragment.

- [ ] **Step 1: Update the regression test assertions**

The test currently asserts that `notify_flushed` is called right after the non-commit fragment with `relevant_change_offset`. With the fix, the consumer defers this notification. The assertion should change: after the non-commit fragment, `notify_flushed` should NOT have been called. After the commit fragment, `notify_flushed` should have been called with the **aligned** offset (the commit fragment's `last_log_offset`).

Replace the test's assertion section (from the `Support.Trace.trace_shape_log_collector_calls` call through the end of the test) with:

```elixir
      Support.Trace.trace_shape_log_collector_calls(
        pid: Shapes.Consumer.whereis(stack_id, shape_handle),
        functions: [:notify_flushed]
      )

      assert :ok = ShapeLogCollector.handle_event(non_commit_fragment, stack_id)

      # With deferred flush notifications, the consumer does NOT call notify_flushed
      # after the non-commit fragment. The :flushed message is saved for later.
      assert [] == Support.Trace.collect_traced_calls()

      # Send the commit fragment to finalize the transaction.
      assert :ok = ShapeLogCollector.handle_event(commit_fragment, stack_id)

      # Consumer has processed the relevant change...
      assert_receive {^ref, :new_changes, ^relevant_change_offset}, @receive_timeout

      # The deferred flush notification is sent after the commit with the
      # aligned offset (the commit fragment's last_log_offset).
      commit_last_log_offset = commit_fragment.last_log_offset

      assert [
               {ShapeLogCollector, :notify_flushed,
                [^stack_id, ^shape_handle, ^commit_last_log_offset]}
             ] = Support.Trace.collect_traced_calls()

      # Flush boundary advances correctly.
      tx_offset = commit_fragment.last_log_offset.tx_offset
      assert_receive {:flush_boundary_updated, ^tx_offset}, @receive_timeout
```

- [ ] **Step 2: Also update the #3985 regression test if needed**

The test at line 1676 ("flush notification for multi-fragment txn is not lost when storage flushes before commit fragment") sends two non-commit fragments with `flush_period: 1` (timer-based flush). With the deferred approach, the `notify_flushed` call traced after fragments 1+2 should now be deferred. Let me check: this test uses `:trace` messages from the tracing module. It matches on `{:trace, _, :call, {ShapeLogCollector, :notify_flushed, ...}}`.

With deferred flush, the consumer no longer calls `notify_flushed` after the non-commit fragments. The traced call would appear only after the commit fragment. Update the test accordingly:

Replace the section after `ShapeLogCollector.handle_event(fragment2, stack_id)`:

```elixir
      assert :ok = ShapeLogCollector.handle_event(fragment1, stack_id)
      assert :ok = ShapeLogCollector.handle_event(fragment2, stack_id)

      # With deferred flush notifications, notify_flushed is NOT called
      # after non-commit fragments. The flush is deferred until the commit.
      refute_receive {:trace, _, :call, {ShapeLogCollector, :notify_flushed, _}}, 100

      # Now send the commit fragment.
      commit_fragment =
        txn_fragment(
          xid,
          lsn,
          [
            %Changes.NewRecord{
              relation: {"public", "other_table"},
              record: %{"id" => "99"},
              log_offset: LogOffset.new(lsn, 6)
            }
          ],
          has_commit?: true
        )

      assert :ok = ShapeLogCollector.handle_event(commit_fragment, ctx.stack_id)
      assert_receive {^ref, :new_changes, _}, @receive_timeout

      # The deferred flush notification is sent after the commit, aligned
      # to the commit fragment's last_log_offset.
      commit_offset = commit_fragment.last_log_offset

      assert_receive {:trace, _, :call,
                      {ShapeLogCollector, :notify_flushed,
                       [^stack_id, ^shape_handle, ^commit_offset]}},
                     @receive_timeout

      # Flush boundary advances.
      tx_offset = commit_fragment.last_log_offset.tx_offset
      assert_receive {:flush_boundary_updated, ^tx_offset}, @receive_timeout
```

Note: the exact shape of this change depends on how the existing test is structured. The key changes are:
1. After non-commit fragments: `refute_receive` for notify_flushed (was `assert_receive`)
2. After commit: `assert_receive` for notify_flushed with the commit's aligned offset
3. The flush boundary assertion stays the same

- [ ] **Step 3: Run consumer tests**

Run: `mix test test/electric/shapes/consumer_test.exs`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```
git add packages/sync-service/test/electric/shapes/consumer_test.exs
git commit -m "Update regression tests for deferred flush notification behavior

Tests now verify that flush notifications are deferred during pending
transactions and sent only after the commit fragment is processed.

Refs: #4063"
```

---

### Task 5: Run the full test suite

- [ ] **Step 1: Run the sync-service test suite**

Run: `mix test`
Expected: ALL PASS

- [ ] **Step 2: If any failures, investigate and fix**

Pay attention to:
- Tests that depend on flush notification timing
- Tests that trace `notify_flushed` calls
- Tests with `write_unit: :txn_fragment` behavior

---

## Design Notes

### Why revert FlushTracker instead of keeping early tracking?

The early tracking approach (from PR #3986) tried to solve the problem at the FlushTracker level: register shapes early so flush notifications aren't lost. But this created a new problem: the non-commit fragment's `last_log_offset` could be higher than the consumer's written offset (due to unrelated changes), causing FlushTracker to see a `last_sent` that's higher than any flush notification the consumer would send.

The deferred approach solves the root cause at the Consumer level: don't send flush notifications until `txn_offset_mapping` is populated and the offset can be correctly aligned to the transaction boundary.

### What happens when data is only partially flushed?

If the deferred `flushed_offset < state.latest_offset`, the consumer does NOT send a notification. After the commit, `pending_txn` is nil and `txn_offset_mapping` is populated. The next `{Storage, :flushed, _}` message (from a timer or subsequent write) is handled by the normal (non-deferred) clause, which calls `align_offset_to_txn_boundary` with the correct mapping.

### What about cross-transaction flushes?

A `:flushed` message may cover data from previously committed transactions whose entries are already in `txn_offset_mapping`. The deferred handler splits `txn_offset_mapping` at the flushed offset and sends a single `notify_flushed` with the highest completed boundary. This is sufficient because FlushTracker keeps one `{last_sent, last_flushed}` entry per shape — it will either store the boundary as `last_flushed` (if a newer commit already updated `last_sent`) or remove the shape entirely (if `last_sent` matches), in which case the next commit re-adds it as a new entry.

Only the current pending transaction's portion of the flush is deferred (saved as `pending_flush_offset`), because its `txn_offset_mapping` entry doesn't exist yet. After the commit populates the entry, `process_pending_flush` uses the same split-and-notify pattern.
