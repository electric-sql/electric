# Database & Replication

This document covers PostgreSQL integration, logical replication, and storage patterns.

## PostgreSQL Requirements

- **Version**: PostgreSQL 14+ (recommended: 15+)
- **Replication**: Logical replication enabled (`wal_level = logical`)
- **Permissions**: User needs `REPLICATION` privilege and table access

## Logical Replication Overview

The sync-service uses PostgreSQL's logical replication with the `pgoutput` plugin to stream changes.

### Replication Setup Flow

```
1. Connect to PostgreSQL in replication mode
2. Acquire advisory lock (prevents multiple Electric instances)
3. Create publication (if not exists)
4. Create replication slot (if not exists)
5. Start streaming from last confirmed LSN
```

### Replication Client (`replication_client.ex`)

The `ReplicationClient` module manages the replication connection:

```elixir
# Connection setup phases
1. identify_system      # Get system info and current WAL position
2. query_pg_info        # Get PostgreSQL version
3. acquire_lock         # Advisory lock on slot name
4. create_publication   # Create publication for tables
5. create_slot          # Create logical replication slot
6. query_slot_flushed   # Get last confirmed position
7. start_streaming      # Begin WAL streaming
```

### WAL Message Types

| Type     | Code | Description                                |
| -------- | ---- | ------------------------------------------ |
| Begin    | B    | Transaction start with LSN, timestamp, XID |
| Commit   | C    | Transaction end                            |
| Relation | R    | Table schema information                   |
| Insert   | I    | New row                                    |
| Update   | U    | Modified row (with optional old values)    |
| Delete   | D    | Removed row                                |
| Truncate | T    | Table truncation                           |

### Message Processing Pipeline

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
```

## Log Offset System

LogOffset provides total ordering of all operations.

### Structure

```elixir
%LogOffset{
  tx_offset: integer(),  # Transaction LSN (0 for snapshots)
  op_offset: integer()   # Operation index within transaction
}
```

### Special Values

| Name                         | Value            | Usage                  |
| ---------------------------- | ---------------- | ---------------------- |
| `before_all()`               | `{-1, 0}`        | Initial client request |
| `first()`                    | `{0, 0}`         | First snapshot chunk   |
| `last_before_real_offsets()` | `{0, :infinity}` | End of snapshot        |
| Real offset                  | `{LSN, N}`       | Transaction data       |

### Offset Comparisons

```elixir
# Offsets are compared lexicographically
{100, 1} < {100, 2}  # Same transaction, later operation
{100, 2} < {200, 1}  # Later transaction
{0, 5} < {100, 1}    # Virtual (snapshot) < Real (transaction)
```

## Shape Log Collector

Central transaction router that dispatches changes to relevant shapes.

### Key Data Structures

```elixir
%State{
  partitions: Partitions.t(),           # Table -> shapes index
  event_router: EventRouter.t(),        # WHERE clause matching
  dependency_layers: DependencyLayers.t(), # Shape dependencies
  flush_tracker: FlushTracker.t(),      # Backpressure tracking
  registry_state: ConsumerRegistry.t()  # Message passing
}
```

### Transaction Routing

```elixir
def handle_txn_fragment(state, txn_fragment) do
  # 1. Fill primary keys for all changes
  {:ok, txn_fragment} = fill_keys(txn_fragment, state)

  # 2. Filter to affected shapes (by table OID)
  {partitions, txn_fragment} =
    Partitions.handle_txn_fragment(state.partitions, txn_fragment)

  # 3. Apply WHERE clause filtering
  {events_by_handle, event_router} =
    EventRouter.event_by_shape_handle(state.event_router, txn_fragment)

  # 4. Publish in dependency order
  for layer <- DependencyLayers.get_for_handles(...) do
    ConsumerRegistry.publish(layer_events, state.registry_state)
  end
end
```

### Flush Tracking

The collector tracks which shapes have persisted which offsets:

```elixir
# Consumer notifies after writing to storage
ShapeLogCollector.notify_flushed(stack_id, shape_handle, offset)

# Collector computes minimum across all shapes
min_flushed = FlushTracker.get_min_flushed(state.flush_tracker)

# Notifies ReplicationClient to advance slot
send(replication_client, {:flush_boundary_updated, min_flushed})
```

## Shape Consumer

Per-shape GenServer that processes transactions.

### Lifecycle States

```
┌─────────────────┐
│  Initializing   │
│  - Create writer│
│  - Subscribe    │
│  - Start snap   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Buffering     │
│  - Await xmin   │
│  - Buffer txns  │
└────────┬────────┘
         │ Snapshot metadata received
         ▼
┌─────────────────┐
│   Streaming     │
│  - Process txns │
│  - Write log    │
│  - Notify       │
└────────┬────────┘
         │ Termination trigger
         ▼
┌─────────────────┐
│  Terminating    │
│  - Cleanup      │
│  - Notify       │
└─────────────────┘
```

### Change Processing

```elixir
def handle_txn(txn, state) do
  # Filter by snapshot boundaries
  txn = InitialSnapshot.filter(state.initial_snapshot_state, storage, txn)

  # Apply WHERE clause, handle move-in/move-out
  changes = ChangeHandling.process_changes(changes, state, context)

  # Prepare log entries
  {lines, total_size} = prepare_log_entries(changes, xid, shape)

  # Write to storage
  writer = ShapeCache.Storage.append_to_log!(lines, writer)

  # Notify waiting clients
  notify_new_changes(state, changes, last_log_offset)

  # Report flush progress
  ShapeLogCollector.notify_flushed(stack_id, shape_handle, offset)
