# Implementation plan: Fix FlushTracker stuck flush (#3985)

See [analysis.md](./analysis.md) for detailed root cause analysis.

## Existing work on this branch

- `398caa38a` -- Generalize `Support.StorageTracer` to trace calls from any module
- `4049f75db` -- Add a regression test for #3985 (in `consumer_test.exs`)

The regression test is already in place and will be the primary validation for
this fix.

## Implementation steps

### Step 1: Make FlushTracker handle all fragment types

**File**: `lib/electric/replication/shape_log_collector/flush_tracker.ex`

Merge the two `handle_txn_fragment` clauses into one:

1. Remove the `commit: nil` no-op clause (lines 149-155).
2. Remove the `commit: %Commit{}` pattern requirement from the main clause
   (line 104). Accept any `%TransactionFragment{}`.
3. Remove the now-unused `Commit` alias (line 3).
4. Always track affected shapes (update `last_flushed` map and
   `min_incomplete_flush_tree`).
5. Only update `last_seen_offset` when `commit != nil`.
6. Only call `update_global_offset` when `commit != nil` and
   `last_flushed == %{}`.

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
    Enum.reduce(
      affected_shapes,
      {last_flushed, MapSet.new()},
      fn shape, {new_last_flushed, new_shape_ids} ->
        case Map.fetch(new_last_flushed, shape) do
          {:ok, {_, last_flushed_offset}} ->
            {Map.put(new_last_flushed, shape, {last_log_offset, last_flushed_offset}),
             new_shape_ids}

          :error ->
            {Map.put(new_last_flushed, shape, {last_log_offset, prev_log_offset}),
             MapSet.put(new_shape_ids, shape)}
        end
      end
    )

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

### Step 2: Remove commit-only guard in ShapeLogCollector

**File**: `lib/electric/replication/shape_log_collector.ex`

In `publish/2` (lines 572-581), replace the `case event do` block with an
unconditional call:

```elixir
flush_tracker = FlushTracker.handle_txn_fragment(state.flush_tracker, event, affected_shapes)
```

Steps 1 and 2 can be done in a single commit since the ShapeLogCollector change
depends on FlushTracker accepting non-commit fragments.

### Step 3: Update FlushTracker tests

**File**: `test/electric/replication/shape_log_collector/flush_tracker_test.exs`

Update existing tests for the new behavior:

- **"should ignore fragments without commits"** (line 30): now shapes ARE tracked
  (not empty) but no flush notification is sent (no commit to finalize).
- **"should ignore fragments without commits and not affect subsequent tracking"**
  (line 42): non-commit fragments now DO affect tracking — a shape registered by
  a non-commit fragment carries over to subsequent commit fragment processing.

Add new tests:

- Non-commit fragment registers shape, flush notification catches it up, then
  commit fragment with no affected shapes triggers global offset notification.
- Multiple non-commit fragments update `last_sent` progressively, then commit
  finalizes and notifies.
- Non-commit fragment with no affected shapes is a no-op (no tracking, no
  notification).

### Step 4: Validate

Run the regression test added in commit `4049f75db`:

```sh
cd packages/sync-service
mix test test/electric/shapes/consumer_test.exs \
  --only "flush notification for multi-fragment txn is not lost"
```

Run the full FlushTracker test suite:

```sh
mix test test/electric/replication/shape_log_collector/flush_tracker_test.exs
```

Run the full consumer test suite:

```sh
mix test test/electric/shapes/consumer_test.exs
```
