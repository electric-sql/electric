# Fragment-Direct Transaction Handling in Electric

## Overview

Fragment-direct mode is an optimization for shapes that have no subquery dependencies. Instead of buffering entire transactions in memory before writing to storage, it writes each transaction fragment to storage immediately as it arrives, reducing memory usage.

## Key Files

| File                                                                             | Purpose                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/sync-service/lib/electric/shapes/consumer.ex`                          | Main consumer logic, handles fragment-direct processing |
| `packages/sync-service/lib/electric/shapes/consumer/state.ex`                    | Consumer state, including `fragment_direct?` flag       |
| `packages/sync-service/lib/electric/shapes/consumer/pending_txn.ex`              | Tracks in-flight transaction metadata                   |
| `packages/sync-service/lib/electric/shape_cache/storage.ex`                      | Storage behaviour and delegation                        |
| `packages/sync-service/lib/electric/shape_cache/pure_file_storage.ex`            | File-based storage implementation                       |
| `packages/sync-service/lib/electric/shape_cache/pure_file_storage/write_loop.ex` | Low-level write operations                              |
| `packages/sync-service/test/electric/shapes/consumer_test.exs`                   | Consumer tests including fragment-direct tests          |
| `packages/sync-service/test/support/test_storage.ex`                             | Test wrapper for storage that sends messages            |

## When Fragment-Direct Mode is Enabled

Fragment-direct mode is automatically enabled when ALL conditions are met (see `consumer.ex:476-481`):

```elixir
defp can_use_fragment_direct?(state) do
  state.fragment_direct? and           # Shape has no subquery dependencies
    not state.buffering? and           # Not waiting for initial snapshot
    not state.materializer_subscribed? and  # No materializer subscribed
    not needs_initial_filtering(state)      # Initial snapshot filtering complete
end
```

The `fragment_direct?` flag is set during state initialization based on whether the shape has dependencies:

```elixir
# In State.new/3 (state.ex:152-153)
fragment_direct?: shape.shape_dependencies == []
```

## Transaction Fragment Structure

From `lib/electric/replication/changes.ex:47-86`:

```elixir
defstruct xid: nil,
          lsn: nil,
          last_log_offset: nil,
          has_begin?: false,    # true = start of transaction
          commit: nil,          # set on final fragment (contains %Commit{})
          changes: [],
          affected_relations: MapSet.new(),
          change_count: 0
```

Fragment types:

- **Full transaction**: `has_begin?: true` AND `commit` is set (single fragment contains entire txn)
- **Start fragment**: `has_begin?: true`, no `commit`
- **Middle fragment**: `has_begin?: false`, no `commit`
- **End fragment**: `has_begin?: false`, `commit` is set

## Processing Flow

### Decision Point (consumer.ex:455-468)

```elixir
defp handle_event(%TransactionFragment{} = txn_fragment, state) do
  if can_use_fragment_direct?(state) do
    # FRAGMENT-DIRECT: Write fragments immediately to storage
    handle_fragment_direct(txn_fragment, state)
  else
    # TRANSACTION BUILDER: Buffer fragments, build complete Transaction
    {txns, transaction_builder} =
      TransactionBuilder.build(txn_fragment, state.transaction_builder)
    state = %{state | transaction_builder: transaction_builder}
    handle_txns(txns, state)
  end
end
```

### Fragment-Direct Processing (consumer.ex:485-698)

1. **On BEGIN fragment** (`has_begin?: true`):
   - `maybe_start_pending_txn/2` creates a `PendingTxn` struct to track transaction metadata

2. **On each fragment with changes**:
   - `write_fragment_to_storage/2` is called
   - Changes are filtered through `Shape.convert_change/3`
   - Log entries are prepared via `prepare_log_entries/3`
   - **Key call**: `ShapeCache.Storage.append_fragment_to_log!/2` writes immediately
   - `PendingTxn` is updated with last offset, change count, bytes written

3. **On COMMIT fragment** (`commit != nil`):
   - `write_fragment_to_storage/2` writes final changes
   - `maybe_complete_pending_txn/2` is called:
     - **Key call**: `ShapeCache.Storage.signal_txn_commit!/2` marks transaction complete
     - Updates `last_seen_txn_offset` in storage (critical for crash recovery)
     - Notifies clients of new changes
     - Records telemetry metrics

### Key Storage Functions

**`append_fragment_to_log!/2`** (pure_file_storage.ex:1319, write_loop.ex:141):

- Writes log lines to ETS buffer and potentially to disk
- Does **NOT** update `last_seen_txn_offset`
- Does **NOT** call `register_complete_txn`
- Data is stored but not yet "visible" via `get_log_stream`

**`signal_txn_commit!/2`** (pure_file_storage.ex:1342, write_loop.ex:434):

- Updates `last_seen_txn_offset` to mark transaction as complete
- Calls `register_complete_txn` to persist metadata
- After this, data becomes visible via `get_log_stream`

## Crash Recovery Implications

The separation between `append_fragment_to_log!` and `signal_txn_commit!` is intentional for crash safety:

- `last_seen_txn_offset` is only updated on commit
- `get_log_stream` uses `last_seen_txn_offset` as an upper read bound
- If process crashes before commit, partial data is discarded on recovery
- `fetch_latest_offset` returns the last committed transaction offset

## Data Visibility

**Before `signal_txn_commit!`**:

- Data is written to ETS buffer (`ets_line_buffer`)
- Data may be flushed to disk file
- Data is **NOT** visible via `Storage.get_log_stream()`
- `last_seen_txn_offset` still points to previous transaction

**After `signal_txn_commit!`**:

- `last_seen_txn_offset` is updated
- Data becomes visible via `Storage.get_log_stream()`
- Client notifications are sent

## Comparison: Fragment-Direct vs TransactionBuilder Mode

| Aspect             | Fragment-Direct Mode                                 | TransactionBuilder Mode                     |
| ------------------ | ---------------------------------------------------- | ------------------------------------------- |
| **When Used**      | Simple shapes (no subquery deps)                     | Shapes with subquery deps, during buffering |
| **Memory Usage**   | Lower - writes immediately                           | Higher - buffers entire transaction         |
| **Storage Calls**  | `append_fragment_to_log!` per fragment               | Single `append_to_log!` on commit           |
| **Write Timing**   | Each fragment written immediately                    | All changes written on commit               |
| **Crash Recovery** | Safe - `last_seen_txn_offset` only updated on commit | Safe - writes only on commit                |

## Testing Fragment-Direct Mode

### Test File Location

`packages/sync-service/test/electric/shapes/consumer_test.exs`

The "fragment-direct streaming" describe block (starts around line 1108) contains tests for this functionality.

### TestStorage Wrapper

`test/support/test_storage.ex` provides a storage wrapper that sends messages to the test process when storage operations are called:

```elixir
# Sends message when append_fragment_to_log! is called
def append_fragment_to_log!(log_items, {parent, shape_handle, data, storage}) do
  send(parent, {__MODULE__, :append_fragment_to_log!, shape_handle, log_items})
  storage = Storage.append_fragment_to_log!(log_items, storage)
  {parent, shape_handle, data, storage}
