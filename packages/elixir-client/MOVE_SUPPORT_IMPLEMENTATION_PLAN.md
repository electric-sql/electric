# Implementation Plan: Move-In/Out Support for Elixir Client

## Overview

This plan outlines the changes needed to add subquery move-in/move-out support to the Electric Elixir client. The implementation enables the client to properly handle tagged rows and move-out events for shapes with subqueries in their WHERE clauses.

## Background

When a shape has a subquery (e.g., `WHERE parent_id IN (SELECT id FROM parent WHERE active = true)`), the server sends:
- **Tags** on change messages explaining why a row is in the shape
- **Move-out events** when rows should be removed because their "reason" for inclusion is gone
- **Snapshot-end** control messages for visibility boundaries during move-ins

The client must:
1. Track tags for each row
2. Maintain an index for efficient pattern matching
3. Remove rows when their tag set becomes empty

---

## Implementation Phases

### Phase 1: New Data Structures

#### 1.1 Create `Electric.Client.TagIndex` Module

**File**: `lib/electric/client/tag_index.ex`

```elixir
defmodule Electric.Client.TagIndex do
  @moduledoc """
  Positional index for efficient move-out pattern matching.

  Tags are pipe-delimited strings (e.g., "abc123|def456").
  The index maps each position -> value -> set of row keys.
  """

  @type row_key :: String.t()
  @type move_tag :: String.t()
  @type parsed_tag :: [String.t()]
  @type position :: non_neg_integer()
  @type value :: String.t()
  @type move_out_pattern :: %{pos: position(), value: value()}

  # Array indexed by position, each element is a map of value => MapSet of row keys
  @type t :: %__MODULE__{
    index: [%{value() => MapSet.t(row_key())}],
    tag_length: non_neg_integer() | nil
  }

  defstruct index: [], tag_length: nil

  @tag_wildcard "_"

  @doc "Create a new empty tag index"
  @spec new() :: t()

  @doc "Parse a tag string into its components"
  @spec parse_tag(move_tag()) :: parsed_tag()

  @doc "Add a tag to the index for a given row"
  @spec add_tag(t(), row_key(), move_tag()) :: t()

  @doc "Remove a tag from the index for a given row"
  @spec remove_tag(t(), row_key(), move_tag()) :: t()

  @doc "Find all rows matching a move-out pattern"
  @spec find_rows_matching_pattern(t(), move_out_pattern()) :: MapSet.t(row_key())

  @doc "Check if a parsed tag matches a pattern"
  @spec tag_matches_pattern?(parsed_tag(), move_out_pattern()) :: boolean()

  @doc "Clear all entries from the index"
  @spec clear(t()) :: t()
end
```

**Implementation details**:
- Parse tags by splitting on `|` (handling escaped `\|`)
- Index only non-wildcard values (`_` is the wildcard)
- Infer tag length from first tag seen
- Clean up empty sets when removing tags

#### 1.2 Create `Electric.Client.MoveState` Module

**File**: `lib/electric/client/move_state.ex`

```elixir
defmodule Electric.Client.MoveState do
  @moduledoc """
  Tracks tag state for rows in a shape with subqueries.
  """

  alias Electric.Client.TagIndex

  @type row_key :: String.t()
  @type move_tag :: String.t()

  @type t :: %__MODULE__{
    # Map of row_key => MapSet of tags for that row
    row_tags: %{row_key() => MapSet.t(move_tag())},
    # Positional index for pattern matching
    tag_index: TagIndex.t(),
    # Cache of parsed tags (avoid re-parsing)
    tag_cache: %{move_tag() => TagIndex.parsed_tag()},
    # Whether this shape has subqueries (tags are expected)
    has_tags?: boolean()
  }

  defstruct row_tags: %{},
            tag_index: %TagIndex{},
            tag_cache: %{},
            has_tags?: false

  @doc "Create new empty move state"
  @spec new() :: t()

  @doc "Add tags to a row"
  @spec add_tags_to_row(t(), row_key(), [move_tag()]) :: t()

  @doc "Remove specific tags from a row"
  @spec remove_tags_from_row(t(), row_key(), [move_tag()]) :: t()

  @doc "Clear all tags for a row (on delete)"
  @spec clear_row(t(), row_key()) :: t()

  @doc "Process a move-out pattern, returns {rows_to_delete, updated_state}"
  @spec process_move_out_pattern(t(), TagIndex.move_out_pattern()) ::
    {[row_key()], t()}

  @doc "Check if a row has any remaining tags"
  @spec row_has_tags?(t(), row_key()) :: boolean()

  @doc "Reset all state (on must-refetch)"
  @spec reset(t()) :: t()
end
```

