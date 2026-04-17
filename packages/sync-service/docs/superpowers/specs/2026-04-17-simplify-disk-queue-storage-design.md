# Simplify DiskQueue-backed shape storage to two queues

## Background

`Electric.ShapeCache.LmdbQueueStorage` stores each shape's data in three
`Electric.Nifs.DiskQueue` instances, orchestrated by
`Electric.QueueSystem.Queue`:

- `output` — final queue consumed by the Writer pool
- `snapshot` — ephemeral queue that the snapshotter writes into
- `streaming` — ephemeral queue that buffers replication events arriving during
  the snapshot

After the snapshot completes, `transition_to_live` copies `snapshot` → `output`,
then copies `streaming` (up to a captured boundary) → `output`, then flushes an
in-memory buffer of concurrent writes and switches replication writes to go
directly to `output`.

The separate `snapshot` queue is unnecessary indirection — the snapshotter can
write directly to `output`, removing one queue and one copy step.

## Goals

- Reduce from three DiskQueues to two: `output` and `streaming`.
- Snapshotter writes directly to the `output` queue.
- Snapshotter (not the consumer) drives the transition: copy `streaming` →
  `output`, then delete the `streaming/` directory. The consumer's message
  loop only handles the mode flip at the start and the in-memory buffer flush
  at the end.

## Non-goals

- Crash-recovery of partial snapshots. Shapes with incomplete snapshots are
  deleted at init by upstream machinery, so partial data in `output` is not a
  concern.
- Cleanup of unused `Electric.QueueSystem.SnapshotCollector`,
  `Electric.QueueSystem.Key`, or `Electric.QueueSystem.Copier`. Out of scope.
- Renaming queues or writer modes.

## Architecture

### Queues per shape

| queue       | role                                                          | lifetime                    |
|-------------|---------------------------------------------------------------|-----------------------------|
| `output`    | final destination consumed by the Writer                      | persistent                  |
| `streaming` | buffers replication events that arrive during snapshot        | deleted after transition    |

Directory layout under `<shape_base>/queue/`:

```
output/       persistent
streaming/    removed at end of transition
```

No `snapshot/` subdirectory.

### Writer modes

State machine on `Electric.QueueSystem.Queue`:

1. `:streaming` — replication writes go to the `streaming` queue. Snapshotter
   (running in a separate task) writes directly to the `output` queue.
2. `:buffering` — during the transition. The boundary of the `streaming` queue
   is captured; the snapshotter copies `streaming` → `output`; concurrent
   replication writes accumulate in an in-memory buffer on the consumer's
   `Queue` struct.
3. `:live` — replication writes go directly to `output`.

The in-memory buffer during `:buffering` is retained because replication writes
continue to arrive while the disk copy runs.

### Handle ownership

The expensive disk-to-disk copy runs in the snapshotter task, not in the
consumer's message loop. Handles are held as follows:

- The consumer opens `output` and `streaming` handles in `init_writer!` via
  `Queue.new` (for writing, in-memory buffer management, and final
  `register_output`).
- The snapshotter task opens its own short-lived handles to `output/` and
  `streaming/` for the duration of the snapshot + copy phase:
  - `output/` — writes snapshot rows, then copies `streaming` → `output`.
  - `streaming/` — reads the buffered replication events.

Two write handles to `output/` coexist during the snapshot + copy window, but
only one writes at a time: the snapshotter writes until it sends the
`{:snapshot_data_written, ...}` cast; the consumer writes only when handling
that cast (buffer flush) and afterwards in `:live` mode.

This mirrors the current pattern for the `snapshot/` queue (consumer opens a
handle it never uses; snapshotter opens a separate ephemeral handle).

### Consumer API (new + reused)

Snapshotter ↔ consumer interaction is one new synchronous call plus the
existing cast:

- `start_transition(consumer)` → `{:ok, last_streaming_id}` (new, synchronous)
  - Flips the `Queue` mode from `:streaming` to `:buffering`.
  - Captures and returns the consumer's current `last_streaming_id` so the
    snapshotter knows the copy boundary.
  - From this point, concurrent replication writes go to the in-memory buffer
    on the `Queue` struct.
  - Synchronous because the snapshotter needs the boundary and a
    happens-before guarantee before starting the copy.
- `{:snapshot_data_written, shape_handle}` (existing cast, re-purposed)
  - Sent by the snapshotter after the streaming-copy is done.
  - Handler flushes the in-memory buffer to `output`, flips mode to `:live`,
    `register_output`, `cleanup_temp` (`rm_rf streaming/`), and
    `notify_writes`.
  - Can stay async because the snapshotter has nothing left to do — it exits
    after casting.

## Data flow

### Snapshot phase (mode `:streaming`)

