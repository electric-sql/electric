defmodule Electric.QueueSystem.Queue do
  @moduledoc """
  A processless multi-database LMDB queue that manages snapshot + streaming
  replication data flow into a single output queue.

  The consumer process owns the Queue struct and passes it through function calls.
  The reader just holds the output_db ref.

  ## States

  1. `:streaming` — writes go to streaming_db, snapshot writes go to snapshot_db
  2. `:buffering` — writes accumulate in memory, streaming_db is being copied to output
  3. `:live` — writes go directly to output_db
  """

  alias Electric.QueueSystem.Key
  alias Electric.Nifs.LmdbNif

  @map_size :erlang.bsl(4, 30)

  defstruct [
    :mode,
    :output_db,
    :streaming_db,
    :snapshot_db,
    :base_dir,
    buffer: [],
    streaming_seq: 0,
    snapshot_seq: 0
  ]

  @doc """
  Create a new queue with 3 LMDB databases in `base_dir`.
  """
  def new(base_dir, opts \\ []) do
    map_size = opts[:map_size] || @map_size

    output_db = LmdbNif.open(Path.join(base_dir, "output"), map_size, 1)
    streaming_db = LmdbNif.open(Path.join(base_dir, "streaming"), map_size, 1)
    snapshot_db = LmdbNif.open(Path.join(base_dir, "snapshot"), map_size, 1)

    %__MODULE__{
      mode: :streaming,
      output_db: output_db,
      streaming_db: streaming_db,
      snapshot_db: snapshot_db,
      base_dir: base_dir
    }
  end

  @doc """
  Write streaming entries to the queue. Behavior depends on current mode:
  - `:streaming` → writes to streaming_db
  - `:buffering` → appends to in-memory buffer
  - `:live` → writes directly to output_db
  """
  def write(%__MODULE__{mode: :streaming} = q, entries) do
    {pairs, seq} = key_entries(entries, q.streaming_seq, &Key.streaming_key/1)
    :ok = LmdbNif.batch_put(q.streaming_db, pairs)
    %{q | streaming_seq: seq}
  end

  def write(%__MODULE__{mode: :buffering} = q, entries) do
    {pairs, seq} = key_entries(entries, q.streaming_seq, &Key.streaming_key/1)
    %{q | buffer: q.buffer ++ pairs, streaming_seq: seq}
  end

  def write(%__MODULE__{mode: :live} = q, entries) do
    {pairs, seq} = key_entries(entries, q.streaming_seq, &Key.streaming_key/1)
    :ok = LmdbNif.batch_put(q.output_db, pairs)
    %{q | streaming_seq: seq}
  end

  @doc """
  Write entries with explicit keys to the queue.
  `keyed_entries` is a list of `{key, value}` tuples.
  """
  def write_keyed(%__MODULE__{mode: :streaming} = q, keyed_entries) do
    :ok = LmdbNif.batch_put(q.streaming_db, keyed_entries)
    q
  end

  def write_keyed(%__MODULE__{mode: :buffering} = q, keyed_entries) do
    %{q | buffer: q.buffer ++ keyed_entries}
  end

  def write_keyed(%__MODULE__{mode: :live} = q, keyed_entries) do
    :ok = LmdbNif.batch_put(q.output_db, keyed_entries)
    q
  end

  @doc """
  Returns a `Electric.QueueSystem.SnapshotCollector` that implements `Collectable`.
  """
  def snapshot_collector(%__MODULE__{} = q, consumer_pid) do
    %Electric.QueueSystem.SnapshotCollector{
      snapshot_db: q.snapshot_db,
      consumer_pid: consumer_pid,
      seq: q.snapshot_seq
    }
  end

  @doc """
  Switch from `:streaming` to `:buffering` mode.
  Returns `{queue, last_streaming_key}` so the caller knows the boundary
  for the streaming DB copy.
  """
  def start_buffering(%__MODULE__{mode: :streaming} = q) do
    last_key =
      if q.streaming_seq > 0 do
        Key.streaming_key(q.streaming_seq - 1)
      end

    {%{q | mode: :buffering}, last_key}
  end

  @doc """
  Switch from `:buffering` to `:live` mode.
  Flushes the in-memory buffer to the output_db.
  """
  def go_live(%__MODULE__{mode: :buffering} = q) do
    if q.buffer != [] do
      :ok = LmdbNif.batch_put(q.output_db, q.buffer)
    end

    %{q | mode: :live, buffer: [], streaming_db: nil, snapshot_db: nil}
  end

  @doc """
  Returns the output DB handle for readers.
  """
  def output_db(%__MODULE__{} = q), do: q.output_db

  @doc """
  Delete the temporary snapshot and streaming DB directories.
  """
  def cleanup_temp(%__MODULE__{} = q) do
    File.rm_rf(Path.join(q.base_dir, "snapshot"))
    File.rm_rf(Path.join(q.base_dir, "streaming"))
    q
  end

  defp key_entries(entries, start_seq, key_fun) do
    {pairs, seq} =
      Enum.reduce(entries, {[], start_seq}, fn value, {acc, seq} ->
        {[{key_fun.(seq), value} | acc], seq + 1}
      end)

    {Enum.reverse(pairs), seq}
  end
end
