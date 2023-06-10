defmodule Electric.Replication.InitialSync do
  @moduledoc """
  Initial sync of migrations and data.

  This module relies on the functionality provided by Postgres.Extension to fetch all "electrified" tables, migration
  history, etc.
  """

  alias Electric.Postgres.{CachedWal, Extension, Lsn}
  alias Electric.Replication.Changes.{NewRecord, Transaction}
  alias Electric.Replication.Connectors
  alias Electric.Replication.Postgres.Client

  @doc """
  Get a list of transactions that, taken together, represent the current state of the Postgres database.

  The list always starts with migration transactions, followed by a single data transaction that includes all of the
  data the client can access.

  All table data are fetched in a single REPEATABLE READ transaction to ensure consisency between all tables.

  The LSN returned along with the list of transactions corresponds to the latest known cached LSN just prior to starting
  the data fetching.
  """
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
      if current_lsn = CachedWal.Api.get_current_lsn(cached_wal_module) do
        tx = initial_data_transaction(connector_opts, current_lsn, timestamp)
        {[{tx, current_lsn}], current_lsn}
      else
        {[], Lsn.from_integer(0)}
      end

    {lsn, migration_transactions ++ data_transactions}
  end

  defp initial_data_transaction(connector_opts, lsn, commit_timestamp) do
    origin = Connectors.origin(connector_opts)
    conn_config = Connectors.get_connection_opts(connector_opts)

    Client.with_conn(conn_config, fn conn ->
      :epgsql.with_transaction(conn, fn conn ->
        :ok = set_repeatable_read_transaction(conn)
        new_records = fetch_data_from_all_tables(conn, origin)

        %Transaction{
          changes: new_records,
          # NOTE(alco): not sure to which extent the value of this timestamp can affect the client.
          commit_timestamp: commit_timestamp,
          origin: origin,
          publication: Connectors.get_replication_opts(connector_opts).publication,
          lsn: lsn,
          ack_fn: fn -> :ok end
        }
      end)
    end)
  end

  defp set_repeatable_read_transaction(conn) do
    {:ok, [], []} =
      :epgsql.squery(conn, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")

    :ok
  end

  def fetch_data_from_all_tables(conn, origin) do
    {:ok, tables} = Extension.electrified_tables(conn)

    Enum.flat_map(tables, fn {_id, schema_name, table_name, _oid} ->
      relation = {schema_name, table_name}
      {:ok, pks} = Extension.SchemaCache.primary_keys(origin, schema_name, table_name)

      sql = fetch_all_rows_from_table_query(relation, pks)
      {:ok, cols, rows} = :epgsql.squery(conn, sql)

      col_names = Enum.map(cols, fn tuple -> elem(tuple, 1) end)
      rows_to_records(rows, col_names, relation)
    end)
  end

  def fetch_all_rows_from_table_query({schema_name, table_name}, primary_keys) do
    # TODO(alco): Replace the * with an explicit list of columns
    # (once https://github.com/electric-sql/electric/pull/191 is merged).
    "SELECT * FROM #{schema_name}.#{table_name} ORDER BY #{Enum.join(primary_keys, ",")}"
  end

  defp rows_to_records(rows, col_names, relation) when is_list(rows) do
    for row_tuple <- rows do
      values =
        row_tuple
        |> Tuple.to_list()
        |> Enum.map(fn
          :null -> nil
          other -> other
        end)

      row =
        Enum.zip(col_names, values)
        |> Map.new()

      %NewRecord{relation: relation, record: row}
    end
  end
end
