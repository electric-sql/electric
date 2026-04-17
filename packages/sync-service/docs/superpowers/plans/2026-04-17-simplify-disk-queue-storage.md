# Simplify DiskQueue-backed shape storage to two queues

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-queue (output / snapshot / streaming) storage for a shape with a two-queue design (output / streaming), and move the disk-to-disk copy of the replication buffer off the consumer's message loop into the snapshotter task.

**Architecture:**
- `Electric.QueueSystem.Queue` loses its `:snapshot` field and associated push/copy/cleanup logic.
- `Electric.ShapeCache.LmdbQueueStorage.make_new_snapshot!` opens `<base>/queue/output/` directly and pushes snapshot rows there. A helper `copy_buffer_to_output!` opens fresh `streaming/` and `output/` handles in the snapshotter task, copies `streaming[0..last_id]` → `output`.
- The transition is driven from the snapshotter task: a sync `GenServer.call` flips the consumer to `:buffering` and returns `last_streaming_id`; the snapshotter copies; then sends the existing `{:snapshot_data_written, shape_handle}` cast. The consumer's re-purposed handler runs `Queue.go_live` (flush in-memory buffer), `cleanup_temp`, `register_output`, `notify_writes`.

**Tech Stack:** Elixir / OTP; Rustler-wrapped `Electric.Nifs.DiskQueue`; GenServer (`Electric.Shapes.Consumer`); Task (`Electric.Shapes.Consumer.Snapshotter`).

**Spec:** `docs/superpowers/specs/2026-04-17-simplify-disk-queue-storage-design.md`

---

## Commit strategy

Two atomic commits, each leaves the codebase compiling and all tests green:

1. **Commit A (Tasks 1–3):** Drop the `snapshot` queue. Snapshotter writes directly to `output`. Transition still runs inside the consumer's `{:snapshot_data_written, ...}` cast (existing behaviour, minus the snapshot-copy step).
2. **Commit B (Tasks 4–7):** Move the streaming-queue copy out of the consumer and into the snapshotter task. Consumer's handler shrinks to just the go-live/cleanup/register/notify work.

---

## File inventory

**Modified (Commit A):**
- `lib/electric/queue_system/queue.ex` — drop `:snapshot` field, `push_snapshot/2`, `copy_snapshot_to_output/1`; `cleanup_temp/1` removes only `streaming/`.
- `lib/electric/shape_cache/lmdb_queue_storage.ex` — `make_new_snapshot!` writes to `output/`; `transition_to_live/1` drops the snapshot-copy step.

**Modified (Commit B):**
- `lib/electric/queue_system/queue.ex` — `copy_streaming_to_output` becomes `/3` taking `(src, dst, last_id)` handles.
- `lib/electric/shape_cache/lmdb_queue_storage.ex` — add `copy_buffer_to_output!/2`; remove `transition_to_live/1`.
- `lib/electric/shapes/consumer.ex` — add `start_transition/1` (public) + `handle_call(:start_transition, ...)`; shrink `handle_cast({:snapshot_data_written, ...}, ...)` to the resume-work-only path.
- `lib/electric/shapes/consumer/snapshotter.ex` — after `make_new_snapshot!`, drive the transition: `start_transition` call → `copy_buffer_to_output!` → existing cast.
- `lib/electric/durable_streams/writer.ex:418` — stale comment refresh.

**Created:**
- `test/electric/queue_system/queue_test.exs` (Commit A).
- `test/electric/shape_cache/lmdb_queue_storage_test.exs` (Commit A, extended in Commit B).

---

## Commit A — Drop the snapshot queue

### Task 1: Queue module loses the snapshot queue

**Files:**
- Test: `test/electric/queue_system/queue_test.exs` (create)
- Modify: `lib/electric/queue_system/queue.ex`

- [ ] **Step 1: Write the failing tests**

Create `test/electric/queue_system/queue_test.exs`:

