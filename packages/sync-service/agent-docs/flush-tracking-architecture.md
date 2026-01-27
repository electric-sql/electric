# Flush Tracking Architecture

This document explains how Electric's sync service tracks write progress across multiple shapes and coordinates acknowledgments back to Postgres. Understanding this architecture is essential for anyone working on storage, replication, or considering changes to the transaction processing pipeline.

## Table of Contents

1. [Overview](#overview)
2. [LogOffset: The Fundamental Unit](#logoffset-the-fundamental-unit)
3. [WriteLoop: Per-Shape Write Management](#writeloop-per-shape-write-management)
4. [FlushTracker: Global Coordination](#flushtracker-global-coordination)
5. [Consumer: Transaction Processing](#consumer-transaction-processing)
6. [End-to-End Flow](#end-to-end-flow)
7. [Design Considerations for Future Changes](#design-considerations-for-future-changes)

---

## Overview

Electric replicates data from Postgres to multiple "shapes" (filtered subsets of tables). Each shape has its own storage and flush cadence, but Postgres needs a single acknowledgment of how far data has been durably persisted.

The key challenge: **Different shapes flush at different rates, and not all shapes see every transaction.** We need to compute a safe minimum offset to acknowledge to Postgres.

### Key Components

| Component            | Scope               | Responsibility                                               |
| -------------------- | ------------------- | ------------------------------------------------------------ |
| `WriteLoop`          | Per-shape           | Buffers writes, flushes to disk, tracks persistence progress |
| `FlushTracker`       | Global (all shapes) | Coordinates flush progress across shapes, notifies Postgres  |
| `Consumer`           | Per-shape           | Processes transactions, maintains offset mappings            |
| `TransactionBuilder` | Per-shape           | Accumulates fragments into complete transactions             |

---

## LogOffset: The Fundamental Unit

A `LogOffset` represents a position in the replication stream:

```elixir
%LogOffset{
  tx_offset: 123456789,  # Transaction LSN from Postgres
  op_offset: 3           # Operation index within the transaction
}
```

### Special Values

| Value            | Meaning                                               |
| ---------------- | ----------------------------------------------------- |
| `{-1, 0}`        | Before any real offset (`before_all()`)               |
| `{0, 0}`         | First possible offset (`first()`)                     |
| `{0, :infinity}` | End of snapshot region (`last_before_real_offsets()`) |

### Important Property

**Shapes preserve original offsets.** When a shape filters changes from a transaction, it does NOT renumber them. Each change retains its original `log_offset` from the Postgres transaction.

The only exception is **update splitting**: when an `UpdatedRecord` has a changed primary key, it becomes two log items (delete + insert), and the insert gets `offset + 1`:

```elixir
# Original change at offset {100, 5} with changed PK
# Becomes:
#   - Delete at {100, 5}
#   - Insert at {100, 6}
```

---

## WriteLoop: Per-Shape Write Management

`WriteLoop` (`lib/electric/shape_cache/pure_file_storage/write_loop.ex`) manages buffered writes for a single shape's file storage.

### Key Fields

| Field                       | Purpose                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `last_seen_offset`          | Most recent offset added to the in-memory buffer (may not be flushed yet) |
| `last_seen_txn_offset`      | Last complete transaction boundary seen (set when transaction ends)       |
| `last_persisted_offset`     | Last offset written to disk via `datasync`                                |
| `last_persisted_txn_offset` | Last complete transaction fully persisted - **the stable read boundary**  |

### The Write Pipeline

```
Transaction arrives
       │
       ▼
┌─────────────────┐
│ In-memory buffer│  ← last_seen_offset updated here
│ (up to 64KB)    │
└────────┬────────┘
         │ Buffer full OR timer fires OR chunk boundary
         ▼
┌─────────────────┐
│ Disk write +    │  ← last_persisted_offset updated here
│ datasync        │
└────────┬────────┘
         │ Transaction complete AND flushed
         ▼
┌─────────────────┐
│ Txn boundary    │  ← last_persisted_txn_offset updated here
│ advanced        │    (this is what readers use)
└─────────────────┘
```

### Flush Triggers

Flushes occur when:

1. **Buffer size threshold** (64KB) - `@delayed_write` constant
2. **Scheduled timer** fires (default 1 second)
3. **Chunk boundary** reached (default 10MB of JSON payload)

### Chunk Boundaries Are NOT Transaction-Aligned

A single large transaction can span multiple chunks:

```
Transaction with 15MB of changes:

Chunk 1 (10MB)          Chunk 2 (5MB)
┌──────────────────┐    ┌─────────────┐
│ Changes 1-1000   │    │ Changes     │
│ (mid-transaction)│    │ 1001-1500   │
│                  │    │ (txn ends)  │
└──────────────────┘    └─────────────┘
        │                      │
        ▼                      ▼
   Flush occurs           Flush occurs
   (not txn-aligned)      (txn-aligned)
```

### Reader Safety

Readers use `last_persisted_txn_offset` as their boundary, NOT `last_persisted_offset`. This ensures they never see incomplete transactions, even if a flush occurred mid-transaction.

---

## FlushTracker: Global Coordination

`FlushTracker` (`lib/electric/replication/shape_log_collector/flush_tracker.ex`) lives inside `ShapeLogCollector` and coordinates flush progress across ALL shapes.

### Key Fields

| Field                        | Purpose                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `last_global_flushed_offset` | Minimum offset durably flushed across ALL shapes - safe to acknowledge to Postgres |
| `last_seen_offset`           | Most recent transaction offset dispatched to shapes (the "high water mark")        |
| `last_flushed`               | Map of `shape_id => {last_sent, last_flushed}` tracking per-shape progress         |
| `min_incomplete_flush_tree`  | `gb_tree` for O(log n) minimum lookup across pending shapes                        |

### Per-Shape Tracking

The `last_flushed` map tracks each shape's progress:

```elixir
%{
  "shape-abc" => {last_sent: {100, 5}, last_flushed: {100, 3}},  # Behind
  "shape-xyz" => {last_sent: {100, 5}, last_flushed: {100, 5}}   # Caught up (will be removed)
}
```

- **`last_sent`**: Latest offset sent to this shape for writing
- **`last_flushed`**: Latest offset this shape confirmed as persisted

When `last_sent == last_flushed`, the shape is caught up and removed from the map.

### The Global Offset Calculation

```elixir
last_global_flushed_offset = max(
  previous_global_flushed,
  min(for {_, {_, last_flushed}} <- last_flushed_map, do: last_flushed)
)
```

The `min_incomplete_flush_tree` provides O(log n) access to this minimum without scanning all shapes.

### Transaction-Aligned Acknowledgments

When notifying Postgres:

```elixir
defp notify_global_offset_updated(state) do
  if state.last_flushed == %{} do
    # All shapes caught up - safe to report actual tx_offset
    state.notify_fn.(state.last_global_flushed_offset.tx_offset)
  else
    # Some shapes still pending - report tx_offset - 1 (conservative)
    state.notify_fn.(state.last_global_flushed_offset.tx_offset - 1)
  end
end
```

The `-1` safety margin ensures that if we've only partially flushed a transaction, we don't acknowledge it to Postgres.

### Handling Shapes That Don't See Every Transaction

When a new transaction arrives, shapes that weren't previously tracked are added with a safe upper bound:

```elixir
# For a transaction at offset {100, 5}:
# New shapes get {last_sent: {100, 5}, last_flushed: {99, ...}}
# This assumes they've flushed everything before this transaction
prev_log_offset = %LogOffset{tx_offset: last_log_offset.tx_offset - 1}
```

---

## Consumer: Transaction Processing

`Consumer` (`lib/electric/shapes/consumer.ex`) processes transactions for a single shape.

### Current Flow: Full Transaction Accumulation

Currently, transactions are fully accumulated in memory before writing:

```
TransactionFragment (no commit)
       │
       ▼
┌─────────────────────┐
│ TransactionBuilder  │  ← Accumulates in memory
│ (buffers fragments) │
└─────────────────────┘
       │
TransactionFragment (with commit)
       │
       ▼
┌─────────────────────┐
│ Complete Transaction│  ← Now ready to process
└─────────────────────┘
       │
       ▼
┌─────────────────────┐
│ append_to_log!      │  ← Write to storage
└─────────────────────┘
```

### The txn_offset_mapping

The Consumer maintains a mapping to align flush notifications with transaction boundaries:

```elixir
# After processing a transaction:
txn_offset_mapping ++ [{last_log_offset, txn.last_log_offset}]
```

- **First element**: The shape's last written offset for this transaction
- **Second element**: The original transaction boundary

This mapping handles the update-split edge case where the shape's last written offset might be `+1` from the original.

### Offset Alignment on Flush

When storage reports a flush:

```elixir
def handle_info({ShapeCache.Storage, :flushed, offset}, state) do
  {state, offset} = State.align_offset_to_txn_boundary(state, offset)
  ShapeLogCollector.notify_flushed(state.stack_id, state.shape_handle, offset)
end
```

The `align_offset_to_txn_boundary/2` function:

```elixir
def align_offset_to_txn_boundary(state, offset) do
  case Enum.drop_while(txn_offset_mapping, &(compare(elem(&1, 0), offset) == :lt)) do
    [{^offset, boundary} | rest] ->
      # Flushed offset matches a transaction end - return the boundary
      {%{state | txn_offset_mapping: rest}, boundary}

    rest ->
      # Flushed mid-transaction - return raw offset
      {%{state | txn_offset_mapping: rest}, offset}
  end
end
```

If the flush happened mid-transaction, the raw offset is returned, and FlushTracker's `-1` safety margin handles it.

---

## End-to-End Flow

```
PostgreSQL WAL
      │
      ▼
┌─────────────────────────────────────┐
│ ShapeLogCollector                   │
│ ├─ FlushTracker                     │
│ │   └─ Tracks: last_seen_offset     │
│ │              last_global_flushed  │
│ │              per-shape {sent,     │
│ │                         flushed}  │
│ └─ Dispatches txns to shapes        │
└──────────────┬──────────────────────┘
               │ TransactionFragment
               ▼
┌─────────────────────────────────────┐
│ Shape Consumer                      │
│ ├─ TransactionBuilder               │
│ │   └─ Accumulates fragments        │
│ ├─ Processes complete transactions  │
│ └─ Maintains txn_offset_mapping     │
└──────────────┬──────────────────────┘
               │ append_to_log!
               ▼
┌─────────────────────────────────────┐
│ WriteLoop (PureFileStorage)         │
│ ├─ Buffers writes (64KB threshold)  │
│ ├─ Flushes to disk                  │
│ └─ Tracks: last_seen_offset         │
│            last_persisted_offset    │
│            last_persisted_txn_offset│
└──────────────┬──────────────────────┘
               │ {Storage, :flushed, offset}
               ▼
┌─────────────────────────────────────┐
│ Consumer.handle_info                │
│ └─ align_offset_to_txn_boundary     │
└──────────────┬──────────────────────┘
               │ notify_flushed(shape, offset)
               ▼
┌─────────────────────────────────────┐
│ FlushTracker                        │
│ ├─ Updates shape's {sent, flushed}  │
│ ├─ Computes new global minimum      │
│ └─ Notifies Postgres (with -1 margin│
│    if not fully caught up)          │
└─────────────────────────────────────┘
```

---

## Design Considerations for Future Changes

### Writing Transaction Fragments Directly to Storage

If you want to persist fragments without accumulating complete transactions in memory:

1. **Client reads are safe**: Readers use `last_persisted_txn_offset`, so updating only `last_persisted_offset` for fragments won't expose incomplete transactions.

2. **Postgres acknowledgments are safe**: FlushTracker's `-1` margin handles mid-transaction notifications.

3. **Implementation approach**:
   - Update `last_persisted_offset` as each fragment is persisted
   - Call `notify_flushed` with the persisted offset (FlushTracker handles it)
   - Update `last_persisted_txn_offset` only when the Commit fragment is processed

4. **FlushTracker consideration**: Currently `handle_txn_fragment/3` only processes fragments with a Commit:
   ```elixir
   def handle_txn_fragment(state, %TransactionFragment{commit: nil}, _) do
     state  # No-op
   end
   ```
   If you need FlushTracker to track in-flight fragments differently, this would need modification.

### Key Invariants to Preserve

1. **`last_persisted_txn_offset` must only advance on complete, persisted transactions** - this is the reader safety boundary.

2. **FlushTracker notifications should be transaction-aligned when possible** - use the `-1` margin for mid-transaction flushes.

3. **Offsets are preserved from the original transaction** - don't renumber them. The only adjustment is `+1` for key-changing updates that split into delete+insert.

4. **The `min_incomplete_flush_tree` must stay consistent with `last_flushed` map** - always update both together.
