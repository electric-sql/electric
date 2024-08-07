defmodule Electric.Replication.ShapeLogCollector do
  @moduledoc """
  When any txn comes from postgres, we need to store it into the
  log for this shape if and only if it has txid >= xmin of the snapshot.
  """
  alias Electric.LogItems
  alias Electric.Postgres.Inspector
  alias Electric.Shapes.Shape
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  use GenServer
  require Logger

  @genserver_name_schema {:or, [:atom, {:tuple, [:atom, :atom, :any]}]}
  @schema NimbleOptions.new!(
            name: [
              type: @genserver_name_schema,
              default: __MODULE__
            ],
            registry: [type: :atom, required: true],
            shape_cache: [type: :mod_arg, required: true],
            inspector: [type: :mod_arg, required: true]
          )

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      GenServer.start_link(__MODULE__, Map.new(opts), name: opts[:name])
    end
  end

  def store_transaction(%Transaction{} = txn, server \\ __MODULE__) do
    GenServer.call(server, {:new_txn, txn})
  end

  def init(opts) do
    {:ok, opts}
  end

  def handle_call(
        {:new_txn,
         %Transaction{xid: xid, changes: changes, lsn: lsn, last_log_offset: last_log_offset} =
           txn},
        _from,
        state
      ) do
    Logger.info("Received transaction #{xid} from Postgres at #{lsn}")
    Logger.debug(fn -> "Txn received: #{inspect(txn)}" end)

    pk_cols_of_relations =
      for relation <- txn.affected_relations, into: %{} do
        {:ok, info} = Inspector.load_column_info(relation, state.inspector)
        pk_cols = Inspector.get_pk_cols(info)
        {relation, pk_cols}
      end

    changes = Enum.map(changes, &Changes.fill_key(&1, pk_cols_of_relations[&1.relation]))

    {shape_cache, opts} = state.shape_cache

    # TODO: can be optimized probably because you can parallelize writing to different shape logs
    for {shape_id, shape_def, xmin} <- shape_cache.list_active_shapes(opts), xid >= xmin do
      relevant_changes = Enum.flat_map(changes, &Shape.convert_change(shape_def, &1))

      cond do
        Enum.any?(relevant_changes, &is_struct(&1, Changes.TruncatedRelation)) ->
          # TODO: This is a very naive way to handle truncations: if ANY relevant truncates are
          #       present in the transaction, we're considering the whole transaction empty, and
          #       just rotate the shape id. "Correct" way to handle truncates is to be designed.
          Logger.warning(
            "Truncate operation encountered while processing txn #{txn.xid} for #{shape_id}"
          )

          shape_cache.handle_truncate(shape_cache, shape_id)

        relevant_changes != [] ->
          relevant_changes
          |> Enum.flat_map(&LogItems.from_change(&1, xid, Shape.pk(shape_def, &1.relation)))
          # TODO: what's a graceful way to handle failure to append to log?
          #       Right now we'll just fail everything
          |> then(&shape_cache.append_to_log!(shape_id, last_log_offset, &1, opts))

          notify_listeners(state.registry, :new_changes, shape_id, last_log_offset)

        true ->
          Logger.debug(fn ->
            "No relevant changes found for #{inspect(shape_def)} in txn #{txn.xid}"
          end)
      end
    end

    {:reply, :ok, state}
  end

  defp notify_listeners(registry, :new_changes, shape_id, latest_log_offset) do
    Registry.dispatch(registry, shape_id, fn registered ->
      Logger.debug(fn ->
        "Notifying ~#{length(registered)} clients about new changes to #{shape_id}"
      end)

      for {pid, ref} <- registered,
          do: send(pid, {ref, :new_changes, latest_log_offset})
    end)
  end
end
