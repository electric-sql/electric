defmodule Electric.Replication.ShapeLogCollector do
  @moduledoc """
  When any txn comes from postgres, we need to store it into the
  log for this shape if and only if it has txid >= xmin of the snapshot.
  """
  use GenStage

  alias Electric.Postgres.Inspector
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.{Transaction, Relation}

  require Logger

  @genserver_name_schema {:or, [:atom, {:tuple, [:atom, :atom, :any]}]}
  @schema NimbleOptions.new!(
            name: [
              type: @genserver_name_schema,
              default: __MODULE__
            ],
            inspector: [type: :mod_arg, required: true]
          )

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      GenStage.start_link(__MODULE__, Map.new(opts), name: opts[:name])
    end
  end

  def store_transaction(%Transaction{} = txn, server \\ __MODULE__) do
    GenStage.call(server, {:new_txn, txn})
  end

  def handle_relation_msg(%Relation{} = rel, server \\ __MODULE__) do
    GenStage.call(server, {:relation_msg, rel})
  end

  def init(opts) do
    {:producer, opts, dispatcher: GenStage.BroadcastDispatcher}
  end

  def handle_demand(_demand, state) do
    {:noreply, [], state}
  end

  def handle_call({:relation_msg, rel}, _from, state) do
    {:reply, :ok, [rel], state}
  end

  def handle_call({:new_txn, %Transaction{xid: xid, lsn: lsn} = txn}, _from, state) do
    Logger.info("Received transaction #{xid} from Postgres at #{lsn}")
    Logger.debug(fn -> "Txn received: #{inspect(txn)}" end)

    pk_cols_of_relations =
      for relation <- txn.affected_relations, into: %{} do
        {:ok, info} = Inspector.load_column_info(relation, state.inspector)
        pk_cols = Inspector.get_pk_cols(info)
        {relation, pk_cols}
      end

    txn =
      Map.update!(txn, :changes, fn changes ->
        Enum.map(changes, &Changes.fill_key(&1, pk_cols_of_relations[&1.relation]))
      end)

    {:reply, :ok, [txn], state}
  end
end