end

# Sends message when signal_txn_commit! is called
def signal_txn_commit!(xid, {parent, shape_handle, data, storage}) do
  send(parent, {__MODULE__, :signal_txn_commit!, shape_handle, xid})
  storage = Storage.signal_txn_commit!(xid, storage)
  {parent, shape_handle, data, storage}
end
```

### Using TestStorage in Tests

To use TestStorage, wrap the storage **before** starting the shape cache/consumers:

```elixir
# In setup block, BEFORE with_shape_cache is called:
storage = Support.TestStorage.wrap(ctx.storage, %{})
Electric.StackConfig.put(ctx.stack_id, Electric.ShapeCache.Storage, storage)

# Then in test:
assert_receive {Support.TestStorage, :append_fragment_to_log!, ^shape_handle, lines}
assert_receive {Support.TestStorage, :signal_txn_commit!, ^shape_handle, ^xid}
```

### Challenge: Verifying Fragment Writes Before Commit

The key behavior to test is that `append_fragment_to_log!` is called for each fragment **before** the commit fragment is processed. However:

1. `Storage.get_log_stream()` won't show uncommitted data (by design)
2. TestStorage must be configured **before** shape cache starts
3. The current "fragment-direct streaming" test setup uses `with_shape_cache` which initializes storage before individual tests run

### Recommended Test Approach

To properly test that fragments are written before commit:

1. **Option A**: Create a new setup that wraps storage with TestStorage before `with_shape_cache`
2. **Option B**: Use a separate describe block with custom setup that:
   - Calls `with_pure_file_storage`
   - Wraps with `TestStorage.wrap(ctx.storage, %{})`
   - Updates `StackConfig` with wrapped storage
   - Then calls `with_shape_cache`

Then assert the sequence of messages:

```elixir
# After fragment1
assert_receive {Support.TestStorage, :append_fragment_to_log!, ^shape_handle, frag1_lines}
refute_receive {Support.TestStorage, :signal_txn_commit!, _, _}

# After fragment2
assert_receive {Support.TestStorage, :append_fragment_to_log!, ^shape_handle, frag2_lines}
refute_receive {Support.TestStorage, :signal_txn_commit!, _, _}

# After fragment3 (commit)
assert_receive {Support.TestStorage, :append_fragment_to_log!, ^shape_handle, frag3_lines}
assert_receive {Support.TestStorage, :signal_txn_commit!, ^shape_handle, ^xid}
```

## Event Flow Diagram

```
ShapeLogCollector.handle_event(fragment, stack_id)
    │
    ▼
GenServer.call (synchronous)
    │
    ▼
ShapeLogCollector.do_handle_event(fragment)
    │
    ▼
ConsumerRegistry.publish (synchronous broadcast)
    │
    ▼
Consumer.handle_call({:handle_event, fragment, ctx})
    │
    ▼
can_use_fragment_direct?(state) ─── false ──► TransactionBuilder path
    │
    true
    │
    ▼
handle_fragment_direct(fragment, state)
    │
    ├── maybe_start_pending_txn (if has_begin?)
    │
    ├── write_fragment_to_storage
    │       │
    │       ▼
    │   Storage.append_fragment_to_log!(lines, writer)
    │
    └── maybe_complete_pending_txn (if commit != nil)
            │
            ▼
        Storage.signal_txn_commit!(xid, writer)
            │
            ▼
        notify_clients_of_new_changes()
```

## Important Code References

- Fragment-direct decision: `consumer.ex:455-468`
- `can_use_fragment_direct?`: `consumer.ex:476-481`
- `handle_fragment_direct`: `consumer.ex:485-509`
- `write_fragment_to_storage`: `consumer.ex:533-598`
- `maybe_complete_pending_txn`: `consumer.ex:611-671`
- `append_fragment_to_log!` (Storage): `storage.ex:382-384`
- `append_fragment_to_log!` (WriteLoop): `write_loop.ex:141-178`
- `signal_txn_commit!` (Storage): `storage.ex:387-389`
- `signal_txn_commit!` (WriteLoop): `write_loop.ex:434-436`
- `PendingTxn` struct: `consumer/pending_txn.ex`
