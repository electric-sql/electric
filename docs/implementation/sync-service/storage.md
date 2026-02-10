# Storage System Implementation

This document provides a deep implementation dive into the storage system in Electric's sync-service.

## Overview

The PureFileStorage system is a sophisticated multi-file, crash-resilient storage backend optimized for streaming replication logs with concurrent read/write access. It implements a dual-buffer architecture (ETS + disk) with atomic persistence guarantees and compaction support.

## 1. Storage Behaviour

**File**: `lib/electric/shape_cache/storage.ex`

### Key Callbacks

```elixir
# Configuration & Initialization
@callback shared_opts(term()) :: compiled_opts()
@callback for_shape(shape_handle(), compiled_opts()) :: shape_opts()
@callback init_writer!(shape_opts(), Shape.t()) :: writer_state()

# Snapshot Writing
@callback make_new_snapshot!(json_result_stream(), shape_opts()) :: :ok

# Log Writing & Reading
@callback append_to_log!(Enumerable.t(log_item()), writer_state()) :: writer_state()
@callback get_log_stream(offset(), max_offset(), shape_opts()) :: log()
@callback get_chunk_end_log_offset(LogOffset.t(), shape_opts()) :: LogOffset.t() | nil

# Lifecycle & Cleanup
@callback cleanup!(shape_opts()) :: any()
@callback compact(shape_opts(), keep_complete_chunks()) :: :ok
```

## 2. File Layout and Formats

### Directory Structure

```
shapes/
  {stack_id}/
    {shape_handle}/
      log/
        log.latest.0.jsonfile.bin      # Main transaction log
        log.latest.0.chunk.bin         # Chunk index
        log.latest.0.keyfile.bin       # Key index (for compaction)
        log.compacted.{timestamp}.jsonfile.bin
      metadata/
        version.bin                    # Storage version
        latest_name.bin                # Current log file suffix
        last_persisted_txn_offset.bin  # Last atomically persisted offset
        snapshot_started?.bin          # Boolean flag
        pg_snapshot.bin                # Postgres snapshot metadata
        last_snapshot_chunk.bin        # Last snapshot chunk offset
        compaction_boundary.bin        # {offset, suffix} tuple
        shape_definition.json          # Shape schema
      snapshot/
        0.jsonsnapshot                 # Initial snapshot chunks
        1.jsonsnapshot
```

### Binary Format for Log Files

**Main Log Entry Format** (`log.{suffix}.jsonfile.bin`):

```
<<
  tx_offset::64,        # Transaction offset (LSN-based)
  op_offset::64,        # Operation within transaction
  key_size::32,         # Size of primary key
  key::binary-size(key_size),
  op_type::8,           # ?i (insert), ?u (update), ?d (delete), ?c (control)
  flag::8,              # 0 = unprocessed, 1 = processed (compaction flag)
  json_size::64,        # Size of JSON payload
  json::binary-size(json_size)
>>
```

**Line overhead:** 30 bytes (16 + 4 + 1 + 1 + 8)

### Chunk Index Structure

**Chunk Index Entry Format** (`log.{suffix}.chunk.bin`):

```
# Complete chunk (64 bytes):
<<
  min_tx_offset::64,      # First transaction in chunk
  min_op_offset::64,      # First operation in chunk
  start_pos::64,          # Byte position in log file (start)
  key_start_pos::64,      # Byte position in key index (start)
  max_tx_offset::64,      # Last transaction in chunk
  max_op_offset::64,      # Last operation in chunk
  end_pos::64,            # Byte position in log file (end)
  key_end_pos::64         # Byte position in key index (end)
>>

# Incomplete chunk (32 bytes):
<<
  min_tx_offset::64,
  min_op_offset::64,
  start_pos::64,
  key_start_pos::64
>>
```

## 3. WriteLoop Buffer Management

**File**: `lib/electric/shape_cache/pure_file_storage/write_loop.ex`

### Two-Layer Buffer System

