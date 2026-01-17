# Replication Pipeline Implementation

This document provides a deep implementation dive into the replication pipeline in Electric's sync-service.

## Overview

The replication pipeline transforms PostgreSQL WAL (Write-Ahead Log) messages into shape-specific change streams. The pipeline has five major stages:

1. **WAL Message Decoding** - Binary protocol parsing
2. **Message Conversion** - WAL messages → TransactionFragments
3. **Shape Log Collection** - Routing and indexing
4. **Event Distribution** - Per-shape filtering and routing
5. **Consumer Processing** - Transaction assembly and storage

## 1. WAL Message Decoding

**File**: `lib/electric/postgres/logical_replication/decoder.ex`

### Binary Protocol Parsing

The decoder parses PostgreSQL's `pgoutput` logical replication protocol. Each message starts with a type indicator:

| Type | Code | Description        |
| ---- | ---- | ------------------ |
| B    | 66   | Begin transaction  |
| C    | 67   | Commit transaction |
| R    | 82   | Relation metadata  |
| I    | 73   | Insert             |
| U    | 85   | Update             |
| D    | 68   | Delete             |
| T    | 84   | Truncate           |

### Begin Message

```elixir
defp decode_message_impl(<<"B", lsn::binary-8, timestamp::integer-64, xid::integer-32>>) do
  %Begin{
    final_lsn: decode_lsn(lsn),
    commit_timestamp: pgtimestamp_to_timestamp(timestamp),
    xid: xid
  }
end
```

**Binary layout:**

- Byte 0: `B` (message type)
- Bytes 1-8: LSN (Log Sequence Number) as 64-bit binary
- Bytes 9-16: Timestamp (microseconds since PostgreSQL epoch: 2000-01-01)
- Bytes 17-20: Transaction ID (32-bit unsigned integer)

### Tuple Data Decoding

Each column value is prefixed with a type indicator:

```elixir
# NULL value
defp decode_tuple_data(<<"n", rest::binary>>, cols, acc, size),
  do: decode_tuple_data(rest, cols - 1, [nil | acc], size)

# UNCHANGED TOAST (large value unchanged)
defp decode_tuple_data(<<"u", rest::binary>>, cols, acc, size),
  do: decode_tuple_data(rest, cols - 1, [:unchanged_toast | acc], size)

# Text/binary value
defp decode_tuple_data(<<"t", length::integer-32, rest::binary>>, cols, acc, size),
  do: decode_tuple_data(
    binary_part(rest, {byte_size(rest), -(byte_size(rest) - length)}),
    cols - 1,
    [binary_part(rest, {0, length}) | acc],
    size + length
  )
```

**Value encoding:**

- `n` - NULL
- `u` - Unchanged TOAST value
- `t` + 4-byte length + data - Text/binary value

## 2. Message Conversion

**File**: `lib/electric/postgres/replication_client/message_converter.ex`

### Internal State Structure

```elixir
defstruct relations: %{},              # Map: relation_id => Relation
          tx_op_index: nil,            # Current operation index
          tx_change_count: 0,          # Total changes in transaction
          tx_size: 0,                  # Accumulated byte size
          max_tx_size: nil,            # Optional size limit
          max_batch_size: nil,         # When to flush a fragment
          last_log_offset: nil,        # Last offset seen
          txn_fragment: nil,           # Current TransactionFragment
          current_xid: nil             # Current transaction ID
```

### Transaction Batching Algorithm

The converter batches operations into `TransactionFragment` structs based on `max_batch_size` (default: 100 operations).

```elixir
def convert(%LR.Insert{} = msg, %__MODULE__{} = state) do
  relation = Map.fetch!(state.relations, msg.relation_id)
  data = data_tuple_to_map(relation.columns, msg.tuple_data)

  change = %NewRecord{
    relation: {relation.namespace, relation.name},
    record: data,
    log_offset: current_offset(state)
  }

  state
  |> change_received(msg.bytes)
  |> add_change(change)
  |> add_affected_relation({relation.namespace, relation.name})
  |> maybe_flush()  # Check if max_batch_size reached
end
```

### Log Offset Calculation

```elixir
defp current_offset(state) do
  LogOffset.new(state.txn_fragment.lsn, state.tx_op_index)
end

defp change_received(%__MODULE__{} = state, bytes) do
  %{state |
    tx_size: state.tx_size + bytes,
    tx_change_count: state.tx_change_count + 1,
    last_log_offset: current_offset(state),
    # Add 2 for headroom when splitting UpdatedRecord
    tx_op_index: state.tx_op_index + 2
  }
end
```

## 3. ShapeLogCollector Implementation

**File**: `lib/electric/replication/shape_log_collector.ex`

### State Structure

