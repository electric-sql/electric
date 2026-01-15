# Race Condition Analysis: PureFileStorage ETS Read/Write Race

## Executive Summary

A race condition exists in PureFileStorage where readers can miss data that exists in the system
because they use stale metadata to decide where to read from, while the writer clears the ETS
buffer between the reader's metadata check and data access.

## The Bug

### Location
- **`lib/electric/shape_cache/pure_file_storage.ex:1138-1143`** - Reader decision logic
- **`lib/electric/shape_cache/pure_file_storage/write_loop.ex:339`** - ETS clearing on flush

### Root Cause

The reader reads metadata as a snapshot, then uses that snapshot to decide whether to read from
disk or ETS. However, the writer can flush (updating metadata and clearing ETS) between these
two operations.

```elixir
# pure_file_storage.ex:1115-1156 (stream_main_log)
defp stream_main_log(min_offset, max_offset, %__MODULE__{} = opts) do
  storage_meta(
    ets_table: ets,
    last_persisted_offset: last_persisted,  # <-- Step 1: Read stale value
    ...
  ) = read_or_initialize_metadata(opts, [])

  cond do
    is_log_offset_lte(last_persisted, min_offset) and is_nil(ets) ->
      []

    is_log_offset_lte(last_persisted, min_offset) ->
      read_range_from_ets_cache(ets, min_offset, upper_read_bound)  # <-- Step 3: ETS empty!
    ...
  end
end
```

```elixir
# write_loop.ex:312-340 (flush_buffer)
def flush_buffer(...) do
  IO.binwrite(json_file, buffer)
  :file.datasync(json_file)

  writer_acc(acc,
    last_persisted_offset: last_seen_offset,  # <-- Step 2a: Update offset
    ...
  )
  |> update_persistance_metadata(state, last_persisted_txn)  # <-- Step 2b: Update ETS metadata
  |> trim_ets(state)  # <-- Step 2c: CLEAR ALL ETS DATA!
end
```

### The Race Window

```
Time →
┌─────────────────────────────────────────────────────────────────────────┐
│ Reader Process                    │ Writer Process                      │
├───────────────────────────────────┼─────────────────────────────────────┤
│ T1: Read metadata snapshot        │                                     │
│     last_persisted = X            │                                     │
│     last_seen = Y (Y > X)         │                                     │
│     ets_ref = #Ref<...>           │                                     │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │ T2: flush_buffer()                  │
│                                   │   - Write data to disk              │
│                                   │   - Update last_persisted = Y       │
│                                   │   - CLEAR ETS (trim_ets)            │
├───────────────────────────────────┼─────────────────────────────────────┤
│ T3: Check: min_offset > X?        │                                     │
│     Yes → read from ETS           │                                     │
│     ETS is EMPTY!                 │                                     │
│     Returns [] (data loss!)       │                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

The data IS on disk (flushed at T2), but the reader decided to read from ETS at T1 when
`last_persisted = X`. By T3, ETS has been cleared, so reader gets nothing.

## Impact

- **Data Visibility**: Clients may temporarily see stale data or miss recent writes
- **Consistency**: Read-after-write consistency is violated during the race window
- **Severity**: Medium - Data is not lost (it's on disk), but temporarily invisible

## Formal Verification

See `PureFileStorageRace.lean` for a Lean 4 model proving:
- Initial state with data in ETS is safe
- After writer flush, ETS is empty but metadata shows data should be in ETS
- Reader with stale metadata gets empty results (bug!)
- With fix (re-check metadata), reader correctly falls back to disk

## Elixir Test

See `test/electric/shape_cache/pure_file_storage_race_test.exs` for tests demonstrating:
1. Reader can miss data when ETS cleared between metadata read and data read
2. Data IS on disk after flush but reader misses it
3. Proposed fix: re-check metadata before reading from ETS
4. Timeline showing exact race window

## Recommended Fixes

### Option A: Re-check metadata before ETS read (Minimal change)

```elixir
# In stream_main_log, case for ETS-only read:
is_log_offset_lte(last_persisted, min_offset) ->
  # Re-check current metadata
  current_last_persisted = :ets.lookup_element(stack_ets, handle, :last_persisted_offset)
  if LogOffset.compare(current_last_persisted, min_offset) != :lt do
    # Data moved to disk, read from there instead
    stream_from_disk(opts, min_offset, max_offset, boundary_info)
  else
    read_range_from_ets_cache(ets, min_offset, upper_read_bound)
  end
```

### Option B: Delayed ETS clearing

Don't clear ETS immediately on flush. Instead, use a generation counter or timestamp
to let readers drain before clearing.

### Option C: Read-copy-update pattern

Keep old ETS data until readers are done, similar to RCU in kernel programming.

## Comparison with First Bug

| Aspect | Bug #1 (Shape Removal) | Bug #2 (ETS Read/Write) |
|--------|------------------------|-------------------------|
| Location | ConsumerRegistry | PureFileStorage |
| Cause | Ordering of removal steps | Stale metadata snapshot |
| Symptom | Crash (send to nil) | Data invisibility |
| Severity | High (crash) | Medium (temporary) |
| Fix | Filter nil pids or reorder | Re-check metadata |

## Code Locations

- `lib/electric/shape_cache/pure_file_storage.ex:1138-1143` - Decision to read from ETS
- `lib/electric/shape_cache/pure_file_storage/write_loop.ex:339` - trim_ets call
- `lib/electric/shape_cache/pure_file_storage/write_loop.ex:292-295` - trim_ets implementation