```
┌─────────────────────────────────────────────────────────────┐
│                     Write Pipeline                          │
├─────────────────────────────────────────────────────────────┤
│  append_to_log!                                             │
│       │                                                      │
│       ├─> In-Memory IOData Buffer (iolist)                  │
│       │   • Accumulates binary entries                      │
│       │   • Threshold: 64KB                                 │
│       │   • Fast appends (O(1) list cons)                   │
│       │                                                      │
│       ├─> ETS Line Buffer (ordered_set)                     │
│       │   • Key: {tx_offset, op_offset}                     │
│       │   • Value: {offset, json}                           │
│       │   • For live tail reads                             │
│       │   • Cleared on flush                                │
│       │                                                      │
│       └─> Flush Triggers:                                   │
│           • Buffer >= 64KB                                  │
│           • Chunk boundary reached                          │
│           • Timer (1s default)                              │
│           • Transaction boundary                            │
└─────────────────────────────────────────────────────────────┘
```

### Writer State Records

```elixir
defrecord :writer_acc,
  ets_line_buffer: [],
  buffer: [],                                       # IOData buffer
  buffer_size: 0,
  last_seen_offset: LogOffset.last_before_real_offsets(),
  last_seen_txn_offset: LogOffset.last_before_real_offsets(),
  last_persisted_offset: LogOffset.last_before_real_offsets(),
  last_persisted_txn_offset: LogOffset.last_before_real_offsets(),
  write_position: 0,
  bytes_in_chunk: 0,
  times_flushed: 0,
  chunk_started?: false,
  cached_chunk_boundaries: {LogOffset.last_before_real_offsets(), []},
  open_files: {:open_files, nil, nil}
```

### Flush Logic

```elixir
def flush_buffer(writer_acc(buffer: buffer, open_files: open_files(json_file: json_file)) = acc, state) do
  IO.binwrite(json_file, buffer)      # Write accumulated IOData
  :file.datasync(json_file)           # Force sync to disk (fsync)

  send(self(), {Storage, :flushed, last_seen_offset})  # Notify parent

  writer_acc(acc,
    buffer: [],
    buffer_size: 0,
    ets_line_buffer: [],
    last_persisted_offset: last_seen_offset,
    last_persisted_txn_offset: last_seen_txn,
    times_flushed: times_flushed + 1
  )
  |> update_persistance_metadata(state, last_persisted_txn)
  |> trim_ets(state)
end
```

### Atomic Write Guarantees

**Three-Phase Persistence Protocol:**

```
Phase 1: Buffered Write
┌────────────────────────────────────────┐
│ Log Item → Buffer (IOData)             │
│          → ETS (for live reads)        │
│ last_seen_offset updated               │
└────────────────────────────────────────┘
         ↓
Phase 2: Disk Flush (at threshold)
┌────────────────────────────────────────┐
│ IO.binwrite(file, buffer)              │
│ :file.datasync(file)    ← fsync!       │
│ last_persisted_offset updated          │
│ ETS buffer cleared                     │
└────────────────────────────────────────┘
         ↓
Phase 3: Transaction Boundary
┌────────────────────────────────────────┐
│ last_persisted_txn_offset updated      │
│ ← ATOMIC: written LAST to metadata     │
│    file with tmp → rename              │
└────────────────────────────────────────┘
```

**Atomic Write Pattern:**

```elixir
tmp_path = path <> ".tmp"
write!(tmp_path, :erlang.term_to_binary(value), [:write, :raw])
rename!(tmp_path, path)  # Atomic on POSIX systems
```

## 4. Snapshot Writing

### Snapshot File Format

**Format:** JSON Lines with trailing commas + EOT marker

```
# File: snapshot/0.jsonsnapshot
{"key": "1", "value": {"col1": "data1"}},
{"key": "2", "value": {"col2": "data2"}},
\x04
```

**Special Byte:** `0x04` (ASCII End of Transmission) distinguishes "writer still writing" from "writer finished"

### Streaming Write Algorithm

