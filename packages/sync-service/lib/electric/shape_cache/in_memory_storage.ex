defmodule Electric.ShapeCache.InMemoryStorage do
  use Agent

  alias Electric.ConcurrentStream
  alias Electric.Replication.LogOffset
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.ShapeCache.Storage

  alias __MODULE__, as: MS

  import Electric.Replication.LogOffset, only: :macros

  @behaviour Electric.ShapeCache.Storage

  @snapshot_start_index 0
  @snapshot_end_index :end
  @pg_snapshot_key :pg_snapshot
  @latest_offset_key :latest_offset

  defstruct [
    :table_base_name,
    :snapshot_table,
    :log_table,
    :chunk_checkpoint_table,
    :shape_handle,
    :stack_id
  ]

  @impl Electric.ShapeCache.Storage
  def shared_opts(opts) do
    stack_id = Access.fetch!(opts, :stack_id)
    table_base_name = Access.get(opts, :table_base_name, inspect(__MODULE__))

    %{
      table_base_name: table_base_name,
      stack_id: stack_id
    }
  end

  def name(stack_id, shape_handle) when is_binary(shape_handle) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, shape_handle)
  end

  @impl Electric.ShapeCache.Storage
  def for_shape(shape_handle, %{shape_handle: shape_handle} = opts) do
    opts
  end

  def for_shape(shape_handle, %{
        table_base_name: table_base_name,
        stack_id: stack_id
      }) do
    snapshot_table_name = :"#{table_base_name}.Snapshot_#{shape_handle}"
    log_table_name = :"#{table_base_name}.Log_#{shape_handle}"

    chunk_checkpoint_table_name =
      :"#{table_base_name}.ChunkCheckpoint_#{shape_handle}"

    %__MODULE__{
      table_base_name: table_base_name,
      shape_handle: shape_handle,
      snapshot_table: snapshot_table_name,
      log_table: log_table_name,
      chunk_checkpoint_table: chunk_checkpoint_table_name,
      stack_id: stack_id
    }
  end

  @impl Electric.ShapeCache.Storage
  def stack_start_link(_), do: :ignore

  @impl Electric.ShapeCache.Storage
  def start_link(%MS{} = opts) do
    if is_nil(opts.shape_handle),
      do: raise(Storage.Error, "cannot start an un-attached storage instance")

    if is_nil(opts.stack_id), do: raise(Storage.Error, "stack_id cannot be nil")

    Agent.start_link(
      fn ->
        %{
          snapshot_table: storage_table(opts.snapshot_table),
          log_table: storage_table(opts.log_table),
          chunk_checkpoint_table: storage_table(opts.chunk_checkpoint_table)
        }
      end,
      name: name(opts.stack_id, opts.shape_handle)
    )
  end

  defp storage_table(name) do
    :ets.new(name, [:public, :named_table, :ordered_set])
  end

  @impl Electric.ShapeCache.Storage
  def init_writer!(%MS{} = opts, _shape_definition), do: opts

  @impl Electric.ShapeCache.Storage
  def fetch_latest_offset(%MS{} = opts) do
    {:ok, current_offset(opts)}
  end

  @impl Electric.ShapeCache.Storage
  def fetch_pg_snapshot(%MS{} = opts) do
    {:ok, pg_snapshot(opts)}
  end

  defp pg_snapshot(opts) do
    case :ets.lookup(opts.snapshot_table, @pg_snapshot_key) do
      [{@pg_snapshot_key, pg_snapshot}] -> pg_snapshot
      [] -> nil
    end
  end

  defp current_offset(opts) do
    with [] <- :ets.lookup(opts.snapshot_table, @latest_offset_key),
         [] <- :ets.lookup(opts.snapshot_table, snapshot_end()) do
      LogOffset.last_before_real_offsets()
    else
      [{_, offset}] -> offset
    end
  end

  @impl Electric.ShapeCache.Storage
  def set_pg_snapshot(pg_snapshot, %MS{} = opts) do
    :ets.insert(opts.snapshot_table, {@pg_snapshot_key, pg_snapshot})
    :ok
  end

  @impl Electric.ShapeCache.Storage
  def get_all_stored_shape_handles(_opts), do: {:ok, MapSet.new()}

  @impl Electric.ShapeCache.Storage
  def get_total_disk_usage(_opts), do: 0

  @impl Electric.ShapeCache.Storage
  def snapshot_started?(%MS{} = opts) do
    try do
      :ets.member(opts.snapshot_table, snapshot_start())
    rescue
      ArgumentError ->
        false
    end
  end

  defp snapshot_key(chunk_key, index) do
    {chunk_key, index}
  end

  defp snapshot_chunk_start(chunk_key), do: snapshot_key(chunk_key, @snapshot_start_index)
  defp snapshot_chunk_end(chunk_key), do: snapshot_key(chunk_key, @snapshot_end_index)

  defp snapshot_start(), do: snapshot_chunk_start(storage_offset(LogOffset.before_all()))

  defp snapshot_end(),
    do: snapshot_chunk_end(storage_offset(LogOffset.last_before_real_offsets()))

  defp get_offset_indexed_stream(offset, max_offset, offset_indexed_table) do
    offset = storage_offset(offset)
    max_offset = storage_offset(max_offset)

    Stream.unfold(offset, fn offset ->
      case :ets.next_lookup(offset_indexed_table, {:offset, offset}) do
        :"$end_of_table" ->
          nil

        {{:offset, position}, _} when position > max_offset ->
          nil

        {{:offset, position}, [{_, item}]} ->
          {item, position}
      end
    end)
  end

  @snapshot_boundary_offset LogOffset.last_before_real_offsets()
  @impl Electric.ShapeCache.Storage
  def get_log_stream(offset, max_offset, %MS{} = opts)
      when is_log_offset_lt(offset, @snapshot_boundary_offset) do
    case :ets.lookup_element(opts.snapshot_table, snapshot_end(), 2, nil) do
      nil -> stream_from_snapshot(offset, max_offset, opts)
      max when is_log_offset_lt(offset, max) -> stream_from_snapshot(offset, max_offset, opts)
      _ -> get_offset_indexed_stream(offset, max_offset, opts.log_table)
    end
  end

  def get_log_stream(offset, max_offset, %MS{} = opts) do
    get_offset_indexed_stream(offset, max_offset, opts.log_table)
  end

  defp stream_from_snapshot(offset, max_offset, %MS{} = opts) do
    ConcurrentStream.stream_to_end(
      excluded_start_key: snapshot_chunk_end(storage_offset(offset)),
      end_marker_key: snapshot_chunk_end(storage_offset(max_offset)),
      poll_time_in_ms: 10,
      stream_fun: fn excluded_start_key, included_end_key ->
        if !snapshot_started?(opts), do: raise(Storage.Error, "Snapshot no longer available")

        :ets.select(
          opts.snapshot_table,
          [
            {{:"$1", :"$2"},
             [
               {:andalso, {:>, :"$1", {:const, excluded_start_key}},
                {:"=<", :"$1", {:const, included_end_key}}}
             ], [{{:"$1", :"$2"}}]}
          ]
        )
      end
    )
    |> Stream.map(fn {_, item} -> item end)
    |> Stream.reject(&is_nil/1)
  end

  @impl Electric.ShapeCache.Storage
  def get_chunk_end_log_offset(offset, _) when is_min_offset(offset),
    do: LogOffset.first()

  def get_chunk_end_log_offset(offset, %MS{} = opts) do
    case :ets.next_lookup(opts.chunk_checkpoint_table, storage_offset(offset)) do
      :"$end_of_table" ->
        nil

      {chunk_offset, _} ->
        LogOffset.new(chunk_offset)
    end
  end

  @impl Electric.ShapeCache.Storage
  def make_new_snapshot!(data_stream, %MS{stack_id: stack_id} = opts) do
    OpenTelemetry.with_span(
      "storage.make_new_snapshot",
      [storage_impl: "in_memory", "shape.handle": opts.shape_handle],
      stack_id,
      fn ->
        table = opts.snapshot_table
        chunk_checkpoint_table = opts.chunk_checkpoint_table

        data_stream
        |> Stream.with_index(1)
        |> Stream.transform(
          fn -> 0 end,
          fn
            {:chunk_boundary, _}, chunk_num ->
              chunk_offset = storage_offset(LogOffset.new(0, chunk_num))

              {[
                 {chunk_offset, :snapshot_checkpoint},
                 {snapshot_chunk_end(chunk_offset), nil}
               ], chunk_num + 1}

            {line, index}, chunk_num ->
              chunk_offset = storage_offset(LogOffset.new(0, chunk_num))
              {[{snapshot_key(chunk_offset, index), line}], chunk_num}
          end,
          fn chunk_num ->
            chunk_offset = storage_offset(LogOffset.new(0, chunk_num))

            {[{chunk_offset, :snapshot_checkpoint}, {snapshot_chunk_end(chunk_offset), nil}],
             chunk_num}
          end,
          fn _ -> nil end
        )
        |> Stream.chunk_every(500)
        |> Stream.flat_map(fn chunk ->
          {checkpoints, data} = Enum.split_with(chunk, &match?({_, :snapshot_checkpoint}, &1))

          :ets.insert(chunk_checkpoint_table, checkpoints)
          :ets.insert(table, data)
          Enum.map(checkpoints, &elem(&1, 0))
        end)
        |> Enum.max()
        |> then(fn max_chunk ->
          :ets.insert(table, {snapshot_end(), LogOffset.new(max_chunk)})
        end)

        :ok
      end
    )
  end

  @impl Electric.ShapeCache.Storage
  def mark_snapshot_as_started(%MS{} = opts) do
    :ets.insert(opts.snapshot_table, {snapshot_start(), 0})
    :ok
  end

  @impl Electric.ShapeCache.Storage
  def append_to_log!(log_items, %MS{} = opts) do
    log_table = opts.log_table
    chunk_checkpoint_table = opts.chunk_checkpoint_table

    {processed_log_items, last_offset} =
      Enum.map_reduce(log_items, nil, fn
        {:chunk_boundary, offset}, curr ->
          {{storage_offset(offset), :checkpoint}, curr}

        {offset, _key, _op_type, json_log_item}, _ ->
          {{{:offset, storage_offset(offset)}, json_log_item}, offset}
      end)

    processed_log_items
    |> Enum.split_with(fn item -> match?({_, :checkpoint}, item) end)
    |> then(fn {checkpoints, log_items} ->
      :ets.insert(chunk_checkpoint_table, checkpoints)
      :ets.insert(log_table, log_items)
      :ets.insert(opts.snapshot_table, {@latest_offset_key, last_offset})
    end)

    send(self(), {Storage, :flushed, elem(List.last(log_items), 0)})

    opts
  end

  @impl Electric.ShapeCache.Storage
  def supports_txn_fragment_streaming?, do: false

  @impl Electric.ShapeCache.Storage
  def append_fragment_to_log!(_log_items, %MS{} = _opts) do
    raise "Not implemented; InMemoryStorage does not support txn fragment streaming. Use PureFileStorage instead."
  end

  @impl Electric.ShapeCache.Storage
  def signal_txn_commit!(_xid, %MS{} = _opts) do
    raise "Not implemented; InMemoryStorage does not support txn fragment streaming. Use PureFileStorage instead."
  end

  @impl Electric.ShapeCache.Storage
  def write_move_in_snapshot!(stream, name, %MS{log_table: log_table}) do
    stream
    |> Stream.map(fn [key, tags, json] -> {{:movein, {name, key}}, {tags, json}} end)
    |> Stream.chunk_every(500)
    |> Stream.each(&:ets.insert(log_table, &1))
    |> Stream.run()

    :ok
  end

  @impl Electric.ShapeCache.Storage
  def append_control_message!(control_message, %MS{log_table: log_table} = opts) do
    initial_offset = current_offset(opts)
    new_offset = LogOffset.increment(initial_offset)

    :ets.insert(log_table, {{:offset, storage_offset(new_offset)}, control_message})
    :ets.insert(opts.snapshot_table, {@latest_offset_key, new_offset})

    {{initial_offset, new_offset}, opts}
  end

  @impl Electric.ShapeCache.Storage
  def append_move_in_snapshot_to_log!(name, %MS{log_table: log_table} = opts) do
    initial_offset = current_offset(opts)
    ref = make_ref()

    Stream.unfold({initial_offset, {:movein, {name, nil}}}, fn {offset, last_key} ->
      case :ets.next_lookup(log_table, last_key) do
        {{:movein, {^name, _}} = key, [{_, {_tags, json}}]} ->
          offset = LogOffset.increment(offset)
          {{{:offset, storage_offset(offset)}, json}, {offset, key}}

        _ ->
          send(self(), {ref, offset})
          nil
      end
    end)
    |> Stream.chunk_every(500)
    |> Stream.each(&:ets.insert(log_table, &1))
    |> Stream.run()

    :ets.match_delete(log_table, {{:movein, {name, :_}}, :_})

    resulting_offset = receive(do: ({^ref, offset} -> offset))

    {{initial_offset, resulting_offset}, opts}
  end

  @impl Electric.ShapeCache.Storage
  def append_move_in_snapshot_to_log_filtered!(
        name,
        %MS{log_table: log_table} = opts,
        touch_tracker,
        snapshot,
        tags_to_skip
      ) do
    initial_offset = current_offset(opts)
    ref = make_ref()

    Stream.unfold({initial_offset, {:movein, {name, nil}}}, fn {offset, last_key} ->
      case :ets.next_lookup(log_table, last_key) do
        {{:movein, {^name, _}} = ets_key, [{{:movein, {^name, key}}, {tags, json}}]} ->
          # Check if this row should be skipped
          if (tags != [] and Enum.all?(tags, &MapSet.member?(tags_to_skip, &1))) or
               Electric.Shapes.Consumer.MoveIns.should_skip_query_row?(
                 touch_tracker,
                 snapshot,
                 key
               ) do
            # Skip this row - don't increment offset, but advance to next key
            {[], {offset, ets_key}}
          else
            offset = LogOffset.increment(offset)
            {{{:offset, storage_offset(offset)}, json}, {offset, ets_key}}
          end

        _ ->
          send(self(), {ref, offset})
          nil
      end
    end)
    |> Stream.reject(&(&1 == []))
    |> Stream.chunk_every(500)
    |> Stream.each(&:ets.insert(log_table, &1))
    |> Stream.run()

    :ets.match_delete(log_table, {{:movein, {name, :_}}, :_})

    resulting_offset = receive(do: ({^ref, offset} -> offset))

    {{initial_offset, resulting_offset}, opts}
  end

  @impl Electric.ShapeCache.Storage
  def cleanup!(%MS{} = opts) do
    for table <- tables(opts),
        do: ignoring_exceptions(fn -> :ets.delete(table) end, ArgumentError)

    :ok
  end

  @impl Electric.ShapeCache.Storage
  def cleanup!(%MS{shape_handle: shape_handle} = opts, shape_handle) do
    cleanup!(opts)
  end

  def cleanup!(%{table_base_name: _table_base_name, stack_id: _stack_id} = opts, shape_handle) do
    shape_handle
    |> for_shape(opts)
    |> cleanup!()
  end

  @impl Electric.ShapeCache.Storage
  def cleanup_all!(%{table_base_name: table_base_name} = _opts) do
    :ets.all()
    |> Enum.filter(&is_atom/1)
    |> Enum.filter(fn name ->
      String.starts_with?(Atom.to_string(name), "#{table_base_name}.")
    end)
    |> Enum.each(&ignoring_exceptions(fn -> :ets.delete(&1) end, ArgumentError))

    :ok
  end

  defp ignoring_exceptions(fun, exception) do
    fun.()
  rescue
    error ->
      if error.__struct__ == exception do
        :ok
      else
        reraise(error, __STACKTRACE__)
      end
  end

  defp tables(%MS{} = opts) do
    [
      opts.snapshot_table,
      opts.log_table,
      opts.chunk_checkpoint_table
    ]
  end

  # Turns a LogOffset into a tuple representation
  # for storing in the ETS table
  defp storage_offset(offset) do
    LogOffset.to_tuple(offset)
  end

  @impl Electric.ShapeCache.Storage
  def compact(_opts, _offset), do: :ok

  @impl Electric.ShapeCache.Storage
  def terminate(_opts), do: :ok

  @impl Electric.ShapeCache.Storage
  def hibernate(opts), do: opts
end