---

### Phase 2: Update Message Types

#### 2.1 Update `Headers` Struct

**File**: `lib/electric/client/message.ex`

Add `tags` and `removed_tags` fields to the `Headers` struct:

```elixir
defmodule Headers do
  defstruct [
    :operation,
    :relation,
    :handle,
    :lsn,
    txids: [],
    op_position: 0,
    tags: [],           # NEW: List of move tags
    removed_tags: []    # NEW: Tags being removed (updates only)
  ]

  @type t :: %__MODULE__{
    # ... existing fields ...
    tags: [String.t()],
    removed_tags: [String.t()]
  }

  def from_message(msg, handle) do
    %{"operation" => operation} = msg

    %__MODULE__{
      # ... existing fields ...
      tags: Map.get(msg, "tags", []),
      removed_tags: Map.get(msg, "removed_tags", [])
    }
  end
end
```

#### 2.2 Add `EventMessage` Struct

**File**: `lib/electric/client/message.ex`

```elixir
defmodule EventMessage do
  @moduledoc """
  Represents an event message from the server, such as move-out events.
  """

  defstruct [:event, :patterns, :handle, :request_timestamp]

  @type move_out_pattern :: %{pos: non_neg_integer(), value: String.t()}
  @type t :: %__MODULE__{
    event: :move_out,
    patterns: [move_out_pattern()],
    handle: Client.shape_handle(),
    request_timestamp: DateTime.t()
  }

  def from_message(%{"headers" => %{"event" => "move-out", "patterns" => patterns}}, handle) do
    %__MODULE__{
      event: :move_out,
      patterns: Enum.map(patterns, &parse_pattern/1),
      handle: handle
    }
  end

  defp parse_pattern(%{"pos" => pos, "value" => value}) do
    %{pos: pos, value: value}
  end
end
```

#### 2.3 Update `ControlMessage` for Snapshot-End

**File**: `lib/electric/client/message.ex`

Add snapshot visibility fields:

```elixir
defmodule ControlMessage do
  defstruct [
    :control,
    :global_last_seen_lsn,
    :handle,
    :request_timestamp,
    # NEW: Snapshot visibility (for snapshot-end)
    :xmin,
    :xmax,
    :xip_list
  ]

  @type t :: %__MODULE__{
    control: :must_refetch | :up_to_date | :snapshot_end,
    # ... existing fields ...
    xmin: pos_integer() | nil,
    xmax: pos_integer() | nil,
    xip_list: [pos_integer()] | nil
  }

  def from_message(%{"headers" => %{"control" => "snapshot-end"} = headers}, handle) do
    %__MODULE__{
      control: :snapshot_end,
      handle: handle,
      xmin: parse_int(headers["xmin"]),
      xmax: parse_int(headers["xmax"]),
      xip_list: parse_int_list(headers["xip_list"])
    }
  end

  defp parse_int(nil), do: nil
  defp parse_int(s) when is_binary(s), do: String.to_integer(s)

  defp parse_int_list(nil), do: nil
  defp parse_int_list(list), do: Enum.map(list, &parse_int/1)
end
```

#### 2.4 Update `Message.parse/3`

**File**: `lib/electric/client/message.ex`

Add parsing for event messages:

```elixir
def parse(%{"headers" => %{"event" => _}} = msg, shape_handle, _value_mapper_fun) do
  [EventMessage.from_message(msg, shape_handle)]
end
```

---

### Phase 3: Update Stream Processing

#### 3.1 Add Move State to Stream Struct

**File**: `lib/electric/client/stream.ex`

```elixir
defstruct [
  # ... existing fields ...
  :move_state,           # NEW: MoveState for tag tracking
  buffered_move_outs: [] # NEW: Move-outs buffered during initial sync
]
```

#### 3.2 Update `handle_msg/2` for Tagged Messages

**File**: `lib/electric/client/stream.ex`