```elixir
def write_snapshot_stream!(stream, opts, write_buffer \\ 64 * 1024) do
  stream
  |> Stream.transform(
    fn -> {0, nil, {[], 0}} end,
    fn
      :chunk_boundary, {chunk_num, file, {buffer, _}} ->
        IO.binwrite(file, [buffer, <<4::utf8>>])  # Write buffer + EOT
        File.close(file)
        {[], {chunk_num + 1, nil, {[], 0}}}

      line, {chunk_num, file, {buffer, buffer_size}} ->
        file = file || open_snapshot_chunk_to_write(opts, chunk_num)
        line_size = IO.iodata_length(line)

        if buffer_size + line_size > write_buffer do
          IO.binwrite(file, [buffer, line, ",\n"])
          {[chunk_num], {chunk_num, file, {[], 0}}}
        else
          {[chunk_num], {chunk_num, file, {[buffer, line, ",\n"], buffer_size + line_size + 2}}}
        end
    end,
    # Write final EOT on cleanup
    fn {chunk_num, file, {buffer, _}} ->
      if file, do: IO.binwrite(file, [buffer, <<4::utf8>>])
      {[chunk_num], {chunk_num, file, {[], 0}}}
    end,
    fn {_, file, _} -> if file, do: File.close(file) end
  )
end
```

## 5. Log Reading

### Multi-Source Read Strategy

```elixir
defp stream_main_log(min_offset, max_offset, opts) do
  storage_meta(...) = read_or_initialize_metadata(opts, [])

  upper_read_bound = LogOffset.min(max_offset, last_seen)

  cond do
    # All data in ETS
    is_log_offset_lte(last_persisted, min_offset) and not is_nil(ets) ->
      read_range_from_ets_cache(ets, min_offset, upper_read_bound)

    # All data on disk
    is_log_offset_lte(upper_read_bound, last_persisted) ->
      stream_from_disk(opts, min_offset, upper_read_bound, boundary_info)

    # Split across disk + ETS
    true ->
      upper_range = read_range_from_ets_cache(ets, last_persisted, upper_read_bound)

      stream_from_disk(opts, min_offset, last_persisted, boundary_info)
      |> Stream.concat(upper_range)
  end
end
```

### Chunk Boundary Lookups

**Three-Tier Lookup Strategy:**

1. **In-Memory Cache** (last 3 chunks)
2. **Binary Search** in chunk index file (O(log n))
3. **Compacted file** lookup

```elixir
defp fetch_chunk(offset, opts, boundary_info) do
  {latest_name, {compaction_boundary, compacted_name}, {cached_min, chunks}} = boundary_info

  cond do
    LogOffset.is_log_offset_lt(offset, compaction_boundary) ->
      ChunkIndex.fetch_chunk(chunk_file(opts, compacted_name), offset)

    not is_nil(cached_min) and LogOffset.is_log_offset_lte(cached_min, offset) ->
      find_chunk_positions_in_cache(chunks, offset)

    true ->
      ChunkIndex.fetch_chunk(chunk_file(opts, latest_name), offset)
  end
end
```

## 6. Compaction

### Trigger Conditions

```elixir
def schedule_compaction(compaction_config) do
  half_period = div(compaction_config.period, 2)

  # Jitter prevents thundering herd
  Process.send_after(
    self(),
    {Storage, {__MODULE__, :scheduled_compaction, [compaction_config]}},
    compaction_config.period + Enum.random(-half_period..half_period)
  )
end

# Default: every 10 minutes ± 5 minutes
```

### Merge Algorithm

**Input Files:**

1. `log.latest.{ts}.jsonfile.bin` (current log)
2. `log.compacted.{old}.jsonfile.bin` (previous compaction, optional)

**Process:**

1. Create keyfile from log entries being compacted
2. Sort and merge keyfiles
3. Create action file (keep/skip/compact for each key)
4. Merge log files according to actions
5. Copy merged files to final location
6. Trim current file, delete old files

### Key Deduplication

```elixir
def create_from_key_index(key_index_path, action_file_path) do
  KeyIndex.stream_for_actions(key_index_path)
  |> Stream.chunk_by(&elem(&1, 0))  # Group by key
  |> Stream.map(fn chunk ->
    chunk
    |> Enum.chunk_by(&elem(&1, 3))  # Group by operation type
    |> Enum.map(fn
      # Single operation -> keep as-is
      [{_, label, offset, _, entry_start, _}] ->
        base_entry(offset, label, entry_start, :keep)

      # Multiple updates -> compact into one
      updates ->
        updates_to_actions(updates)
    end)
  end)
end
```

