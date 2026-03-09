# Analysis: FlushTracker stuck flush bug (#3985)

## The bug

In `publish/2` (`shape_log_collector.ex:572-579`), FlushTracker only processes
transaction fragments that have `commit != nil`. When a multi-fragment
transaction's non-commit fragments are flushed to storage before the commit
fragment arrives, the flush notification is lost because FlushTracker hasn't
registered the shape yet. After the commit arrives and registers the shape, no
new flush fires (the write buffer is already empty and the flush timer is
cancelled), leaving the shape stuck in FlushTracker forever and blocking the
global flush offset from advancing.

### Reproduction sequence

1. F1 (non-commit) arrives -> Consumer writes matching changes -> storage flushes
2. Consumer reports flush -> FlushTracker ignores it (shape not tracked)
3. F2 (commit) arrives -> FlushTracker registers shape with
   `last_sent = commit.last_log_offset`
4. Storage buffer is empty, timer cancelled -> no new `:flushed` message ->
   shape stuck forever -> global flush offset never advances

### Where the filtering happens

**ShapeLogCollector** (`shape_log_collector.ex:572-579`):

```elixir
flush_tracker =
  case event do
    %TransactionFragment{commit: commit} when not is_nil(commit) ->
      FlushTracker.handle_txn_fragment(state.flush_tracker, event, affected_shapes)
    _ ->
      state.flush_tracker
  end
```

**FlushTracker** (`flush_tracker.ex:149-155`):

```elixir
def handle_txn_fragment(
      %__MODULE__{} = state,
      %TransactionFragment{commit: nil},
      _affected_shapes
    ) do
  state
end
```

Both locations discard non-commit fragments.

## Root cause context

This was introduced in PR #3783 which added per-transaction-fragment writing to
storage. Before that PR, consumers only wrote complete transactions, so only
commit fragments were relevant to FlushTracker. With per-fragment writes,
consumers write and flush data from non-commit fragments too, making the
commit-only tracking insufficient.

## Required changes

### 1. FlushTracker (`flush_tracker.ex`)

Merge the two `handle_txn_fragment` clauses into one that handles ALL fragments:

- **Always**: Track affected shapes (update `last_flushed` map and
  `min_incomplete_flush_tree`).
- **Only on commit** (`commit != nil`): Update `last_seen_offset` and call
  `update_global_offset`/notify.

Remove the `commit: nil` no-op clause (lines 149-155). Drop the
`commit: %Commit{}` pattern requirement from the main clause (line 104). Guard
the `last_seen_offset` update (line 137) and `update_global_offset` call (lines
141-146) behind a `commit != nil` check.

This ensures shapes are registered early (when non-commit fragments arrive), so
subsequent flush notifications from Consumers are properly handled, while
avoiding notifying ReplicationClient about non-committed data.

### 2. ShapeLogCollector (`shape_log_collector.ex`)

In `publish/2` (lines 572-579), remove the `case event do` condition and always
pass the event to FlushTracker:

```elixir
flush_tracker = FlushTracker.handle_txn_fragment(state.flush_tracker, event, affected_shapes)
```

### 3. Consumer offset type mismatch (`consumer.ex`)

The PureFileStorage write loop stores offsets as **tuples** `{tx_offset,
op_offset}` (from `LogOffset.to_tuple` in log items). The `:flushed` message
sends this tuple. When `txn_offset_mapping` is empty (flush fires before
commit), `align_offset_to_txn_boundary` passes the raw tuple through to
FlushTracker.

But FlushTracker stores `last_sent` as `%LogOffset{}` **structs** (from
`TransactionFragment.last_log_offset`). The pin match in
`handle_flush_notification` (line 169) compares the tuple against the struct --
they won't match. Additionally, `delete_from_tree` and `add_to_tree` call
`LogOffset.to_tuple/1` which expects a struct, so passing a tuple would crash.

**Fix**: Convert the offset to a `%LogOffset{}` struct in the Consumer's
`handle_info(:flushed)` handler:

```elixir
def handle_info({ShapeCache.Storage, :flushed, offset_in}, state) do
  {state, offset_txn} = State.align_offset_to_txn_boundary(state, LogOffset.new(offset_in))
  ...
```

`LogOffset.new/1` already accepts tuples:
`def new({tx_offset, op_offset}), do: new(tx_offset, op_offset)`.

### 4. No additional "stuck shape" concern for common cases

For `NewRecord` changes, `LogItems.expected_offset_after_split` returns the
change's `log_offset` unchanged (`log_items.ex:144`). When all fragment changes
match the shape, `consumer.latest_offset == fragment.last_log_offset`. So the
storage's flushed offset matches FlushTracker's `last_sent` and the shape is
removed.

For edge cases where not all changes match (consumer writes fewer changes than
the fragment contains), the consumer's flushed offset may be less than
`fragment.last_log_offset`. The shape stays tracked after the early flush, gets
`last_sent` updated to the commit offset when the commit arrives, and catches up
when `txn_offset_mapping` alignment produces a flush at the commit offset.

## Changes summary

| File | Change | Why |
|------|--------|-----|
| `flush_tracker.ex` | Handle all fragments; gate `last_seen_offset`/`update_global_offset` on commit | Register shapes early so flush notifications aren't lost |
| `shape_log_collector.ex` | Remove `case event do` guard in `publish/2` | Pass all fragments to FlushTracker |
| `consumer.ex` | Convert storage offset to `LogOffset` struct | Fix tuple vs struct mismatch in pin match and tree operations |
