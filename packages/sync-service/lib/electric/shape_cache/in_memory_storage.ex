defmodule Electric.ShapeCache.InMemoryStorage do
  alias Electric.ConcurrentStream
  alias Electric.LogItems
  alias Electric.Replication.LogOffset
  alias Electric.Telemetry.OpenTelemetry
  use Agent

  @behaviour Electric.ShapeCache.Storage

  @snapshot_offset LogOffset.first()

  def shared_opts(opts) do
    snapshot_ets_table_name = Access.get(opts, :snapshot_ets_table, :snapshot_ets_table)
    log_ets_table_name = Access.get(opts, :log_ets_table, :log_ets_table)

    {:ok, %{snapshot_ets_table: snapshot_ets_table_name, log_ets_table: log_ets_table_name}}
  end

  def start_link(compiled_opts) do
    Agent.start_link(fn ->
      %{
        snapshot_ets_table:
          :ets.new(compiled_opts.snapshot_ets_table, [:public, :named_table, :ordered_set]),
        log_ets_table:
          :ets.new(compiled_opts.log_ets_table, [:public, :named_table, :ordered_set])
      }
    end)
  end

  # Service restart recovery functions that are pointless implimenting for in memory storage
  def list_shapes(_opts), do: []
  def add_shape(_shape_id, _shape, _opts), do: :ok
  def set_snapshot_xmin(_shape_id, _xmin, _opts), do: :ok
  def cleanup_shapes_without_xmins(_opts), do: :ok

  def snapshot_exists?(shape_id, opts) do
    case :ets.match(opts.snapshot_ets_table, {snapshot_end(shape_id), :_}, 1) do
      {[_], _} -> true
      :"$end_of_table" -> false
    end
  end

  defp snapshot_key(shape_id, index) do
    {:data, shape_id, index}
  end

  # defp snapshot_start(shape_id), do: snapshot_key(shape_id, 0)
  defp snapshot_end(shape_id), do: snapshot_key(shape_id, :end)

  def get_snapshot(shape_id, opts) do
    stream =
      ConcurrentStream.stream_to_end(
        excluded_start_key: 0,
        end_marker_key: :end,
        poll_time_in_ms: 10,
        stream_fun: fn excluded_start_key, included_end_key ->
          :ets.select(opts.snapshot_ets_table, [
            {{{:data, shape_id, :"$1"}, :"$2"},
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
  end

  def has_log_entry?(shape_id, offset, opts) do
    case :ets.select(opts.log_ets_table, [
           {{{shape_id, storage_offset(offset)}, :_}, [], [true]}
         ]) do
      [true] -> true
      # FIXME: this is naive while we don't have snapshot metadata to get real offset
      [] -> snapshot_exists?(shape_id, opts) and offset == @snapshot_offset
    end
  end

  @spec make_new_snapshot!(
          String.t(),
          Electric.Shapes.Shape.t(),
          Postgrex.Query.t(),
          Enumerable.t(),
          map()
        ) :: :ok
  def make_new_snapshot!(shape_id, shape, query_info, data_stream, opts) do
    OpenTelemetry.with_span("storage.make_new_snapshot", [storage_impl: "in_memory"], fn ->
      ets_table = opts.snapshot_ets_table

      data_stream
      |> LogItems.from_snapshot_row_stream(@snapshot_offset, shape, query_info)
      |> Stream.with_index(1)
      |> Stream.map(fn {log_item, index} ->
        {snapshot_key(shape_id, index), Jason.encode!(log_item)}
      end)
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
      offset = storage_offset(log_item.offset)
      {{shape_id, offset}, Jason.encode!(log_item)}
    end)
    |> then(&:ets.insert(ets_table, &1))

    :ok
  end

  def cleanup!(shape_id, opts) do
    :ets.match_delete(opts.snapshot_ets_table, {{:data, shape_id, :_}, :_})
    :ets.match_delete(opts.log_ets_table, {{shape_id, :_}, :_})
    :ok
  end

  # Turns a LogOffset into a tuple representation
  # for storing in the ETS table
  defp storage_offset(offset) do
    LogOffset.to_tuple(offset)
  end
end
