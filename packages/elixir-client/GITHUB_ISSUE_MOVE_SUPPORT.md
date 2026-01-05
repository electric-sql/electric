# Add Move-In/Out Support for Subqueries in Elixir Client

## Summary

Add support for tagged rows and move-out events in the Elixir client, enabling proper handling of shapes with subqueries in their WHERE clauses.

## Background

When a shape has a subquery (e.g., `WHERE parent_id IN (SELECT id FROM parent WHERE active = true)`), rows can dynamically enter or leave the shape based on changes in the dependency. The server implements this via:

- **Tags**: Each row gets tags explaining *why* it's in the shape (MD5 hash of the referenced value)
- **Move-out events**: When a dependency value is removed, a pattern-based event tells clients to remove matching rows
- **Snapshot-end**: Visibility boundaries for move-in query results

This feature was implemented in the TypeScript client via [TanStack/db#942](https://github.com/TanStack/db/pull/942) and the server-side in [electric-sql/electric#3427](https://github.com/electric-sql/electric/pull/3427).

## Wire Protocol

### Change Messages with Tags

```json
{
  "key": "\"public\".\"child\"/\"1\"",
  "value": {"id": "1", "parent_id": "1", "name": "..."},
  "headers": {
    "operation": "insert",
    "tags": ["abc123def456..."]
  }
}
```

### Update with Tag Changes

```json
{
  "headers": {
    "operation": "update",
    "tags": ["xyz789..."],
    "removed_tags": ["abc123..."]
  }
}
```

### Move-Out Event

```json
{
  "headers": {
    "event": "move-out",
    "patterns": [{"pos": 0, "value": "abc123def456..."}]
  }
}
```

### Snapshot-End Control

```json
{
  "headers": {
    "control": "snapshot-end",
    "xmin": "100",
    "xmax": "200",
    "xip_list": ["150"]
  }
}
```

## Implementation Plan

### Phase 1: Data Structures

#### 1.1 Create `Electric.Client.TagIndex` module

Positional index for efficient move-out pattern matching.

**File**: `lib/electric/client/tag_index.ex`

| Function | Description |
|----------|-------------|
| `new/0` | Create empty index |
| `parse_tag/1` | Split tag string by `\|` delimiter |
| `add_tag/3` | Add tag to index for a row |
| `remove_tag/3` | Remove tag from index |
| `find_rows_matching_pattern/2` | O(1) lookup of rows by position+value |
| `tag_matches_pattern?/2` | Check if parsed tag matches pattern |

**Data structure**:
```elixir
%TagIndex{
  index: [%{value => MapSet.t(row_key)}],  # Array indexed by position
  tag_length: non_neg_integer() | nil
}
```

#### 1.2 Create `Electric.Client.MoveState` module

Track tag state for all rows in a shape.

**File**: `lib/electric/client/move_state.ex`

| Function | Description |
|----------|-------------|
| `new/0` | Create empty state |
| `add_tags_to_row/3` | Add tags to a row |
| `remove_tags_from_row/3` | Remove specific tags |
| `clear_row/2` | Remove all tags for a row (on delete) |
| `process_move_out_pattern/2` | Remove matching tags, return rows to delete |
| `reset/1` | Clear all state (on must-refetch) |

**Data structure**:
```elixir
%MoveState{
  row_tags: %{row_key => MapSet.t(tag)},
  tag_index: %TagIndex{},
  tag_cache: %{tag => parsed_tag}
}
```

---

### Phase 2: Message Types

#### 2.1 Update `Message.Headers`

Add tag fields to the headers struct:

```elixir
defstruct [
  # ... existing fields ...
  tags: [],           # List of move tags
  removed_tags: []    # Tags being removed (updates only)
]
```

#### 2.2 Add `Message.EventMessage`

New struct for event messages:

```elixir
defmodule EventMessage do
  defstruct [:event, :patterns, :handle, :request_timestamp]

  @type t :: %__MODULE__{
    event: :move_out,
    patterns: [%{pos: non_neg_integer(), value: String.t()}],
    handle: String.t(),
    request_timestamp: DateTime.t()
  }
end
```

#### 2.3 Update `Message.ControlMessage`

Add snapshot visibility fields for `snapshot-end`:

```elixir
defstruct [
  # ... existing fields ...
  xmin: nil,
  xmax: nil,
  xip_list: nil
]
```

#### 2.4 Update `Message.parse/3`

Add clause to parse event messages:

```elixir
def parse(%{"headers" => %{"event" => _}} = msg, handle, _) do
  [EventMessage.from_message(msg, handle)]
end
```

---

### Phase 3: Stream Processing

#### 3.1 Update Stream struct

```elixir
defstruct [
  # ... existing fields ...
  move_state: nil,
  buffered_move_outs: []
]
```

#### 3.2 Process tags on change messages

```elixir
defp process_change_tags(%ChangeMessage{} = msg, stream) do
  case msg.headers.operation do
    :delete -> MoveState.clear_row(stream.move_state, msg.key)
    _ ->
      stream.move_state
      |> MoveState.remove_tags_from_row(msg.key, msg.headers.removed_tags)
      |> MoveState.add_tags_to_row(msg.key, msg.headers.tags)
  end
end
```

#### 3.3 Handle move-out events

```elixir
defp handle_msg(%EventMessage{event: :move_out} = msg, stream) do
  if stream.up_to_date? do
    process_move_out(msg, stream)
  else
    # Buffer until initial sync completes
    {:cont, %{stream | buffered_move_outs: [msg | stream.buffered_move_outs]}}
  end
end
```

#### 3.4 Generate synthetic deletes

```elixir
defp process_move_out(%EventMessage{patterns: patterns}, stream) do
  {rows_to_delete, move_state} =
    Enum.reduce(patterns, {[], stream.move_state}, fn pattern, {dels, state} ->
      {new_dels, state} = MoveState.process_move_out_pattern(state, pattern)
      {new_dels ++ dels, state}
    end)

  # Generate synthetic delete messages
  delete_msgs = Enum.map(rows_to_delete, fn key ->
    %ChangeMessage{
      key: key,
      value: %{},
      headers: Headers.delete(handle: stream.shape_handle)
    }
  end)

  {:cont, buffer_messages(stream, delete_msgs)}
end
```

#### 3.5 Process buffered move-outs on up-to-date

```elixir
defp handle_msg(%ControlMessage{control: :up_to_date} = msg, stream) do
  stream = process_buffered_move_outs(stream)
  # ... existing up_to_date handling ...
end
```

---

### Phase 4: Tests

#### Unit Tests

- [ ] `test/electric/client/tag_index_test.exs`
  - Tag parsing (simple, composite, escaped pipes)
  - Index add/remove operations
  - Pattern matching with wildcards

- [ ] `test/electric/client/move_state_test.exs`
  - Add/remove tags for rows
  - Process move-out patterns
  - Clear row on delete
  - Reset on must-refetch

#### Integration Tests

- [ ] `test/electric/client/move_integration_test.exs`
  - Receive tags on change messages
  - Process move-out events → synthetic deletes
  - Buffer move-outs during initial sync
  - Handle tag changes on updates
  - Handle must-refetch with move state

---

### Phase 5: Documentation

- [ ] Add `@moduledoc` to new modules
- [ ] Document tag format and pattern matching
- [ ] Add examples to README
- [ ] Document synthetic delete behavior

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `lib/electric/client/tag_index.ex` | **Create** | Positional tag index |
| `lib/electric/client/move_state.ex` | **Create** | Row tag state tracking |
| `lib/electric/client/message.ex` | Modify | Add EventMessage, update Headers |
| `lib/electric/client/stream.ex` | Modify | Process tags and move-outs |
| `test/electric/client/tag_index_test.exs` | **Create** | TagIndex unit tests |
| `test/electric/client/move_state_test.exs` | **Create** | MoveState unit tests |
| `test/electric/client/move_integration_test.exs` | **Create** | Integration tests |

---

## Acceptance Criteria

- [ ] Tags are parsed from change message headers
- [ ] Tags are tracked per row in `MoveState`
- [ ] Move-out events trigger removal of matching tags
- [ ] Rows with empty tag sets generate synthetic delete messages
- [ ] Move-out events are buffered during initial sync
- [ ] State is cleared on `must-refetch`
- [ ] Existing functionality (shapes without subqueries) is unchanged
- [ ] All tests pass

---

## Design Decisions

### Synthetic Deletes

Move-outs generate `%ChangeMessage{operation: :delete}` so consumers don't need special handling. The delete appears in the stream like any other delete.

### Buffering Strategy

Move-out events during initial sync are buffered and processed when `up-to-date` is received. This prevents deleting rows before they're inserted.

### Backward Compatibility

Tags are optional. Shapes without subqueries work exactly as before - the `move_state` is simply unused.

### Memory Considerations

Each tagged row adds entries to `row_tags` map and `tag_index`. For large datasets with many tags, memory usage scales linearly.

---

## References

- Server implementation: https://github.com/electric-sql/electric/pull/3427
- TypeScript client: https://github.com/TanStack/db/pull/942
- Key server files:
  - `sync-service/lib/electric/shapes/shape/subquery_moves.ex`
  - `sync-service/lib/electric/shapes/consumer/move_handling.ex`
  - `sync-service/lib/electric/shapes/consumer/move_ins.ex`

---

## Labels

`enhancement`, `elixir-client`, `subqueries`
