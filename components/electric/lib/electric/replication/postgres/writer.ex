defmodule Electric.Replication.Postgres.Writer do
  use GenStage

  alias Electric.Postgres.Extension
  alias Electric.Postgres.ShadowTableTransformation
  alias Electric.Replication.Changes
  alias Electric.Replication.Connectors
  alias Electric.Replication.Postgres.Client

  require Logger

  ###
  # Public interface
  ###

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts)
  end

  ###
  # GenStage callbacks
  ###

  @impl true
  def init(opts) do
    conn_config = Keyword.fetch!(opts, :conn_config)
    origin = Connectors.origin(conn_config)

    :gproc.reg(name(origin))

    Logger.metadata(origin: origin)

    conn_opts = Connectors.get_connection_opts(conn_config)
    {:ok, conn} = Client.connect(conn_opts)
    {:ok, [], []} = :epgsql.squery(conn, "SET electric.session_replication_role = replica")

    {:via, :gproc, producer_name} = Keyword.fetch!(opts, :producer)

    subscription_opts = [
      cancel: :temporary,
      min_demand: 10,
      max_demand: 50
    ]

    Logger.debug(
      "#{inspect(__MODULE__)} started, registered as #{inspect(name(origin))}, subscribed to #{inspect(producer_name)}"
    )

    {:consumer, %{conn: conn, origin: origin, producer_pid: nil},
     subscribe_to: [{{:via, :gproc, producer_name}, subscription_opts}]}
  end

  @impl true
  def handle_subscribe(:producer, _opts, {pid, _tag}, state) do
    {:automatic, %{state | producer_pid: pid}}
  end

  @impl true
  def handle_events(events, _from, state) do
    {state, last_pos} =
      Enum.reduce(events, {state, nil}, fn {tx, pos}, {state, _last_pos} ->
        {send_transaction(tx, pos, state), pos}
      end)

    send(state.producer_pid, {:sent_all_up_to, last_pos})

    {:noreply, [], state}
  end

  ###
  # Private functions
  ###

  defp name(name) do
    {:n, :l, {__MODULE__, name}}
  end

  defp send_transaction(tx, _pos, state) do
    statements = tx_changes_to_dml(tx, state)

    Client.with_transaction(state.conn, fn conn ->
      Enum.each(statements, fn stmt ->
        case :epgsql.squery(conn, stmt) do
          {:ok, _} ->
            :ok

          error ->
            raise "Postgres.Writer failed to execute statement #{stmt} with error #{inspect(error)}"
        end
      end)
    end)

    state
  end

  defp tx_changes_to_dml(
         %Changes.Transaction{changes: changes, commit_timestamp: ts, origin: origin} = tx,
         state
       ) do
    relations = load_relations_from_changes(changes)
    tag = {ts, origin}

    processed_changes =
      Enum.flat_map(changes, &split_change_into_main_and_shadow(&1, relations, tag, state.origin))

    Logger.debug(fn ->
      "Processed tx changes (# pre: #{length(changes)}, # post: #{length(processed_changes)}): " <>
        inspect(processed_changes, pretty: true)
    end)

    tx_statements = Enum.map(processed_changes, &change_to_statement(&1, relations))
    [acked_client_lsn_statement(tx) | tx_statements]
  end

  defp load_relations_from_changes(changes) do
    changes
    |> Enum.map(& &1.relation)
    |> ShadowTableTransformation.add_shadow_relations()
    |> Stream.uniq()
    |> Stream.map(&Extension.SchemaCache.Global.relation!/1)
    |> Map.new(fn rel -> {{rel.schema, rel.name}, rel} end)
  end

  defp split_change_into_main_and_shadow(change, relations, tag, origin) do
    ShadowTableTransformation.split_change_into_main_and_shadow(change, relations, tag, origin)
  end

  # This is the same change as the one in `Electric.Replication.SatelliteCollectorProducer.update_acked_client_lsn/1`
  # but expressed as an SQL INSERT statement. This INSERT does not cause the `upsert_acknowledged_client_lsn` trigger to
  # fire because the trigger is anabled with `ENABLE REPLICA TRIGGER`.
  defp acked_client_lsn_statement(tx) do
    client_id = tx.origin
    lsn = tx.lsn
    values_sql = encode_values([{client_id, :text}, {lsn, :bytea}])

    """
    INSERT INTO #{Extension.acked_client_lsn_table()} AS t
    VALUES (#{values_sql})
    ON CONFLICT (client_id)
      DO UPDATE
        SET lsn = excluded.lsn
      WHERE t.lsn IS DISTINCT FROM excluded.lsn
    """
  end

  defp change_to_statement(%Changes.NewRecord{record: data, relation: table}, relations) do
    {table_schema, table_name} = table
    columns = relations[table].columns

    table_sql = quote_ident(table_schema, table_name)
    columns_sql = map_join(columns, &quote_ident(&1.name))
    values_sql = column_values(data, columns) |> encode_values()

    "INSERT INTO #{table_sql}(#{columns_sql}) VALUES (#{values_sql})"
  end

  # TODO: Should probably have backfilling of columns with defaults/nulls
  defp column_values(record, columns) do
    Enum.map(columns, &{Map.fetch!(record, &1.name), &1.type})
  end

  defp encode_values(values), do: map_join(values, fn {val, type} -> encode_value(val, type) end)

  defp encode_value(nil, _type), do: "NULL"

  defp encode_value("t", :bool), do: "true"
  defp encode_value("f", :bool), do: "false"

  defp encode_value(bin, :bytea),
    do: bin |> Electric.Postgres.Bytea.to_postgres_hex() |> quote_string()

  defp encode_value(val, float_type) when float_type in [:float4, :float8] do
    case Float.parse(val) do
      :error ->
        # val must be an infinity or NaN
        quote_string(val)

      {_, ""} ->
        val
    end
  end

  defp encode_value(val, int_type) when int_type in [:int2, :int4, :int8], do: val

  # All remaning types that we support are inserted as literal strings into the statement. Postgres will perform all the
  # necessary type casts.
  defp encode_value(str, _type), do: quote_string(str)

  defp quote_ident(name) do
    ~s|"#{escape_quotes(name, ?")}"|
  end

  defp quote_ident(schema, name) do
    ~s|"#{escape_quotes(schema, ?")}"."#{escape_quotes(name, ?")}"|
  end

  defp quote_string(str) do
    ~s|'#{escape_quotes(str, ?')}'|
  end

  defp escape_quotes(str, q) do
    :binary.replace(str, <<q>>, <<q, q>>, [:global])
  end

  defp map_join(list, fun) do
    list |> Enum.map(fun) |> Enum.join(",")
  end
end