```elixir
defp handle_msg(%Message.ChangeMessage{} = msg, stream) do
  stream = process_change_tags(msg, stream)
  {:cont, %{stream | buffer: :queue.in(msg, stream.buffer)}}
end

defp handle_msg(%Message.EventMessage{event: :move_out} = msg, stream) do
  if stream.up_to_date? do
    # Process immediately
    process_move_out(msg, stream)
  else
    # Buffer until initial sync completes
    {:cont, %{stream | buffered_move_outs: [msg | stream.buffered_move_outs]}}
  end
end

defp handle_msg(%Message.ControlMessage{control: :snapshot_end} = msg, stream) do
  # Store snapshot info for visibility filtering (optional advanced feature)
  {:cont, stream}
end

defp handle_msg(%Message.ControlMessage{control: :up_to_date} = msg, stream) do
  # Process any buffered move-outs before emitting up-to-date
  stream = process_buffered_move_outs(stream)
  handle_up_to_date(%{stream | buffer: :queue.in(msg, stream.buffer), up_to_date?: true})
end
```

#### 3.3 Implement Tag Processing Functions

**File**: `lib/electric/client/stream.ex`

```elixir
defp process_change_tags(%Message.ChangeMessage{} = msg, stream) do
  %{headers: headers, key: row_key} = msg
  %{tags: tags, removed_tags: removed_tags, operation: operation} = headers

  move_state = stream.move_state || MoveState.new()

  move_state = case operation do
    :delete ->
      MoveState.clear_row(move_state, row_key)

    _ when tags != [] or removed_tags != [] ->
      move_state
      |> MoveState.remove_tags_from_row(row_key, removed_tags)
      |> MoveState.add_tags_to_row(row_key, tags)

    _ ->
      move_state
  end

  %{stream | move_state: move_state}
end

defp process_move_out(%Message.EventMessage{patterns: patterns}, stream) do
  {rows_to_delete, move_state} =
    Enum.reduce(patterns, {[], stream.move_state}, fn pattern, {deletes, state} ->
      {new_deletes, state} = MoveState.process_move_out_pattern(state, pattern)
      {new_deletes ++ deletes, state}
    end)

  # Generate synthetic delete messages for removed rows
  delete_msgs = Enum.map(rows_to_delete, fn row_key ->
    %Message.ChangeMessage{
      key: row_key,
      value: %{},
      headers: Message.Headers.delete(handle: stream.shape_handle),
      request_timestamp: DateTime.utc_now()
    }
  end)

  stream = %{stream | move_state: move_state}
  buffer = Enum.reduce(delete_msgs, stream.buffer, &:queue.in/2)

  {:cont, %{stream | buffer: buffer}}
end

defp process_buffered_move_outs(stream) do
  Enum.reduce(Enum.reverse(stream.buffered_move_outs), stream, fn msg, stream ->
    {_, stream} = process_move_out(msg, stream)
    stream
  end)
  |> Map.put(:buffered_move_outs, [])
end
```

#### 3.4 Update Reset Logic

**File**: `lib/electric/client/stream.ex`

```elixir
defp reset(stream, shape_handle) do
  %{
    stream
    | offset: Client.Offset.before_all(),
      shape_handle: shape_handle,
      up_to_date?: false,
      buffer: :queue.new(),
      schema: nil,
      value_mapper_fun: nil,
      move_state: MoveState.new(),        # NEW: Reset move state
      buffered_move_outs: []              # NEW: Clear buffered move-outs
  }
end
```

---

### Phase 4: Tests

#### 4.1 Unit Tests for TagIndex

**File**: `test/electric/client/tag_index_test.exs`

```elixir
defmodule Electric.Client.TagIndexTest do
  use ExUnit.Case
  alias Electric.Client.TagIndex

  describe "parse_tag/1" do
    test "parses simple tags"
    test "parses composite tags with pipe delimiter"
    test "handles escaped pipe characters"
  end

  describe "add_tag/3" do
    test "adds single tag to index"
    test "infers tag length from first tag"
    test "rejects tags with wrong length"
    test "does not index wildcard values"
  end

  describe "find_rows_matching_pattern/2" do
    test "finds rows by position and value"
    test "returns empty set for no matches"
    test "handles multiple rows with same tag value"
  end

  describe "tag_matches_pattern?/2" do
    test "matches exact value at position"
    test "matches wildcard at position"
    test "does not match different value"
  end
end
```