## 7. Recovery

### Crash Recovery Flow

```elixir
defp initialise_filesystem!(opts, shape_definition) do
  on_disk_version = read_metadata!(opts, :version)
  new? = is_nil(on_disk_version)

  initialize? =
    if not new? and
       (on_disk_version != opts.version or
        not snapshot_complete?(opts) or
        is_nil(read_metadata!(opts, :pg_snapshot))) do
      cleanup!(opts)  # Full cleanup on version mismatch
      true
    else
      new?
    end

  if initialize? do
    create_directories!(opts)
    write_shape_definition!(opts, shape_definition)
  end

  suffix = read_cached_metadata(opts, :latest_name) ||
           write_metadata!(opts, :latest_name, "latest.0")

  {last_persisted_txn_offset, json_file_size, chunks} =
    if initialize? do
      {LogOffset.last_before_real_offsets(), 0, []}
    else
      last_persisted_txn_offset = read_cached_metadata(opts, :last_persisted_txn_offset)

      # Critical: trim log to last known good offset
      trim_log!(opts, last_persisted_txn_offset, suffix)

      {last_persisted_txn_offset, FileInfo.get_file_size!(json_file(opts, suffix)), ...}
    end
end
```

### Log Trimming

```elixir
defp trim_log!(opts, last_persisted_offset, suffix) do
  # Phase 1: Trim chunk index
  {log_search_start_pos, _} =
    ChunkIndex.realign_and_trim(chunk_file(opts, suffix), last_persisted_offset)

  # Phase 2: Trim log file
  LogFile.trim(json_file(opts, suffix), log_search_start_pos, last_persisted_offset)
end
```

**Chunk Index Realignment:**

```elixir
def realign_and_trim(chunk_file_path, last_persisted_offset) do
  # Remove partial writes (not aligned to 32-byte boundaries)
  size = case FileInfo.file_size(chunk_file_path) do
    {:ok, size} when rem(size, @half_record_width) == 0 -> size
    {:ok, size} ->
      FileInfo.truncate(chunk_file_path, size - rem(size, @half_record_width))
  end

  # Recursively trim chunks beyond persisted offset
  trim(size, chunk_file_path, last_persisted_offset)
end
```

## 8. Performance Optimizations

1. **Dual Buffering**: IOData for appends + ETS for live reads eliminates reader-writer contention
2. **Chunk Caching**: Last 3 chunks in memory avoids 95%+ of chunk index lookups
3. **Binary Search**: O(log n) chunk lookups scale to billions of entries
4. **Delayed Writes**: 64KB buffer + 1s timer batches syscalls efficiently
5. **Compaction Jitter**: ±50% randomization prevents synchronized load spikes

## 9. Correctness Guarantees

1. **Atomic Persistence**: tmp → rename ensures crash-consistent metadata
2. **Transaction Boundaries**: Only advance `last_persisted_txn_offset` when fully flushed
3. **Monotonic Offsets**: All offset comparisons use strict total ordering
4. **Trim-on-Recovery**: Always trim to last known good offset
5. **Concurrent Safety**: ETS read_concurrency + materialization protects against flush races

## 10. Essential Files

| File                                                           | Purpose                    |
| -------------------------------------------------------------- | -------------------------- |
| `lib/electric/shape_cache/storage.ex`                          | Behaviour definition       |
| `lib/electric/shape_cache/pure_file_storage.ex`                | Main storage orchestration |
| `lib/electric/shape_cache/pure_file_storage/write_loop.ex`     | Buffering and flush logic  |
| `lib/electric/shape_cache/pure_file_storage/log_file.ex`       | Log file encoding/decoding |
| `lib/electric/shape_cache/pure_file_storage/chunk_index.ex`    | Chunk indexing             |
| `lib/electric/shape_cache/pure_file_storage/key_index.ex`      | Key indexing               |
| `lib/electric/shape_cache/pure_file_storage/action_file.ex`    | Compaction actions         |
| `lib/electric/shape_cache/pure_file_storage/snapshot.ex`       | Snapshot streaming         |
| `lib/electric/shape_cache/pure_file_storage/shared_records.ex` | Record definitions         |
