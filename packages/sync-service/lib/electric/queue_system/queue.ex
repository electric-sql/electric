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
  Create a new queue with a streaming/ DiskQueue in `base_dir`.

  The output/ DiskQueue handle is opened lazily in `go_live/1` — by then the
  snapshotter task has finished writing snapshot rows directly into
  `output/` and has copied the streaming buffer into it, so a fresh handle
  picks up the correct tail position. Opening the output handle here would
  cache an empty-queue tail that becomes stale during the snapshot and
  corrupts the file when reused for the buffer flush.
  """
  def new(base_dir, _opts \\ []) do
    {:ok, streaming} = DiskQueue.open(Path.join(base_dir, "streaming"))

    %__MODULE__{
      mode: :streaming,
      output: nil,
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
    %{q | buffer: [value | q.buffer]}
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
  Switch from `:buffering` to `:live` mode. Opens a fresh handle on
  `output/` (so it sees writes made by the snapshotter), flushes the
  in-memory buffer into it, and drops the streaming handle.
  """
  def go_live(%__MODULE__{mode: :buffering} = q) do
    {:ok, output} = DiskQueue.open(Path.join(q.base_dir, "output"))

    if q.buffer != [] do
      {:ok, _seqs} = DiskQueue.batch_push(output, Enum.reverse(q.buffer))
    end

    %{q | mode: :live, output: output, buffer: [], streaming: nil}
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
  Copy entries from a source DiskQueue to a destination DiskQueue, up to and
  including `last_id`. Passing `nil` copies nothing. Returns `{:ok, count}`.

  The caller owns the DiskQueue handles — used by the snapshotter task,
  which holds its own ephemeral handles on `streaming/` and `output/`.
  """
  def copy_streaming_to_output(_src, _dst, nil), do: {:ok, 0}

  def copy_streaming_to_output(src, dst, last_id) do
    do_copy_until(src, dst, last_id, 0)
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
