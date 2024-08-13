defmodule Electric.Replication.ShapeLogCollector do
  @moduledoc """
  When any txn comes from postgres, we need to store it into the
  log for this shape if and only if it has txid >= xmin of the snapshot.
  """
  use GenStage

  alias Electric.Postgres.Inspector
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.{Transaction, Relation, RelationChange}

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
    {shape_cache, opts} = state.shape_cache
    old_rel = shape_cache.get_relation(rel.id, opts)

    if is_nil(old_rel) || old_rel != rel do
      shape_cache.store_relation(rel, opts)
    end

    if !is_nil(old_rel) && old_rel != rel do
      Logger.info("Schema for the table #{old_rel.schema}.#{old_rel.table} changed")
      change = %RelationChange{old_relation: old_rel, new_relation: rel}
      # Fetch all shapes that are affected by the relation change and clean them up
      shape_cache.list_active_shapes(opts)
      |> Enum.filter(&is_affected_by_relation_change?(&1, change))
      |> Enum.map(&elem(&1, 0))
      |> Electric.Shapes.clean_shapes(state)
    end

    {:reply, :ok, [], state}
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

  defp is_affected_by_relation_change?(
         shape,
         %RelationChange{
           old_relation: %Relation{schema: old_schema, table: old_table},
           new_relation: %Relation{schema: new_schema, table: new_table}
         }
       )
       when old_schema != new_schema or old_table != new_table do
    # The table's qualified name changed
    # so shapes that match the old schema or table name are affected
    shape_matches?(shape, old_schema, old_table)
  end

  defp is_affected_by_relation_change?(shape, %RelationChange{
         new_relation: %Relation{schema: schema, table: table}
       }) do
    shape_matches?(shape, schema, table)
  end

  # TODO: test this machinery of cleaning shapes on any migration
  #       once that works, then we can optimize it to only clean on relevant migrations

  defp shape_matches?({_, %Shape{root_table: {ns, tbl}}, _}, schema, table)
       when ns == schema and tbl == table,
       do: true

  defp shape_matches?(_, _, _), do: false
end