```elixir
defmodule Electric.QueueSystem.QueueTest do
  use ExUnit.Case, async: true

  alias Electric.Nifs.DiskQueue
  alias Electric.QueueSystem.Queue

  setup do
    dir = Path.join(System.tmp_dir!(), "queue_test_#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)
    %{dir: dir}
  end

  describe "new/1" do
    test "creates only output/ and streaming/ subdirectories", %{dir: dir} do
      _queue = Queue.new(dir)

      assert File.dir?(Path.join(dir, "output"))
      assert File.dir?(Path.join(dir, "streaming"))
      refute File.exists?(Path.join(dir, "snapshot"))
    end

    test "starts in :streaming mode", %{dir: dir} do
      assert %Queue{mode: :streaming} = Queue.new(dir)
    end
  end

  describe "push/2 + state machine" do
    test "in :streaming mode, writes to streaming queue and tracks last id", %{dir: dir} do
      q = Queue.new(dir) |> Queue.push("a") |> Queue.push("b")
      assert q.last_streaming_id != nil
    end

    test "in :buffering mode, writes accumulate in in-memory buffer", %{dir: dir} do
      q = Queue.new(dir) |> Queue.push("a")
      {q, _last_id} = Queue.start_buffering(q)

      q = q |> Queue.push("b") |> Queue.push("c")

      assert q.mode == :buffering
      assert q.buffer == ["b", "c"]
    end

    test "go_live flushes buffer to output and drops streaming handle", %{dir: dir} do
      q = Queue.new(dir) |> Queue.push("a")
      {q, _last_id} = Queue.start_buffering(q)
      q = q |> Queue.push("b") |> Queue.push("c")
      q = Queue.go_live(q)

      assert q.mode == :live
      assert q.buffer == []
      assert q.streaming == nil

      {:ok, entries} = DiskQueue.peek_n(q.output, 10)
      assert Enum.map(entries, fn {_id, v} -> v end) == ["b", "c"]
    end
  end

  describe "cleanup_temp/1" do
    test "removes streaming/ but leaves output/ intact", %{dir: dir} do
      q = Queue.new(dir) |> Queue.push("a")
      {q, _} = Queue.start_buffering(q)
      q = Queue.go_live(q)

      _q = Queue.cleanup_temp(q)

      refute File.exists?(Path.join(dir, "streaming"))
      assert File.dir?(Path.join(dir, "output"))
    end
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `mix test test/electric/queue_system/queue_test.exs`
Expected: FAIL — `Queue.new/1` still creates a `snapshot/` subdirectory; the `snapshot` field on the struct still exists.

- [ ] **Step 3: Rewrite `lib/electric/queue_system/queue.ex`**

Replace the entire file with:

```elixir
defmodule Electric.QueueSystem.Queue do
  @moduledoc """
  A processless multi-queue that manages snapshot + streaming replication
  data flow into a single output queue, backed by DiskQueue.

  The consumer process owns the Queue struct and passes it through function
  calls. The snapshotter task writes snapshot rows directly to the output
  DiskQueue (separate handle) and copies the streaming queue into output
  during the transition.

  ## States

  1. `:streaming` — replication writes go to the streaming queue.
  2. `:buffering` — writes accumulate in memory; the streaming queue is
     being copied into output.
  3. `:live` — writes go directly to the output queue.
  """

  alias Electric.Nifs.DiskQueue

  defstruct [
    :mode,
    :output,
    :streaming,
    :base_dir,
    buffer: [],
    last_streaming_id: nil
  ]

  @output_table :disk_queue_output_refs

  @doc """
  Create a new queue with output/ and streaming/ DiskQueues in `base_dir`.
  """
  def new(base_dir, _opts \\ []) do
    {:ok, output} = DiskQueue.open(Path.join(base_dir, "output"))
    {:ok, streaming} = DiskQueue.open(Path.join(base_dir, "streaming"))

    %__MODULE__{
      mode: :streaming,
      output: output,
      streaming: streaming,
      base_dir: base_dir
    }
  end

  @doc """
  Push a value to the queue. Behaviour depends on current mode.
  """
  def push(%__MODULE__{mode: :streaming} = q, value) do
    {:ok, id} = DiskQueue.push(q.streaming, value)
    %{q | last_streaming_id: id}
  end

  def push(%__MODULE__{mode: :buffering} = q, value) do
    %{q | buffer: q.buffer ++ [value]}
  end

  def push(%__MODULE__{mode: :live} = q, value) do
    {:ok, _id} = DiskQueue.push(q.output, value)
    q
  end

  @doc """
  Switch from `:streaming` to `:buffering` mode.
  Returns `{queue, last_streaming_id}`.
  """
  def start_buffering(%__MODULE__{mode: :streaming} = q) do
    {%{q | mode: :buffering}, q.last_streaming_id}
  end

  @doc """
  Switch from `:buffering` to `:live` mode. Flushes the in-memory buffer to
  the output queue and drops the streaming handle.
  """
  def go_live(%__MODULE__{mode: :buffering} = q) do
    if q.buffer != [] do
      {:ok, _seqs} = DiskQueue.batch_push(q.output, q.buffer)
    end

    %{q | mode: :live, buffer: [], streaming: nil}
  end

  @doc """
  Returns the output queue handle for the Writer.
  """
  def output(%__MODULE__{} = q), do: q.output

  @doc """
  Register the output queue handle so the Writer can look it up by shape
  handle. Called after transition to live mode.
  """
  def register_output(shape_handle, output_ref) do
    try do
      :ets.insert(@output_table, {shape_handle, output_ref})
    rescue
      _ ->
        :ets.new(@output_table, [:public, :named_table, :set])
        :ets.insert(@output_table, {shape_handle, output_ref})
    end
  end

  @doc """
  Look up a registered output queue handle by shape handle.
  """
  def lookup_output(shape_handle) do
    try do
      case :ets.lookup(@output_table, shape_handle) do
        [{_, ref}] -> {:ok, ref}
        [] -> :error
      end
    rescue
      _ -> :error
    end
  end

  @doc """
  Delete the temporary streaming queue directory.
  """
  def cleanup_temp(%__MODULE__{} = q) do
    File.rm_rf(Path.join(q.base_dir, "streaming"))
    q
  end

  @doc """
  Copy entries from the streaming queue into the output queue, up to and
  including `last_id`. Passing `nil` copies nothing. Returns `{:ok, count}`.
  """
  def copy_streaming_to_output(%__MODULE__{} = _q, nil), do: {:ok, 0}

  def copy_streaming_to_output(%__MODULE__{} = q, last_id) do
    do_copy_until(q.streaming, q.output, last_id, 0)
  end

  defp do_copy_until(src, dst, last_id, count) do
    case DiskQueue.peek_n(src, 100) do
      {:ok, []} ->
        {:ok, count}

      {:ok, records} ->
        {to_copy, _rest} = Enum.split_while(records, fn {id, _} -> id <= last_id end)

        if to_copy == [] do
          DiskQueue.rewind_peek(src)
          {:ok, count}
        else
          values = Enum.map(to_copy, fn {_id, data} -> data end)
          {:ok, _seqs} = DiskQueue.batch_push(dst, values)
          :ok = DiskQueue.commit_n(src, length(to_copy))

          {last_copied_id, _} = List.last(to_copy)

          if last_copied_id >= last_id do
            {:ok, count + length(to_copy)}
          else
            do_copy_until(src, dst, last_id, count + length(to_copy))
          end
        end
    end
  end