```elixir
%{
  stack_id: "my-stack",
  subscriptions: 0,                           # Active shape count
  tracked_relations: AffectedColumns.t(),     # Column tracking
  partitions: Partitions.t(),                 # Partition table expansion
  dependency_layers: DependencyLayers.t(),    # Dependency ordering
  pids_by_shape_handle: %{},
  event_router: EventRouter.t(),              # Shape filtering
  flush_tracker: FlushTracker.t(),            # Flush coordination
  lsn_tracker_ref: ref(),
  registry_state: ConsumerRegistry.t(),       # Consumer registry
  last_processed_offset: LogOffset.t()        # Resume point
}
```

### Transaction Fragment Processing

```elixir
defp handle_txn_fragment(state, txn_fragment) do
  case fill_keys(txn_fragment, state) do
    {:ok, txn_fragment} ->
      # Expand partition changes to include root tables
      {partitions, txn_fragment} =
        Partitions.handle_txn_fragment(state.partitions, txn_fragment)

      state
      |> Map.put(:partitions, partitions)
      |> put_last_processed_offset(txn_fragment)
      |> publish(txn_fragment)  # Route to shapes

      {:ok, state}

    {:error, :connection_not_available} ->
      {{:error, :connection_not_available}, state}
  end
end
```

### Event Publishing with Dependency Layers

```elixir
defp publish(state, event) do
  # Filter event to per-shape fragments
  {events_by_handle, event_router} =
    EventRouter.event_by_shape_handle(state.event_router, event)

  affected_shapes = Map.keys(events_by_handle) |> MapSet.new()

  # Process shapes in dependency order (layers)
  for layer <- DependencyLayers.get_for_handles(state.dependency_layers, affected_shapes) do
    layer_events = Map.new(layer, fn handle ->
      {handle, {:handle_event, Map.fetch!(events_by_handle, handle), context}}
    end)
    ConsumerRegistry.publish(layer_events, state.registry_state)
  end

  LsnTracker.set_last_processed_lsn(state.lsn_tracker_ref, lsn)
  %{state | flush_tracker: FlushTracker.handle_txn_fragment(...)}
end
```

## 4. EventRouter Implementation

**File**: `lib/electric/shapes/event_router.ex`

### State Structure

```elixir
defstruct filter: nil,                     # Filter for shape matching
          current_xid: nil,                # Current transaction ID
          shapes_seen_begin: MapSet.new(), # Shapes that got BEGIN
          shapes_in_txn: MapSet.new(),     # Shapes with changes
          shapes_added_mid_txn: MapSet.new(), # Skip until next txn
          in_txn: false
```

### Transaction Fragment Routing

```elixir
def event_by_shape_handle(%EventRouter{} = router, %TransactionFragment{} = txn_fragment) do
  router = maybe_start_transaction(router, txn_fragment)
  {shape_changes, router} = route_changes_to_shapes(router, changes)
  {shape_changes, router} = maybe_end_transaction(shape_changes, router, commit)
  result = build_shape_framents(shape_changes, txn_fragment)
  {result, router}
end
```

### Building Per-Shape Fragments

```elixir
defp build_shape_framents(shape_events, txn_fragment) do
  Map.new(shape_events, fn {shape_id, attrs} ->
    fragment = %TransactionFragment{
      xid: xid,
      lsn: lsn,
      last_log_offset: last_log_offset,
      has_begin?: attrs.has_begin?,
      commit: attrs.commit,
      changes: Enum.reverse(attrs.changes),
      affected_relations: attrs.affected_relations,
      change_count: attrs.change_count
    }
    {shape_id, fragment}
  end)
end
```

## 5. Consumer Processing

**File**: `lib/electric/shapes/consumer.ex`

### Transaction Building

```elixir
defp handle_event(%TransactionFragment{} = txn_fragment, state) do
  {txns, transaction_builder} =
    TransactionBuilder.build(txn_fragment, state.transaction_builder)

  state = %{state | transaction_builder: transaction_builder}
  handle_txns(txns, state)
end
```

### TransactionBuilder Implementation

**File**: `lib/electric/replication/transaction_builder.ex`

```elixir
defstruct transaction: nil  # Accumulates changes until commit

def build(%TransactionFragment{} = fragment, state) do
  state
  |> maybe_start_transaction(fragment)
  |> add_changes(fragment)
  |> maybe_complete_transaction(fragment)
end

defp add_changes(%{transaction: txn} = state, fragment) do
  txn = %{txn |
    changes: Enum.reverse(fragment.changes) ++ txn.changes,
    num_changes: txn.num_changes + fragment.change_count
  }
  %{state | transaction: txn}
end
```

### Preparing Log Entries

