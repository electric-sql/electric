defmodule Electric.ShapeCache.InMemoryStorage do
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes
  alias Electric.Utils
  alias Electric.Shapes.Shape
  use Agent

  @behaviour Electric.ShapeCache.Storage

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
    case :ets.match(opts.snapshot_ets_table, {{:metadata, shape_id}, :_}, 1) do
      {[_], _} -> true
      :"$end_of_table" -> false
    end
  end

  def get_snapshot(shape_id, opts) do
    offset = LogOffset.first()

    stream =
      :ets.select(opts.snapshot_ets_table, [
        {{{:data, shape_id, :"$1"}, :"$2"}, [], [{{:"$1", :"$2"}}]}
      ])
      |> Stream.map(fn {_, item} -> item end)

    {offset, stream}
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
      [] -> snapshot_exists?(shape_id, opts) and offset == LogOffset.first()
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
    offset = LogOffset.first()
    ets_table = opts.snapshot_ets_table

    data_stream
    |> Stream.map(&row_to_snapshot_entry(&1, shape_id, shape, query_info))
    |> Stream.map(&snapshot_storage_item_to_log_item({shape_id, offset}, &1))
    |> Stream.chunk_every(500)
    |> Stream.each(fn chunk -> :ets.insert(ets_table, chunk) end)
    |> Stream.run()

    :ets.insert(ets_table, {{:metadata, shape_id}, 0})
    :ok
  end

  def append_to_log!(shape_id, changes, opts) do
    ets_table = opts.log_ets_table

    changes
    |> Enum.map(fn {offset, key, action, value, header_data} ->
      offset = storage_offset(offset)
      item = {key, action, value, header_data}
      log_storage_item_to_log_item({shape_id, offset}, item)
    end)
    |> then(&:ets.insert(ets_table, &1))

    :ok
  end

  def cleanup!(shape_id, opts) do
    :ets.match_delete(opts.snapshot_ets_table, {{:data, shape_id, :_}, :_})
    :ets.match_delete(opts.snapshot_ets_table, {{:metadata, shape_id}, :_})
    :ets.match_delete(opts.log_ets_table, {{shape_id, :_}, :_})
    :ok
  end

  @doc false
  def row_to_snapshot_entry(row, shape_id, shape, %Postgrex.Query{
        columns: columns,
        result_types: types
      }) do
    serialized_row =
      [columns, types, row]
      |> Enum.zip_with(fn
        [col, Postgrex.Extensions.UUID, val] -> {col, Utils.encode_uuid(val)}
        [col, _, val] -> {col, to_string(val)}
      end)
      |> Map.new()

    key = Changes.build_key(shape.root_table, serialized_row, Shape.pk(shape))

    {{:data, shape_id, key}, serialized_row}
  end

  defp snapshot_storage_item_to_log_item(
         {_shape_id, snapshot_log_offset},
         {{_, _, change_key} = key, value}
       ) do
    {key,
     Jason.encode!(%{
       key: change_key,
       value: value,
       headers: %{action: :insert},
       offset: snapshot_log_offset
     })}
  end

  # Turns a stored log item into a log item
  # by modifying the turning the tuple offset
  # back into a LogOffset value.
  defp log_storage_item_to_log_item(
         {_shape_id, position} = key,
         {change_key, action, value, header_data}
       ) do
    offset = LogOffset.new(position)

    {key,
     Jason.encode!(%{
       key: change_key,
       value: value,
       headers: Map.put(header_data, :action, action),
       offset: offset
     })}
  end

  # Turns a LogOffset into a tuple representation
  # for storing in the ETS table
  defp storage_offset(offset) do
    LogOffset.to_tuple(offset)
  end
end
