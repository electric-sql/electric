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

The `Commit` alias becomes unused after removing the pattern match and can be
dropped.

### 2. ShapeLogCollector (`shape_log_collector.ex`)

In `publish/2` (lines 572-579), remove the `case event do` condition and always
pass the event to FlushTracker:

```elixir
flush_tracker = FlushTracker.handle_txn_fragment(state.flush_tracker, event, affected_shapes)
```

No Consumer changes are needed. The storage `:flushed` message already carries
`%LogOffset{}` structs (verified: `LogItems.from_change` -> `prepare_log_entries`
-> `normalize_log_stream` -> `add_to_buffer` -> `flush_buffer` — the offset is a
struct the entire way).

## Offset alignment between FlushTracker and Consumer

FlushTracker sets `last_sent` to the **original fragment's** `last_log_offset`
(which covers all changes in the fragment, across all shapes). Each shape's
Consumer only writes matching changes and sets `latest_offset` to
`LogItems.expected_offset_after_split(last_matching_change)`.

**When all fragment changes match the shape** (the common case): Consumer's
`latest_offset == fragment.last_log_offset`. Storage flushes at this offset. If
the shape was tracked from a non-commit fragment, the flush matches `last_sent`
and the shape is removed from tracking.

**When not all fragment changes match** (i.e. a fragment has changes for multiple
shapes): Consumer's `latest_offset < fragment.last_log_offset`. Storage flushes
at a lower offset than `last_sent`. The shape stays tracked but `last_flushed`
advances. When the commit fragment arrives, `last_sent` is updated to the
commit's offset. The Consumer's `txn_offset_mapping` (set by
`maybe_complete_pending_txn`) maps `{latest_offset, commit.last_log_offset}`. The
next storage flush aligns via this mapping and catches the shape up.

If the commit fragment has matching changes for the shape, the Consumer writes
them (adding to the buffer), so a new flush is scheduled and fires promptly.

If the commit fragment has NO matching changes, no new buffer data is added and
`signal_txn_commit!` does not schedule a flush. The shape catches up on the next
transaction that triggers a storage flush. This is a temporary delay, not a
permanent block.

## Changes summary

| File | Change | Why |
|------|--------|-----|
| `flush_tracker.ex` | Handle all fragments; gate `last_seen_offset`/`update_global_offset` on commit | Register shapes early so flush notifications aren't lost |
| `shape_log_collector.ex` | Remove `case event do` guard in `publish/2` | Pass all fragments to FlushTracker |