```elixir
defp prepare_log_entries(changes, xid, shape) do
  changes
  |> Stream.flat_map(&LogItems.from_change(&1, xid, Shape.pk(shape, &1.relation), shape.replica))
  |> Enum.map_reduce(0, fn {offset, log_item}, total_size ->
    json_line = Jason.encode!(log_item)
    line_tuple = {offset, key, operation, json_line}
    {line_tuple, total_size + byte_size(json_line)}
  end)
end
```

## 6. Change Structures

**File**: `lib/electric/replication/changes.ex`

### NewRecord

```elixir
defmodule NewRecord do
  defstruct [:relation, :record, :log_offset, :key, last?: false, move_tags: []]

  @type t() :: %__MODULE__{
    relation: Changes.relation_name(),
    record: Changes.record(),
    log_offset: LogOffset.t(),
    key: String.t() | nil,
    last?: boolean(),
    move_tags: [Changes.tag()]
  }
end
```

### Key Building Algorithm

```elixir
def build_key(rel, record, pk_cols) when is_list(pk_cols) do
  IO.iodata_to_binary([prefix_from_rel(rel), join_escape_pk(record, pk_cols)])
end

defp prefix_from_rel({schema, table}),
  do: [?", escape_rel_component(schema), ?", ?., ?", escape_rel_component(table), ?"]

defp escape_pk_section(v) when is_binary(v),
  do: [?/, ?", :binary.replace(v, "/", "//", [:global]), ?"]
```

**Example:**

- Table: `{"public", "users"}`
- PK columns: `["id", "tenant_id"]`
- Record: `%{"id" => "user/123", "tenant_id" => "org/456"}`
- Key: `"public"."users"/"user//123"/"org//456"`

## 7. FlushTracker Implementation

**File**: `lib/electric/replication/shape_log_collector/flush_tracker.ex`

### State Structure

```elixir
defstruct [
  :last_global_flushed_offset,      # Offset flushed by all shapes
  :last_seen_offset,                 # Latest offset received
  :last_flushed,                     # Map: shape_id => {last_sent, last_flushed}
  :min_incomplete_flush_tree,        # gb_tree for fast minimum lookup
  :notify_fn                         # Callback to ReplicationClient
]
```

### Global Flush Tracking

```elixir
def handle_flush_notification(state, shape_id, last_flushed_offset) do
  case Map.fetch!(last_flushed, shape_id) do
    {^last_flushed_offset, prev_flushed_offset} ->
      # Shape caught up, remove from tracking
      {Map.delete(last_flushed, shape_id),
       delete_from_tree(min_incomplete_flush_tree, prev_flushed_offset, shape_id)}

    {last_sent, prev_flushed_offset} ->
      # Update flush offset in tree
      {Map.put(last_flushed, shape_id, {last_sent, last_flushed_offset}),
       min_incomplete_flush_tree
       |> delete_from_tree(prev_flushed_offset, shape_id)
       |> add_to_tree(last_flushed_offset, shape_id)}
  end
  |> update_global_offset()
end
```

## 8. Data Flow Summary

```
PostgreSQL WAL
    │
    ▼
ReplicationClient.handle_data/2
    │ (binary data)
    ▼
Decoder.decode/1
    │ (Insert/Update/Delete structs)
    ▼
MessageConverter.convert/2
    │ (TransactionFragment)
    ▼
ShapeLogCollector.handle_event/3
    │ (routing to shapes)
    ▼
Consumer (per shape)
    │ (filtering, storage)
    ▼
HTTP Clients
```

## 9. Essential Files

| File                                                            | Purpose                          |
| --------------------------------------------------------------- | -------------------------------- |
| `lib/electric/postgres/logical_replication/decoder.ex`          | Binary protocol parsing          |
| `lib/electric/postgres/logical_replication/messages.ex`         | Message structures               |
| `lib/electric/postgres/replication_client/message_converter.ex` | WAL → TransactionFragment        |
| `lib/electric/replication/shape_log_collector.ex`               | Main event hub                   |
| `lib/electric/shapes/event_router.ex`                           | Per-shape transaction splitting  |
| `lib/electric/shapes/filter.ex`                                 | Shape matching                   |
| `lib/electric/shapes/consumer.ex`                               | Transaction assembly and storage |
| `lib/electric/replication/transaction_builder.ex`               | Fragment → Transaction           |
| `lib/electric/shapes/consumer/change_handling.ex`               | Change filtering                 |
| `lib/electric/replication/changes.ex`                           | All change types                 |
| `lib/electric/replication/log_offset.ex`                        | Offset tracking                  |
| `lib/electric/replication/shape_log_collector/flush_tracker.ex` | Flush coordination               |
| `lib/electric/shapes/consumer_registry.ex`                      | Consumer message passing         |
