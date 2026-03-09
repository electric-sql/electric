# Implementation plan: Fix FlushTracker stuck flush (#3985)

See [analysis.md](./analysis.md) for detailed root cause analysis.

## Existing work on this branch

- `398caa38a` -- Generalize `Support.StorageTracer` to trace calls from any module
- `4049f75db` -- Add a regression test for #3985 (in `consumer_test.exs`)

The regression test is already in place and will be the primary validation for
this fix.

## Implementation steps

### Step 1: Fix offset type mismatch in Consumer

**File**: `lib/electric/shapes/consumer.ex`

In `handle_info({ShapeCache.Storage, :flushed, offset_in}, state)` (line 261),
convert the storage-provided tuple offset to a `%LogOffset{}` struct before
passing it to `align_offset_to_txn_boundary`:

```elixir
def handle_info({ShapeCache.Storage, :flushed, offset_in}, state) do
  {state, offset_txn} = State.align_offset_to_txn_boundary(state, LogOffset.new(offset_in))
  ShapeLogCollector.notify_flushed(state.stack_id, state.shape_handle, offset_txn)
  {:noreply, state, state.hibernate_after}
end
```

This is a prerequisite for Step 3: once FlushTracker tracks shapes from
non-commit fragments, flush notifications will reach `handle_flush_notification`
with the shape present in `last_flushed`. The pin match and tree operations
require `%LogOffset{}` structs, not tuples.

### Step 2: Remove commit-only guard in ShapeLogCollector

**File**: `lib/electric/replication/shape_log_collector.ex`

In `publish/2` (lines 572-581), replace the `case event do` block with an
unconditional call:

```elixir
# Before:
flush_tracker =
  case event do
    %TransactionFragment{commit: commit} when not is_nil(commit) ->
      FlushTracker.handle_txn_fragment(state.flush_tracker, event, affected_shapes)
    _ ->
      state.flush_tracker
  end

# After:
flush_tracker = FlushTracker.handle_txn_fragment(state.flush_tracker, event, affected_shapes)
```

### Step 3: Make FlushTracker handle all fragment types

**File**: `lib/electric/replication/shape_log_collector/flush_tracker.ex`

Merge the two `handle_txn_fragment` clauses into one:

1. Remove the `commit: nil` no-op clause (lines 149-155).
2. Remove the `commit: %Commit{}` pattern requirement from the main clause
   (line 104). Accept any `%TransactionFragment{}`.
3. Always track affected shapes (update `last_flushed` map and
   `min_incomplete_flush_tree`).
4. Only update `last_seen_offset` when `commit != nil`.
5. Only call `update_global_offset` when `commit != nil` and `last_flushed == %{}`.

Sketch:

```elixir
def handle_txn_fragment(
      %__MODULE__{
        min_incomplete_flush_tree: min_incomplete_flush_tree,
        last_flushed: last_flushed
      } = state,
      %TransactionFragment{last_log_offset: last_log_offset, commit: commit},
      affected_shapes
    ) do
  prev_log_offset = %LogOffset{tx_offset: last_log_offset.tx_offset - 1}

  {last_flushed, new_shape_ids} =
    Enum.reduce(affected_shapes, {last_flushed, MapSet.new()}, fn shape, {new_last_flushed, new_shape_ids} ->
      case Map.fetch(new_last_flushed, shape) do
        {:ok, {_, last_flushed_offset}} ->
          {Map.put(new_last_flushed, shape, {last_log_offset, last_flushed_offset}), new_shape_ids}
        :error ->
          {Map.put(new_last_flushed, shape, {last_log_offset, prev_log_offset}),
           MapSet.put(new_shape_ids, shape)}
      end
    end)

  min_incomplete_flush_tree =
    if MapSet.size(new_shape_ids) == 0,
      do: min_incomplete_flush_tree,
      else: add_to_tree(min_incomplete_flush_tree, prev_log_offset, new_shape_ids)

  state = %__MODULE__{
    state
    | last_flushed: last_flushed,
      min_incomplete_flush_tree: min_incomplete_flush_tree
  }

  if not is_nil(commit) do
    state = %__MODULE__{state | last_seen_offset: last_log_offset}

    if last_flushed == %{} do
      update_global_offset(state)
    else
      state
    end
  else
    state
  end
end
```

### Step 4: Update FlushTracker tests

**File**: `test/electric/replication/shape_log_collector/flush_tracker_test.exs`

Update or add tests:

- The "should ignore fragments without commits" test (line 30) should be updated
  to verify that shapes ARE tracked but no notification is sent.
- The "should ignore fragments without commits and not affect subsequent
  tracking" test (line 42) should be updated for the new behavior where
  non-commit fragments DO affect tracking.
- Add a test: non-commit fragment registers shape, flush notification catches it
  up, then commit fragment with no affected shapes triggers global offset
  notification.
- Add a test: multiple non-commit fragments update `last_sent` progressively,
  then commit finalizes.

### Step 5: Validate

Run the regression test added in commit `4049f75db`:

```sh
cd packages/sync-service
mix test test/electric/shapes/consumer_test.exs \
  --only "flush notification for multi-fragment txn is not lost when storage flushes before commit fragment"
```

Run the full FlushTracker test suite:

```sh
mix test test/electric/replication/shape_log_collector/flush_tracker_test.exs
```

Run the full consumer test suite:

```sh
mix test test/electric/shapes/consumer_test.exs
```
