defmodule Electric.ShapeCache.InMemoryStorage do
  use Agent

  alias Electric.ShapeCache.LogChunker
  alias Electric.ConcurrentStream
  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Querying
  alias Electric.Telemetry.OpenTelemetry

  @behaviour Electric.ShapeCache.Storage

  @snapshot_offset LogOffset.first()

  def shared_opts(opts) do
    snapshot_ets_table_name = Access.get(opts, :snapshot_ets_table, :snapshot_ets_table)
    log_ets_table_name = Access.get(opts, :log_ets_table, :log_ets_table)

    {:ok,
     %{
       snapshot_ets_table_base: snapshot_ets_table_name,
       log_ets_table_base: log_ets_table_name,
       snapshot_ets_table: nil,
       log_ets_table: nil,
       shape_id: nil
     }}
  end

  def name(shape_id) when is_binary(shape_id) do
    Electric.Application.process_name(__MODULE__, shape_id)
  end

  def start_link(compiled_opts) do
    if is_nil(compiled_opts.shape_id), do: raise("cannot start an un-attached storage instance")

    LogChunker.start_link(compiled_opts)

    Agent.start_link(
      fn ->
        %{
          snapshot_ets_table:
            :ets.new(compiled_opts.snapshot_ets_table, [:public, :named_table, :ordered_set]),
          log_ets_table:
            :ets.new(compiled_opts.log_ets_table, [:public, :named_table, :ordered_set])
        }
      end,
      name: name(compiled_opts.shape_id)
    )
  end

  def for_shape(shape_id, %{shape_id: shape_id} = compiled_opts) do
    compiled_opts
  end

  def for_shape(shape_id, compiled_opts) do
    snapshot_ets_table_name = Map.fetch!(compiled_opts, :snapshot_ets_table_base)
    log_ets_table_name = Map.fetch!(compiled_opts, :log_ets_table_base)

    %{
      compiled_opts
      | shape_id: shape_id,
        snapshot_ets_table: :"#{snapshot_ets_table_name}-#{shape_id}",
        log_ets_table: :"#{log_ets_table_name}-#{shape_id}"
    }
  end

  # Service restart recovery functions that are pointless implimenting for in memory storage
  def list_shapes(_opts), do: []
  def add_shape(_shape_id, _shape, _opts), do: :ok
  def set_snapshot_xmin(_shape_id, _xmin, _opts), do: :ok
  def initialise(_opts), do: :ok

  def snapshot_started?(shape_id, opts) do
    try do
      :ets.member(opts.snapshot_ets_table, snapshot_start(shape_id))
    rescue
      ArgumentError ->
        false
    end
  end

  defp snapshot_key(shape_id, index) do
    {:data, shape_id, index}
  end

  @snapshot_start_index 0
  @snapshot_end_index :end
  defp snapshot_start(shape_id), do: snapshot_key(shape_id, @snapshot_start_index)
  defp snapshot_end(shape_id), do: snapshot_key(shape_id, @snapshot_end_index)

  def get_snapshot(shape_id, opts) do
    stream =
      ConcurrentStream.stream_to_end(
        excluded_start_key: @snapshot_start_index,
        end_marker_key: @snapshot_end_index,
        poll_time_in_ms: 10,
        stream_fun: fn excluded_start_key, included_end_key ->
          if !snapshot_started?(shape_id, opts), do: raise("Snapshot no longer available")

          :ets.select(opts.snapshot_ets_table, [
            {{snapshot_key(shape_id, :"$1"), :"$2"},
             [{:andalso, {:>, :"$1", excluded_start_key}, {:"=<", :"$1", included_end_key}}],
             [{{:"$1", :"$2"}}]}
          ])
        end
      )
      |> Stream.map(fn {_, item} -> item end)

    {@snapshot_offset, stream}
  end

  def get_log_stream(shape_id, offset, max_offset, opts) do
    offset = storage_offset(offset)
    max_offset = storage_offset(max_offset)

    :ets.tab2list(opts.log_ets_table)

    Stream.unfold(offset, fn offset ->
      case :ets.next_lookup(opts.log_ets_table, {shape_id, offset}) do
        :"$end_of_table" ->
          nil

        {{other_shape_id, _}, _} when other_shape_id != shape_id ->
          nil

        {{^shape_id, position}, _} when position > max_offset ->
          nil

        {{^shape_id, position}, [{_, item}]} ->
          {item, position}
      end
    end)
    |> LogChunker.materialise_chunk_boundaries()
  end

  def has_shape?(shape_id, opts) do
    case :ets.select(opts.log_ets_table, [
           {{{shape_id, :_}, :_}, [], [true]}
         ]) do
      [true] -> true
      [] -> snapshot_started?(shape_id, opts)
    end
  end

  def mark_snapshot_as_started(shape_id, opts) do
    :ets.insert(opts.snapshot_ets_table, {snapshot_start(shape_id), 0})
    :ok
  end

  @spec make_new_snapshot!(
          String.t(),
          Querying.json_result_stream(),
          map()
        ) :: :ok
  def make_new_snapshot!(shape_id, data_stream, opts) do
    OpenTelemetry.with_span("storage.make_new_snapshot", [storage_impl: "in_memory"], fn ->
      ets_table = opts.snapshot_ets_table

      data_stream
      |> Stream.with_index(1)
      |> Stream.map(fn {log_item, index} -> {snapshot_key(shape_id, index), log_item} end)
      |> Stream.chunk_every(500)
      |> Stream.each(fn chunk -> :ets.insert(ets_table, chunk) end)
      |> Stream.run()

      :ets.insert(ets_table, {snapshot_end(shape_id), 0})
      :ok
    end)
  end

  def append_to_log!(shape_id, log_items, opts) do
    ets_table = opts.log_ets_table

    log_items
    |> Enum.map(fn log_item ->
      log_key = {shape_id, storage_offset(log_item.offset)}
      json_log_item = Jason.encode!(log_item)

      case LogChunker.add_to_chunk(shape_id, json_log_item, opts) do
        {:ok, json_log_item} ->
          {log_key, json_log_item}

        {:threshold_exceeded, json_log_item_with_boundary} ->
          {log_key, json_log_item_with_boundary}
      end
    end)
    |> then(&:ets.insert(ets_table, &1))

    :ok
  end

  def cleanup!(shape_id, opts) do
    :ets.match_delete(opts.snapshot_ets_table, {snapshot_key(shape_id, :_), :_})
    :ets.match_delete(opts.log_ets_table, {{shape_id, :_}, :_})
    :ok
  end

  # Turns a LogOffset into a tuple representation
  # for storing in the ETS table
  defp storage_offset(offset) do
    LogOffset.to_tuple(offset)
  end
end
