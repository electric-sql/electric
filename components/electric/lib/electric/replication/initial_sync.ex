defmodule Electric.Replication.InitialSync do
  import Electric.Postgres.Extension, only: [is_ddl_relation: 1, is_extension_relation: 1]

  alias Electric.Postgres.{CachedWal, Lsn}
  alias Electric.Replication.Changes.{NewRecord, Transaction}
  alias Electric.Replication.Connectors
  alias Electric.Replication.Postgres.Client

  @spec transactions(Keyword.t(), atom) :: {Lsn.t(), [Transaction.t()]}
  def transactions(connector_opts, cached_wal_module \\ Electric.Postgres.CachedWal.EtsBacked) do
    # NOTE(alco): this is a placeholder to show where schema migrations will fit into the initial sync, once implemented.
    # Here we need to fetch ALL migrations from Postgres and convert them to %Transaction{} structs. On the client,
    # already applied migrations need to be skipped, the rest need to be applied.
    #
    # Since this is an idempotent action, the client shouldn't update its cached LSN before it applies the initial DATA
    # transaction. In other words, applying any of these migration transactions on the client should leave its LSN undefined.
    migration_transactions = []

    # It's important to store the current timestamp prior to fetching the current LSN to ensure that we're not creating
    # a transaction "in the future" relative to the LSN.
    timestamp = DateTime.utc_now()

    {data_transactions, lsn} =
      case CachedWal.Api.get_current_lsn(cached_wal_module) do
        {:ok, current_lsn} ->
          tx = initial_data_transaction(connector_opts, current_lsn, timestamp)
          {[{tx, current_lsn}], current_lsn}

        :empty_db ->
          {[], Lsn.from_integer(0)}
      end

    {lsn, migration_transactions ++ data_transactions}
  end

  defp initial_data_transaction(connector_opts, lsn, commit_timestamp) do
    publication = Connectors.get_replication_opts(connector_opts).publication
    conn_config = Connectors.get_connection_opts(connector_opts)

    perform_in_transaction(conn_config, fn conn ->
      new_records = fetch_data_from_all_tables(conn, publication)

      %Transaction{
        changes: new_records,
        # NOTE(alco): not sure to which extent the value of this timestamp can affect the client.
        commit_timestamp: commit_timestamp,
        origin: Connectors.origin(connector_opts),
        publication: publication,
        lsn: lsn,
        ack_fn: fn -> :ok end
      }
    end)
  end

  defp perform_in_transaction(conn_config, fun) do
    Client.with_conn(conn_config, fn conn ->
      :epgsql.with_transaction(conn, fn conn ->
        {:ok, [], []} =
          :epgsql.squery(conn, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")

        fun.(conn)
      end)
    end)
  end

  def fetch_data_from_all_tables(conn, publication) do
    conn
    |> Client.query_replicated_tables(publication)
    |> Enum.reject(fn table_info ->
      relation = relation(table_info)
      is_ddl_relation(relation) or is_extension_relation(relation)
    end)
    |> Enum.flat_map(fn %{
                          schema: schema_name,
                          name: table_name,
                          primary_keys: pks,
                          columns: cols
                        } = table_info ->
      sql = "SELECT * FROM #{schema_name}.#{table_name} ORDER BY #{Enum.join(pks, ",")}"
      {:ok, _cols, rows} = :epgsql.squery(conn, sql)
      rows_to_records(rows, cols, relation(table_info))
    end)
  end

  ###

  defp relation(%{schema: schema, name: table_name}), do: {schema, table_name}

  defp rows_to_records(rows, cols, relation) when is_list(rows) do
    for row_tuple <- rows do
      column_names = Enum.map(cols, & &1.name)

      values =
        row_tuple
        |> Tuple.to_list()
        |> Enum.map(fn
          :null -> nil
          other -> other
        end)

      row =
        Enum.zip(column_names, values)
        |> Map.new()

      %NewRecord{relation: relation, record: row}
    end
  end
end
