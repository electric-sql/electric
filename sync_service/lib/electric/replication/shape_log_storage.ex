defmodule Electric.Replication.ShapeLogStorage do
  @moduledoc """
  When any txn comes from postgres, we need to store it into the
  log for this shape if and only if it has txid >= xmin of the snapshot.
  """
  alias Electric.Replication.Changes
  alias Electric.Postgres.Lsn
  alias Electric.InMemShapeCache
  alias Electric.Replication.Changes.Transaction
  use GenServer
  require Logger
  @table_name :shape_logs

  def start_link(_) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  def store_transaction(%Transaction{} = txn, server \\ __MODULE__) do
    GenServer.cast(server, {:new_txn, txn})
  end

  def get_last_offset(shape_id) do
    case :ets.prev(@table_name, {shape_id, :infinity}) do
      {_, offset} -> offset
      _ -> nil
    end
  end

  def has_offset(shape_id, offset) do
    case :ets.lookup(@table_name, {shape_id, offset}) do
      [{_, _, _}] -> true
      _ -> false
    end
  end

  def get_version(shape_id) do
     case InMemShapeCache.fetch_snapshot(shape_id) do
        {:ok, _, version, _} -> version
        _ -> nil
     end
  end

  @spec get_log(String.t(), integer(), non_neg_integer() | :infinity) ::
          Enumerable.t(
            {position :: non_neg_integer(), transaction_id :: non_neg_integer(),
      change :: Changes.change()}
          )
  def get_log(shape_id, offset, size \\ :infinity) do
    Stream.unfold({offset, size}, fn
      {_, 0} ->
        nil

      {offset, size} ->
        new_size = if size != :infinity, do: size - 1, else: :infinity

        case :ets.next_lookup(@table_name, {shape_id, offset}) do
          :"$end_of_table" ->
            nil

          {{other_shape_id, _}, _} when other_shape_id != shape_id ->
            nil

          {{^shape_id, position}, [{_, xid, change}]} ->
            {{position, xid, change}, {position, new_size}}
        end
    end)
  end

  def init(_) do
    table = :ets.new(@table_name, [:named_table, :ordered_set, :public])
    {:ok, %{table: table}}
  end

  def handle_cast({:new_txn, %Transaction{xid: xid, changes: changes, lsn: lsn} = txn}, state) do
    Logger.debug("Txn received: #{inspect(txn)}")
    # TODO: can be optimized probably because you can parallelize writing to different shape logs

    dbg(xid)

    for {shape_id, shape_def, xmin} <- InMemShapeCache.list_active_shapes() |> dbg,
        xid >= xmin do
      relevant_changes =
        for {change, offset} <- Enum.with_index(changes),
            change_in_shape?(shape_def, change) do
          if is_struct(change, Changes.TruncatedRelation) do
            max_offset = Lsn.to_integer(lsn) + offset

            :ets.select_delete(@table_name, [
              {{{shape_id, :"$1"}, :_, :_}, [{:<, :"$1", max_offset}], [true]}
            ])

            GenServer.cast(InMemShapeCache, {:truncate, shape_id, :erlang.phash2(shape_def)})
            nil
          else
            :ets.insert(@table_name, {{shape_id, Lsn.to_integer(lsn) + offset}, xid, change})
            {Lsn.to_integer(lsn) + offset, xid, change}
          end
        end

      dbg(relevant_changes)

      if relevant_changes != [] do
        Registry.dispatch(Registry.ShapeChanges, shape_id, fn registered ->
          dbg(registered)

          for {pid, _} <- registered,
              do: send(pid, {:new_changes, Enum.reject(relevant_changes, &is_nil/1)})
        end)
      end
    end

    {:noreply, state}
  end

  defp change_in_shape?(table, %{relation: {_, table}}), do: true
  defp change_in_shape?(_, _), do: false
end