end
```

(Note: `copy_streaming_to_output/2` stays with the `%Queue{}` signature for Commit A; it gets switched to `/3` handles in Task 4.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `mix test test/electric/queue_system/queue_test.exs`
Expected: PASS.

- [ ] **Step 5: Ensure the rest of the codebase still compiles**

Run: `mix compile --warnings-as-errors`
Expected: FAIL — `LmdbQueueStorage.transition_to_live` still references the removed `Queue.copy_snapshot_to_output/1`, and `LmdbQueueStorage.make_new_snapshot!` still writes to a `snapshot/` subdirectory that `Queue.cleanup_temp` no longer touches. **Do not commit yet** — fix in Task 2.

---

### Task 2: LmdbQueueStorage — write snapshot directly to output, drop snapshot-copy step

**Files:**
- Test: `test/electric/shape_cache/lmdb_queue_storage_test.exs` (create)
- Modify: `lib/electric/shape_cache/lmdb_queue_storage.ex`

- [ ] **Step 1: Write the failing tests**

Create `test/electric/shape_cache/lmdb_queue_storage_test.exs`:

```elixir
defmodule Electric.ShapeCache.LmdbQueueStorageTest do
  use ExUnit.Case, async: true

  alias Electric.Nifs.DiskQueue
  alias Electric.ShapeCache.LmdbQueueStorage

  setup do
    dir = Path.join(System.tmp_dir!(), "lmdb_qs_test_#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)

    opts = %LmdbQueueStorage{
      base_path: dir,
      stack_id: "test_stack",
      shape_handle: "test_shape",
      chunk_bytes_threshold: 64 * 1024
    }

    %{dir: dir, opts: opts}
  end

  describe "make_new_snapshot!/2" do
    test "pushes rows into output/, never creates snapshot/", %{dir: dir, opts: opts} do
      stream = ["row1", "row2", "row3"]
      :ok = LmdbQueueStorage.make_new_snapshot!(stream, opts)

      assert File.dir?(Path.join([dir, "queue", "output"]))
      refute File.exists?(Path.join([dir, "queue", "snapshot"]))

      {:ok, q} = DiskQueue.open(Path.join([dir, "queue", "output"]))
      {:ok, entries} = DiskQueue.peek_n(q, 10)
      assert Enum.map(entries, fn {_id, v} -> v end) == ["row1", "row2", "row3"]
    end

    test "skips :chunk_boundary markers", %{opts: opts, dir: dir} do
      stream = ["a", :chunk_boundary, "b", :chunk_boundary, "c"]
      :ok = LmdbQueueStorage.make_new_snapshot!(stream, opts)

      {:ok, q} = DiskQueue.open(Path.join([dir, "queue", "output"]))
      {:ok, entries} = DiskQueue.peek_n(q, 10)
      assert Enum.map(entries, fn {_id, v} -> v end) == ["a", "b", "c"]
    end
  end
end
```

- [ ] **Step 2: Update `make_new_snapshot!` to write to `output/`**

In `lib/electric/shape_cache/lmdb_queue_storage.ex`, replace the `make_new_snapshot!` body (currently around lines 120–129):

```elixir
  @impl Storage
  def make_new_snapshot!(data_stream, %__MODULE__{} = opts) do
    output_dir = Path.join([opts.base_path, "queue", "output"])
    File.mkdir_p!(output_dir)

    {:ok, q} = DiskQueue.open(output_dir)
    count = write_snapshot_entries(q, data_stream, 0)

    Logger.debug("Wrote #{count} snapshot entries to #{output_dir}")
    :ok
  end
```

Leave `write_snapshot_entries/3` unchanged.

- [ ] **Step 3: Strip the snapshot-copy step out of `transition_to_live/1`**

In the same file, replace the `transition_to_live/1` definition (currently around lines 148–180) with:

```elixir
  @doc """
  Perform the queue state transition after snapshot data has been written
  directly into the output queue.

  1. `start_buffering` (captures streaming boundary, buffers new writes)
  2. Copy streaming queue (up to boundary) → output queue
  3. `go_live` (flush in-memory buffer, switch to direct output writes)
  """
  def transition_to_live(%WriterState{} = state) do
    queue = state.queue

    {queue, last_id} = Queue.start_buffering(queue)

    {:ok, stream_count} = Queue.copy_streaming_to_output(queue, last_id)

    if stream_count > 0 do
      Logger.debug("Copied #{stream_count} streaming entries to output")
    end

    queue = Queue.go_live(queue)
    queue = Queue.cleanup_temp(queue)

    Queue.register_output(state.opts.shape_handle, Queue.output(queue))

    Logger.debug("Queue transitioned to live mode")
    %{state | queue: queue}
  end
```

- [ ] **Step 4: Compile and run tests**

Run: `mix compile --warnings-as-errors`
Expected: success.

Run: `mix test test/electric/queue_system/queue_test.exs test/electric/shape_cache/lmdb_queue_storage_test.exs`
Expected: PASS.

---

### Task 3: Integration check + Commit A

- [ ] **Step 1: Run the router/integration suite**

Run: `mix test test/electric/plug/router_test.exs test/electric/plug/low_privilege_router_test.exs`
Expected: PASS. These tests exercise the full shape-create + snapshot + replication flow.

- [ ] **Step 2: Full suite as a sanity check**

Run: `mix test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/electric/queue_system/queue.ex \
        lib/electric/shape_cache/lmdb_queue_storage.ex \
        test/electric/queue_system/queue_test.exs \
        test/electric/shape_cache/lmdb_queue_storage_test.exs
git commit -m "refactor(sync-service): drop snapshot DiskQueue, snapshotter writes to output

The dedicated snapshot DiskQueue is gone. make_new_snapshot! pushes rows
directly into the output queue; transition_to_live only copies the
streaming buffer."
```

---

## Commit B — Move streaming copy off the consumer's message loop

### Task 4: Queue — `copy_streaming_to_output/3` taking explicit handles

**Files:**
- Test: `test/electric/queue_system/queue_test.exs` (extend)
- Modify: `lib/electric/queue_system/queue.ex`

- [ ] **Step 1: Write the failing test**

Append inside the `Electric.QueueSystem.QueueTest` module:

```elixir
  describe "copy_streaming_to_output/3" do
    test "copies src records up to and including last_id into dst", %{dir: dir} do
      {:ok, src} = DiskQueue.open(Path.join(dir, "src"))
      {:ok, dst} = DiskQueue.open(Path.join(dir, "dst"))

      {:ok, _} = DiskQueue.push(src, "a")
      {:ok, last_id} = DiskQueue.push(src, "b")
      {:ok, _} = DiskQueue.push(src, "c")

      assert {:ok, 2} = Queue.copy_streaming_to_output(src, dst, last_id)

      {:ok, entries} = DiskQueue.peek_n(dst, 10)
      assert Enum.map(entries, fn {_id, v} -> v end) == ["a", "b"]
    end

    test "nil last_id copies nothing", %{dir: dir} do
      {:ok, src} = DiskQueue.open(Path.join(dir, "src"))
      {:ok, dst} = DiskQueue.open(Path.join(dir, "dst"))
      {:ok, _} = DiskQueue.push(src, "a")

      assert {:ok, 0} = Queue.copy_streaming_to_output(src, dst, nil)

      {:ok, entries} = DiskQueue.peek_n(dst, 10)
      assert entries == []
    end
  end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `mix test test/electric/queue_system/queue_test.exs`
Expected: FAIL — `copy_streaming_to_output/3` does not exist.

- [ ] **Step 3: Replace `copy_streaming_to_output/2` with `/3`**

In `lib/electric/queue_system/queue.ex`, replace the existing
`copy_streaming_to_output/2` clauses (both the `nil` variant and the struct
variant) with:

```elixir
  @doc """
  Copy entries from a source DiskQueue to a destination DiskQueue, up to and
  including `last_id`. Passing `nil` copies nothing. Returns `{:ok, count}`.

  The caller owns the DiskQueue handles — used by the snapshotter task,
  which holds its own ephemeral handles on `streaming/` and `output/`.
  """
  def copy_streaming_to_output(_src, _dst, nil), do: {:ok, 0}

  def copy_streaming_to_output(src, dst, last_id) do
    do_copy_until(src, dst, last_id, 0)
  end
```

(`do_copy_until/4` itself is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `mix test test/electric/queue_system/queue_test.exs`
Expected: PASS — 8 tests green (6 from Task 1 + 2 new).

- [ ] **Step 5: Expect `mix compile` to fail**

Run: `mix compile --warnings-as-errors`
Expected: FAIL — `LmdbQueueStorage.transition_to_live/1` still calls the now-removed `Queue.copy_streaming_to_output/2`. Fix in Task 5. Do NOT commit yet.

---

### Task 5: LmdbQueueStorage — add `copy_buffer_to_output!`, remove `transition_to_live`

**Files:**
- Test: `test/electric/shape_cache/lmdb_queue_storage_test.exs` (extend)
- Modify: `lib/electric/shape_cache/lmdb_queue_storage.ex`

- [ ] **Step 1: Write the failing test**

Append inside the `Electric.ShapeCache.LmdbQueueStorageTest` module:

```elixir
  describe "copy_buffer_to_output!/2" do
    test "copies streaming rows up to last_id into output", %{dir: dir, opts: opts} do
      queue_dir = Path.join(dir, "queue")
      File.mkdir_p!(queue_dir)

      {:ok, streaming} = DiskQueue.open(Path.join(queue_dir, "streaming"))
      {:ok, _output} = DiskQueue.open(Path.join(queue_dir, "output"))

      {:ok, _} = DiskQueue.push(streaming, "s1")
      {:ok, last_id} = DiskQueue.push(streaming, "s2")
      {:ok, _} = DiskQueue.push(streaming, "s3")

      assert 2 = LmdbQueueStorage.copy_buffer_to_output!(opts, last_id)

      {:ok, out} = DiskQueue.open(Path.join(queue_dir, "output"))
      {:ok, entries} = DiskQueue.peek_n(out, 10)
      assert Enum.map(entries, fn {_id, v} -> v end) == ["s1", "s2"]
    end

    test "nil last_id is a no-op", %{dir: dir, opts: opts} do
      queue_dir = Path.join(dir, "queue")
      File.mkdir_p!(queue_dir)
      {:ok, _streaming} = DiskQueue.open(Path.join(queue_dir, "streaming"))
      {:ok, _output} = DiskQueue.open(Path.join(queue_dir, "output"))

      assert 0 = LmdbQueueStorage.copy_buffer_to_output!(opts, nil)
    end
  end
```

- [ ] **Step 2: Replace `transition_to_live/1` with `copy_buffer_to_output!/2`**

In `lib/electric/shape_cache/lmdb_queue_storage.ex`, delete the entire `transition_to_live/1` definition (the `@doc` and `def`, currently around lines 148–180) and replace it with:

```elixir
  @doc """
  Copy the streaming buffer into the output queue. Called from the snapshotter
  task after the snapshot has been written and the consumer has been flipped
  into `:buffering` mode.

  Opens fresh handles on `<base>/queue/streaming/` and `<base>/queue/output/`
  for the duration of the copy; they are dropped when this function returns.

  Returns the number of records copied.
  """
  def copy_buffer_to_output!(%__MODULE__{} = opts, last_id) do
    queue_dir = Path.join(opts.base_path, "queue")
    {:ok, src} = DiskQueue.open(Path.join(queue_dir, "streaming"))
    {:ok, dst} = DiskQueue.open(Path.join(queue_dir, "output"))

    {:ok, count} = Electric.QueueSystem.Queue.copy_streaming_to_output(src, dst, last_id)

    if count > 0, do: Logger.debug("Copied #{count} streaming entries to output")
    count
  end
```

- [ ] **Step 3: Run the new tests**

Run: `mix test test/electric/shape_cache/lmdb_queue_storage_test.exs`
Expected: PASS — 4 tests green.

- [ ] **Step 4: Expect the full codebase not to compile yet**

Run: `mix compile --warnings-as-errors`
Expected: FAIL — `Electric.Shapes.Consumer` still calls the now-removed `LmdbQueueStorage.transition_to_live/1`. Fix in Task 6.

---

### Task 6: Consumer — add `start_transition`, shrink the snapshot_data_written handler

**Files:**
- Modify: `lib/electric/shapes/consumer.ex`

- [ ] **Step 1: Add `start_transition/1` public function**

In `lib/electric/shapes/consumer.ex`, add next to the existing public helpers (e.g. just after `whereis/2` around line 85):

```elixir
  @doc """
  Called by the snapshotter task at the end of the snapshot, before copying
  the streaming buffer into the output queue.

  Flips the consumer's `Queue` into `:buffering` mode so that concurrent
  replication writes accumulate in-memory, and returns the id of the last
  record written to the streaming queue (the copy boundary).
  """
  @spec start_transition(pid()) :: {:ok, non_neg_integer() | nil}
  def start_transition(consumer) when is_pid(consumer) do
    GenServer.call(consumer, :start_transition, :infinity)
  end
```

- [ ] **Step 2: Add the `handle_call(:start_transition, ...)` clause**

Add next to the existing `handle_call` clauses (e.g. just below the `:await_snapshot_start` clause around line 157):

```elixir
  def handle_call(:start_transition, _from, state) do
    alias Electric.QueueSystem.Queue
    alias Electric.ShapeCache.LmdbQueueStorage

    case state.writer do
      {LmdbQueueStorage, %LmdbQueueStorage.WriterState{queue: queue} = ws} ->
        {queue, last_id} = Queue.start_buffering(queue)
        ws = %{ws | queue: queue}
        state = %{state | writer: {LmdbQueueStorage, ws}}
        {:reply, {:ok, last_id}, state, state.hibernate_after}

      _ ->
        {:reply, {:ok, nil}, state, state.hibernate_after}
    end
  end
```

- [ ] **Step 3: Shrink `handle_cast({:snapshot_data_written, ...}, ...)`**

Replace the existing clause (currently around lines 227–244) with:

```elixir
  def handle_cast({:snapshot_data_written, shape_handle}, %{shape_handle: shape_handle} = state) do
    alias Electric.QueueSystem.Queue
    alias Electric.ShapeCache.LmdbQueueStorage

    case state.writer do
      {LmdbQueueStorage, %LmdbQueueStorage.WriterState{queue: queue} = ws} ->
        Logger.debug("Resuming transition for #{shape_handle}")

        queue =
          queue
          |> Queue.go_live()
          |> Queue.cleanup_temp()

        Queue.register_output(shape_handle, Queue.output(queue))
        Electric.DurableStreams.Distributor.notify_writes(state.stack_id, shape_handle)

        ws = %{ws | queue: queue}
        {:noreply, %{state | writer: {LmdbQueueStorage, ws}}, state.hibernate_after}

      _ ->
        {:noreply, state, state.hibernate_after}
    end
  end
```

- [ ] **Step 4: Expect the codebase still not to compile**

Run: `mix compile --warnings-as-errors`
Expected: success on `lib/`, but running the system now would be broken because the snapshotter hasn't been wired to call `start_transition` yet. Fix in Task 7.

---

### Task 7: Snapshotter — drive the transition + Writer comment refresh

**Files:**
- Modify: `lib/electric/shapes/consumer/snapshotter.ex`
- Modify: `lib/electric/durable_streams/writer.ex:418`

- [ ] **Step 1: Replace the tail of the snapshot pipeline**

In `lib/electric/shapes/consumer/snapshotter.ex`, find the three lines at the end of the `query_fn` body (around lines 270–272):

```elixir
        # Notify the consumer that snapshot data is fully written to storage,
        # so it can perform the queue copy transition (for LmdbQueueStorage).
        GenServer.cast(consumer, {:snapshot_data_written, shape_handle})
```

and replace them with:

```elixir
        drive_post_snapshot_transition(storage, consumer, shape_handle)
```

- [ ] **Step 2: Add the `drive_post_snapshot_transition/3` helper**

Add below `record_snapshot_metrics/4` at the bottom of the module:

```elixir
  defp drive_post_snapshot_transition(storage, consumer, shape_handle) do
    alias Electric.ShapeCache.LmdbQueueStorage

    case storage do
      %LmdbQueueStorage{} = opts ->
        {:ok, last_id} = Electric.Shapes.Consumer.start_transition(consumer)
        _count = LmdbQueueStorage.copy_buffer_to_output!(opts, last_id)
        GenServer.cast(consumer, {:snapshot_data_written, shape_handle})

      _ ->
        GenServer.cast(consumer, {:snapshot_data_written, shape_handle})
    end
  end
```

- [ ] **Step 3: Refresh the stale comment in the Writer**

In `lib/electric/durable_streams/writer.ex` around line 418, replace:

```elixir
        # Look up the shared output queue handle registered by the Consumer
        # during transition_to_live. This ensures we share the same DiskQueue
        # reference (and its peek/commit cursors) instead of opening a
        # separate handle that can't commit the Consumer's records.
```

with:

```elixir
        # Look up the shared output queue handle registered by the Consumer
        # when it handled the {:snapshot_data_written, ...} cast. Sharing the
        # handle keeps peek/commit cursors consistent across producer and
        # writer.
```

- [ ] **Step 4: Compile + run the unit suites**

Run: `mix compile --warnings-as-errors`
Expected: success.

Run: `mix test test/electric/queue_system/queue_test.exs test/electric/shape_cache/lmdb_queue_storage_test.exs`
Expected: PASS.

- [ ] **Step 5: Run the integration suites**

Run: `mix test test/electric/plug/router_test.exs test/electric/plug/low_privilege_router_test.exs`
Expected: PASS.

- [ ] **Step 6: Run the full sync-service test suite**

Run: `mix test`
Expected: PASS.

- [ ] **Step 7: Verify no dead references remain**

Run: `grep -rn "transition_to_live\|copy_snapshot_to_output\|push_snapshot" lib test`
Expected: no matches.

Run: `grep -rn "queue/snapshot\|\"snapshot\"" lib/electric/queue_system lib/electric/shape_cache`
Expected: no matches (the `snapshot_started` marker file is fine — it's not a directory).

- [ ] **Step 8: Commit B**

```bash
git add lib/electric/queue_system/queue.ex \
        lib/electric/shape_cache/lmdb_queue_storage.ex \
        lib/electric/shapes/consumer.ex \
        lib/electric/shapes/consumer/snapshotter.ex \
        lib/electric/durable_streams/writer.ex \
        test/electric/queue_system/queue_test.exs \
        test/electric/shape_cache/lmdb_queue_storage_test.exs
git commit -m "refactor(sync-service): snapshotter drives streaming→output copy

The disk-to-disk copy runs in the snapshotter task instead of inside
the consumer's message loop. Snapshotter calls start_transition on the
consumer to flip to :buffering and learn the copy boundary, copies the
streaming buffer itself, then the existing snapshot_data_written cast
triggers the final go-live/cleanup/register/notify work."
```

---

## Verification checklist

After all tasks complete:

- [ ] `mix compile --warnings-as-errors` succeeds.
- [ ] `mix test test/electric/queue_system/queue_test.exs` — 8 tests pass.
- [ ] `mix test test/electric/shape_cache/lmdb_queue_storage_test.exs` — 4 tests pass.
- [ ] `mix test test/electric/plug/router_test.exs` passes.
- [ ] `mix test` (full suite) passes.
- [ ] `grep -rn "transition_to_live\|copy_snapshot_to_output\|push_snapshot" lib test` returns no matches.
- [ ] Running the service and creating a shape: only `output/` and `streaming/` appear under `<shape_dir>/queue/` during snapshot; only `output/` remains after transition.