Running in the snapshotter task:

1. Open `<base>/queue/output/` via `DiskQueue.open`.
2. Push snapshot rows into it (skipping `:chunk_boundary` markers).

Running in the consumer concurrently:

- `append_to_log!(log_items, writer_state)` → `Queue.push` → `streaming` queue.

### Transition (driven by the snapshotter task)

1. Snapshotter: finishes writing snapshot rows to `output`.
2. Snapshotter → consumer: `start_transition` **call** (sync). Consumer
   captures `last_streaming_id`, flips mode to `:buffering`, returns `last_id`.
3. Snapshotter: opens `<base>/queue/streaming/` handle, copies
   `streaming[0..last_id]` → `output` using its own handles. Releases its
   handles when done.
4. Snapshotter → consumer: `{:snapshot_data_written, shape_handle}` **cast**
   (async). Snapshotter exits immediately after.
5. Consumer (in its own time): flushes in-memory buffer → `output`, flips
   mode to `:live`, `register_output`, `cleanup_temp`, `notify_writes`.

Between step 4 and step 5 the consumer remains in `:buffering` mode — any
replication writes that arrive in that window continue to accumulate in the
in-memory buffer and get flushed when step 5 runs. The consumer's message
mailbox ordering guarantees the cast is handled after any writes already
queued ahead of it.

### Removed

- `Queue` struct field `:snapshot`.
- `Queue.new` opening of `Path.join(base_dir, "snapshot")`.
- `Queue.push_snapshot/2`.
- `Queue.copy_snapshot_to_output/1`.
- `LmdbQueueStorage.transition_to_live` (replaced by the
  `start_transition` call + snapshotter-side copy +
  `{:snapshot_data_written, ...}` cast flow).
- The `snapshot/` subdirectory and its `rm_rf` inside `Queue.cleanup_temp`.

### Changed

- `LmdbQueueStorage.make_new_snapshot!` opens `<base>/queue/output/`
  (instead of `snapshot/`), pushes rows, then drives the transition:
  `start_transition` call → `Queue.copy_streaming_to_output` →
  `{:snapshot_data_written, shape_handle}` cast.
- `Queue.copy_streaming_to_output/2` stays but is callable from the snapshotter
  — it takes explicit `src` and `dst` handles rather than reaching through a
  `Queue` struct (since the snapshotter owns the handles, not a `Queue`
  struct). Callers that want the old signature can wrap it.
- `Queue.cleanup_temp` removes only `streaming/`.
- `Queue.start_buffering/1` and `Queue.go_live/1` stay; the work formerly
  around them (`register_output`, `cleanup_temp`, `notify_writes`) now runs
  inside the consumer's existing `{:snapshot_data_written, ...}` handler.

### Unchanged

- HTTP read path (served from durable streams, not local storage).
- `snapshot_started` marker file semantics.
- `Queue` mode names (`:streaming`, `:buffering`, `:live`).
- ETS-based output-handle registration used by the Writer pool (still happens
  at the end of transition, just now inside the
  `{:snapshot_data_written, ...}` handler).

## Test plan

Cover with unit tests on `Electric.QueueSystem.Queue` and
`Electric.ShapeCache.LmdbQueueStorage`:

- Snapshot-only path: pushing rows via the snapshotter-style handle to
  `output/` then a transition with an empty `streaming` queue yields exactly
  the snapshot rows in `output`, in order.
- Snapshot + concurrent replication: rows pushed to `streaming` during the
  snapshot phase land in `output` after transition, in the order
  (snapshot_rows, streaming_rows).
- Buffering phase: writes arriving between `start_buffering` and `go_live` end
  up in `output` after the streaming-queue contents, preserving arrival order.
- Post-transition: `streaming/` directory is gone from disk; `snapshot/` is
  never created.
- `cleanup!` still removes the whole shape directory.

Existing higher-level tests (`router_test.exs`, integration suites) should pass
without modification; if any assertion references the `snapshot/` path it
should be updated.

## Risks and mitigations

- **Two concurrent writers on `output/`** — mitigated by temporal separation:
  the snapshotter writes until the cast is sent; the consumer only writes to
  `output` when handling `{:snapshot_data_written, ...}`. If `DiskQueue`
  rejects a second open handle outright, the snapshotter can receive the
  consumer's handle via the `start_transition` reply instead. Catch this in
  tests.
- **Consumer blocked flushing the buffer** — handling
  `{:snapshot_data_written, ...}` holds the consumer's message loop while it
  flushes the in-memory buffer to `output`. Bound by the size accumulated
  during the streaming-copy step; expected to be small in practice. If it
  becomes a concern, the flush can be batched.
- **Partial snapshot on crash** — explicitly out of scope (upstream deletes
  incomplete shapes).