end
```

## Storage Layer

### Storage Behaviour

```elixir
@callback make_new_snapshot!(stream, shape_opts) :: :ok
@callback append_to_log!(log_items, writer_state) :: writer_state
@callback get_log_stream(min_offset, max_offset, shape_opts) :: Stream.t()
@callback get_chunk_end_log_offset(offset, shape_opts) :: LogOffset.t()
@callback cleanup!(shape_opts) :: :ok
```

### PureFileStorage Implementation

#### File Formats

**Snapshot Files** (NDJSON):

```
shapes/{handle}/snapshot/chunk_0.jsonl
{"offset":"0_1","key":"\"public\".\"users\"/\"1\"","value":{"id":1,"name":"Alice"}}
{"offset":"0_2","key":"\"public\".\"users\"/\"2\"","value":{"id":2,"name":"Bob"}}
<EOT byte indicates chunk complete>
```

**Log Files** (Binary):

```
shapes/{handle}/log/log.latest.0.jsonfile.bin

Per entry:
<<tx_offset::64, op_offset::64,
  key_size::32, key::binary,
  op_type::8, flag::8,
  json_size::64, json::binary>>
```

**Chunk Index** (Binary):

```
shapes/{handle}/log/log.latest.0.chunk.bin

Per chunk:
<<min_tx::64, min_op::64, start_pos::64, key_start::64,
  max_tx::64, max_op::64, end_pos::64, key_end::64>>
```

#### Two-Layer Write System

```
┌─────────────────────────────────────────────────────────────────┐
│                     Write Path                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Consumer calls append_to_log!(items, writer)                 │
│                                                                  │
│  2. Items added to ETS buffer                                    │
│     - Allows immediate reads of uncommitted data                 │
│     - Up to 64KB or 1 second buffer window                       │
│                                                                  │
│  3. On flush trigger:                                            │
│     a. Write buffer to log file (append)                         │
│     b. Update chunk index if boundary reached                    │
│     c. Atomically write last_persisted_txn_offset.bin            │
│     d. Clear ETS buffer                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Read Path

```elixir
def stream_main_log(min_offset, max_offset, opts) do
  last_persisted = read_metadata(:last_persisted_offset)

  cond do
    # All in ETS (uncommitted)
    min_offset > last_persisted ->
      read_from_ets(ets, min_offset, max_offset)

    # All on disk (committed)
    max_offset <= last_persisted ->
      stream_from_disk(min_offset, max_offset)

    # Straddling boundary
    true ->
      Stream.concat(
        stream_from_disk(min_offset, last_persisted),
        read_from_ets(ets, last_persisted, max_offset)
      )
  end
end
```

### Compaction

Reduces file count by merging old data:

```
Before:
  log.latest.0.jsonfile.bin (current writes)
  log.compacted.100.jsonfile.bin (previous compaction)

Compaction Process:
1. Identify boundary (keep last N chunks)
2. Build key index from both files
3. Merge with deduplication (keep latest per key)
4. Write new compacted file
5. Trim current file
6. Delete old files

After:
  log.latest.0.jsonfile.bin (trimmed)
  log.compacted.200.jsonfile.bin (merged)
```

## Recovery Mechanisms

### Crash Recovery Flow

```elixir
def initialise_filesystem!(opts, shape_definition) do
  # 1. Version check
  if incompatible_version? or incomplete_snapshot? do
    cleanup!(opts)  # Start fresh
    return
  end

  # 2. Load last known state
  last_offset = read_metadata(:last_persisted_txn_offset)

  # 3. Trim log to last atomic write
  trim_log!(opts, last_offset)

  # 4. Realign chunk index
  ChunkIndex.realign_and_trim(chunk_file, last_offset)

  # 5. Resume
  WriteLoop.init_from_disk(last_persisted_txn_offset: last_offset, ...)
end
```

### LSN Recovery

```
1. ReplicationClient connects
2. Queries slot for confirmed_flush_lsn
3. LsnTracker initializes from this value
4. Streaming resumes from confirmed position
5. Duplicate transactions filtered by Consumer
```

## Schema Changes

### Detection

The `SchemaReconciler` periodically validates schemas:

```elixir
# Check for changes
case Inspector.load_column_info(table) do
  {:ok, new_columns} ->
    if columns_changed?(old_columns, new_columns) do
      invalidate_affected_shapes(table)
    end
end
```

### Handling

When schema changes:

1. Affected shapes receive `:schema_changed` event
2. Consumer marks shape for rotation
3. New requests get 409 with new handle
4. Old shape data cleaned up

## Performance Considerations

### Partitioned State

```elixir
# ProcessRegistry uses partitions for scalability
Registry.start_link(
  name: ProcessRegistry,
  partitions: System.schedulers_online()
)
```

### Backpressure

- FlushTracker prevents unbounded memory growth
- ReplicationClient waits if shapes fall behind
- Admission control limits concurrent requests

### Chunk Sizing

- Chunks sized for CDN caching (~1MB default)
- Chunk index enables O(log n) lookups
- Parallel reads possible across chunks
