defmodule Electric.Replication.ShapeLogStorage do
  @moduledoc """
  When any txn comes from postgres, we need to store it into the
  log for this shape if and only if it has txid >= xmin of the snapshot.
  """
  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.Storage
  alias Electric.Replication.Changes
  alias Electric.InMemShapeCache
  alias Electric.Replication.Changes.Transaction
  use GenServer
  require Logger

  @genserver_name_schema {:or, [:atom, {:tuple, [:atom, :atom, :any]}]}
  @schema NimbleOptions.new!(
            name: [
              type: @genserver_name_schema,
              default: __MODULE__
            ],
            storage: [type: :mod_arg, required: true],
            registry: [type: :atom, required: true]
          )

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      GenServer.start_link(__MODULE__, Map.new(opts), name: opts[:name])
    end
  end

  def store_transaction(%Transaction{} = txn, server \\ __MODULE__) do
    GenServer.cast(server, {:new_txn, txn})
  end

  def init(opts) do
    {:ok, opts}
  end

  def handle_cast({:new_txn, %Transaction{xid: xid, changes: changes, lsn: lsn} = txn}, state) do
    Logger.debug(fn -> "Txn received: #{inspect(txn)}" end)

    # TODO: can be optimized probably because you can parallelize writing to different shape logs
    for {shape_id, shape_def, xmin} <- InMemShapeCache.list_active_shapes(),
        xid >= xmin do
      relevant_changes = Enum.filter(changes, &Shape.change_in_shape?(shape_def, &1))

      cond do
        Enum.any?(relevant_changes, &is_struct(&1, Changes.TruncatedRelation)) ->
          # TODO: This is a very naive way to handle truncations: if ANY relevant truncates are
          #       present in the transaction, we're considering the whole transaction empty, and
          #       just rotate the shape id. "Correct" way to handle truncates is to be designed.
          Logger.warning(
            "Truncate operation encountered while processing txn #{txn.xid} for #{shape_id}"
          )

          InMemShapeCache.handle_truncate(shape_id)

        relevant_changes != [] ->
          # TODO: what's a graceful way to handle failure to append to log?
          #       Right now we'll just fail everything
          :ok = Storage.append_to_log!(shape_id, lsn, xid, changes, state.storage)

          notify_listeners(state.registry, :new_changes, shape_id, lsn)

        true ->
          Logger.debug(fn ->
            "No relevant changes found for #{inspect(shape_def)} in txn #{txn.xid}"
          end)
      end
    end

    {:noreply, state}
  end

  defp notify_listeners(registry, :new_changes, shape_id, changes) do
    Registry.dispatch(registry, shape_id, fn registered ->
      Logger.debug(fn ->
        "Notifying ~#{length(registered)} clients about new changes to #{shape_id}"
      end)

      for {pid, ref} <- registered,
          do: send(pid, {ref, :new_changes, changes})
    end)
  end
end