#### 4.2 Unit Tests for MoveState

**File**: `test/electric/client/move_state_test.exs`

```elixir
defmodule Electric.Client.MoveStateTest do
  use ExUnit.Case
  alias Electric.Client.MoveState

  describe "add_tags_to_row/3" do
    test "adds tags to new row"
    test "adds tags to existing row"
    test "updates tag index"
  end

  describe "process_move_out_pattern/2" do
    test "removes matching tags from rows"
    test "returns rows to delete when tag set empty"
    test "does not delete rows with remaining tags"
    test "handles pattern matching multiple rows"
  end

  describe "clear_row/2" do
    test "removes all tags for row"
    test "cleans up tag index"
  end
end
```

#### 4.3 Integration Tests

**File**: `test/electric/client/move_integration_test.exs`

```elixir
defmodule Electric.Client.MoveIntegrationTest do
  use ExUnit.Case

  describe "shapes with subqueries" do
    test "receives tags on change messages"
    test "processes move-out events"
    test "generates delete for rows with empty tags"
    test "buffers move-outs during initial sync"
    test "handles tag changes on updates"
  end
end
```

---

### Phase 5: Documentation

#### 5.1 Update Module Docs

- Add `@moduledoc` to new modules explaining move-in/out concept
- Document the tag format and pattern matching algorithm
- Add examples of consuming move events

#### 5.2 Update README

Add section explaining subquery support:
- How to use shapes with subqueries
- What move-out events mean
- How synthetic deletes work

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `lib/electric/client/tag_index.ex` | Create | Positional tag index for pattern matching |
| `lib/electric/client/move_state.ex` | Create | Tag state tracking per row |
| `lib/electric/client/message.ex` | Modify | Add EventMessage, update Headers with tags |
| `lib/electric/client/stream.ex` | Modify | Process tags and move-outs |
| `test/electric/client/tag_index_test.exs` | Create | Unit tests for TagIndex |
| `test/electric/client/move_state_test.exs` | Create | Unit tests for MoveState |
| `test/electric/client/move_integration_test.exs` | Create | Integration tests |

---

## Implementation Order

1. **Phase 1**: Create `TagIndex` and `MoveState` modules (foundational data structures)
2. **Phase 2**: Update message types in `message.ex` (parse new message formats)
3. **Phase 3**: Update `stream.ex` to use new modules (connect everything)
4. **Phase 4**: Write tests (validate implementation)
5. **Phase 5**: Documentation (make it usable)

---

## Considerations

### Backward Compatibility

- Tags are optional - shapes without subqueries won't have them
- The `move_state` field defaults to a new empty state
- No breaking changes to existing API

### Performance

- Tag parsing is cached to avoid repeated string splitting
- Positional index provides O(1) lookup for pattern matching
- MapSet operations are efficient for tag set manipulation

### Memory

- Each row with tags adds entries to `row_tags` and `tag_index`
- Consider memory implications for large datasets with many tags
- `reset/2` clears all state on must-refetch

### Edge Cases

- Handle malformed tag strings gracefully
- Handle patterns for positions beyond tag length
- Handle move-out events before any tags are seen

---

## API Examples

### Consuming Move Events

```elixir
# The client handles moves transparently - synthetic deletes appear in stream
for msg <- Electric.Client.stream(client, shape) do
  case msg do
    %ChangeMessage{headers: %{operation: :insert}} = insert ->
      # Insert row (may have tags if shape has subquery)
      IO.inspect(insert.headers.tags, label: "tags")

    %ChangeMessage{headers: %{operation: :update}} = update ->
      # Update row (may have removed_tags)
      IO.inspect(update.headers.removed_tags, label: "removed")

    %ChangeMessage{headers: %{operation: :delete}} = delete ->
      # Delete row (either real delete or synthetic from move-out)
      remove_from_local_store(delete.key)

    %ControlMessage{control: :up_to_date} ->
      IO.puts("Caught up!")
  end
end
```

### Checking if Row Was Moved Out

```elixir
# If you need to distinguish real deletes from move-outs,
# check if the delete was synthetic (no tags on original insert)
defp handle_delete(msg, state) do
  if msg.headers.tags == [] and not Map.has_key?(state.tracked_rows, msg.key) do
    # This is likely a synthetic delete from move-out
    :moved_out
  else
    :deleted
  end
end
```
