defmodule Electric.QueueSystem.Queue do
  @moduledoc """
  A processless multi-queue that manages snapshot + streaming replication
  data flow into a single output queue, backed by DiskQueue.

  The consumer process owns the Queue struct and passes it through function calls.

  ## States

  1. `:streaming` — writes go to streaming queue, snapshot writes go to snapshot queue
  2. `:buffering` — writes accumulate in memory, streaming queue is being copied to output
  3. `:live` — writes go directly to output queue
  """

  alias Electric.Nifs.DiskQueue

  defstruct [
    :mode,
    :output,
    :streaming,
    :snapshot,
    :base_dir,
    buffer: [],
    last_streaming_id: nil
  ]

  @doc """
  Create a new queue with 3 DiskQueues in `base_dir`.
  """
  def new(base_dir, _opts \\ []) do
    {:ok, output} = DiskQueue.open(Path.join(base_dir, "output"))
    {:ok, streaming} = DiskQueue.open(Path.join(base_dir, "streaming"))
    {:ok, snapshot} = DiskQueue.open(Path.join(base_dir, "snapshot"))

    %__MODULE__{
      mode: :streaming,
      output: output,
      streaming: streaming,
      snapshot: snapshot,
      base_dir: base_dir
    }
  end

  @doc """
  Push a value to the queue. Behavior depends on current mode:
  - `:streaming` → pushes to streaming queue
  - `:buffering` → appends to in-memory buffer
  - `:live` → pushes directly to output queue
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
  Push a value to the snapshot queue.
  """
  def push_snapshot(%__MODULE__{} = q, value) do
    {:ok, _id} = DiskQueue.push(q.snapshot, value)
    q
  end

  @doc """
  Switch from `:streaming` to `:buffering` mode.
  Returns `{queue, last_streaming_id}` so the caller knows the boundary
  for the streaming queue copy.
  """
  def start_buffering(%__MODULE__{mode: :streaming} = q) do
    {%{q | mode: :buffering}, q.last_streaming_id}
  end

  @doc """
  Switch from `:buffering` to `:live` mode.
  Flushes the in-memory buffer to the output queue.
  """
  def go_live(%__MODULE__{mode: :buffering} = q) do
    if q.buffer != [] do
      {:ok, _seqs} = DiskQueue.batch_push(q.output, q.buffer)
    end

    %{q | mode: :live, buffer: [], streaming: nil, snapshot: nil}
  end

  @output_table :disk_queue_output_refs

  @doc """
  Returns the output queue handle for the Writer.
  """
  def output(%__MODULE__{} = q), do: q.output

  @doc """
  Register the output queue handle so the Writer can look it up
  by shape handle. Called after transition to live mode.
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
  Returns `{:ok, ref}` or `:error`.
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
  Delete the temporary snapshot and streaming queue directories.
  """
  def cleanup_temp(%__MODULE__{} = q) do
    File.rm_rf(Path.join(q.base_dir, "snapshot"))
    File.rm_rf(Path.join(q.base_dir, "streaming"))
    q
  end

  @doc """
  Copy all entries from the snapshot queue to the output queue.
  Returns `{:ok, count}`.
  """
  def copy_snapshot_to_output(%__MODULE__{} = q) do
    copy_all(q.snapshot, q.output)
  end

  @doc """
  Copy entries from the streaming queue to the output queue,
  up to and including `last_id`. Returns `{:ok, count}`.
  """
  def copy_streaming_to_output(%__MODULE__{} = _q, nil), do: {:ok, 0}

  def copy_streaming_to_output(%__MODULE__{} = q, last_id) do
    copy_until(q.streaming, q.output, last_id)
  end

  # ------------------------------------------------------------------
  # Internal copy helpers
  # ------------------------------------------------------------------

  defp copy_all(src, dst) do
    do_copy_all(src, dst, 0)
  end

  defp do_copy_all(src, dst, count) do
    case DiskQueue.peek_n(src, 100) do
      {:ok, []} ->
        {:ok, count}

      {:ok, records} ->
        values = Enum.map(records, fn {_id, data} -> data end)
        {:ok, _seqs} = DiskQueue.batch_push(dst, values)
        :ok = DiskQueue.commit_n(src, length(records))
        do_copy_all(src, dst, count + length(records))
    end
  end

  defp copy_until(src, dst, last_id) do
    do_copy_until(src, dst, last_id, 0)
  end

  defp do_copy_until(src, dst, last_id, count) do
    case DiskQueue.peek_n(src, 100) do
      {:ok, []} ->
        {:ok, count}

      {:ok, records} ->
        # Take only records up to and including last_id
        {to_copy, _rest} = Enum.split_while(records, fn {id, _} -> id <= last_id end)

        if to_copy == [] do
          # Rewind the peek cursor since we didn't commit
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
