defmodule Electric.ShapeCache.InMemoryStorage do
  alias Electric.Replication.Changes
  alias Electric.Postgres.Lsn
  alias Electric.Utils
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

  def snapshot_exists?(shape_id, opts) do
    case :ets.match(opts.snapshot_ets_table, {{shape_id, :_}, :_}, 1) do
      {[_], _} -> true
      :"$end_of_table" -> false
    end
  end

  def get_snapshot(shape_id, opts) do
    offset = 0

    results =
      :ets.select(opts.snapshot_ets_table, [
        {{{shape_id, :"$1"}, :"$2"}, [],
         [%{key: :"$1", value: :"$2", headers: %{action: "insert"}, offset: offset}]}
      ])

    {0, results}
  end

  def get_log_stream(shape_id, offset, max_offset, opts) do
    Stream.unfold(offset, fn offset ->
      case :ets.next_lookup(opts.log_ets_table, {shape_id, offset}) do
        :"$end_of_table" ->
          nil

        {{other_shape_id, _}, _} when other_shape_id != shape_id ->
          nil

        {{^shape_id, position}, _} when position > max_offset ->
          nil

        {{^shape_id, position}, [{_, xid, key, action, value}]} ->
          {%{key: key, value: value, headers: %{action: action, txid: xid}, offset: position},
           position}
      end
    end)
  end

  def has_log_entry?(shape_id, offset, opts) do
    case :ets.select(opts.log_ets_table, [{{{shape_id, offset}, :_, :_, :_, :_}, [], [true]}]) do
      [true] -> true
      # FIXME: this is naive while we don't have snapshot metadata to get real offset
      [] -> snapshot_exists?(shape_id, opts) and offset == 0
    end
  end

  @spec make_new_snapshot!(String.t(), Postgrex.Query.t(), Enumerable.t(), map()) :: :ok
  def make_new_snapshot!(shape_id, query_info, data_stream, opts) do
    ets_table = opts.snapshot_ets_table

    data_stream
    |> Stream.map(&__MODULE__.row_to_snapshot_entry(&1, shape_id, query_info))
    |> Stream.chunk_every(500)
    |> Stream.each(fn chunk -> :ets.insert(ets_table, chunk) end)
    |> Stream.run()
  end

  def append_to_log!(shape_id, lsn, xid, changes, opts) do
    base_offset = Lsn.to_integer(lsn)
    ets_table = opts.log_ets_table

    changes
    |> Enum.with_index(fn
      %{relation: _} = change, index ->
        key = Changes.build_key(change)
        value = Changes.to_json_value(change)
        action = Changes.get_action(change)
        {{shape_id, base_offset + index}, xid, key, action, value}
    end)
    |> then(&:ets.insert(ets_table, &1))

    :ok
  end

  def cleanup!(shape_id, opts) do
    :ets.match_delete(opts.snapshot_ets_table, {{shape_id, :_}, :_})
    :ets.match_delete(opts.log_ets_table, {{shape_id, :_}, :_, :_, :_, :_})
    :ok
  end

  @doc false
  def row_to_snapshot_entry(row, shape_id, %Postgrex.Query{
        name: key_prefix,
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

    # FIXME: This should not assume pk columns, but we're not querying PG for that info yet
    pk = Map.fetch!(serialized_row, "id")

    {{shape_id, key_prefix <> "/" <> pk}, serialized_row}
  end
end
