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
  @spec transactions(Keyword.t(), atom) :: {term(), [Transaction.t()]}
  def transactions(connector_opts, cached_wal_module \\ Electric.Postgres.CachedWal.EtsBacked) do
    # It's important to store the current timestamp prior to fetching the cached LSN to ensure that we're not creating
    # a transaction "in the future" relative to the LSN.
    timestamp = DateTime.utc_now()

    migration_transactions = migration_transactions(connector_opts, timestamp)

    current_position = CachedWal.Api.get_current_position(cached_wal_module)

    current_lsn = current_position || 0
    txs_with_lsn = Enum.map(migration_transactions, &with_lsn/1)

    {current_lsn, txs_with_lsn}
  end

  defp migration_transactions(connector_opts, commit_timestamp) do
    {:ok, migrations} = Extension.SchemaCache.migration_history(nil)
    lsn = 0

    for {version, _schema, stmts} <- migrations do
      records =
        for sql <- stmts do
          %NewRecord{
            relation: Extension.ddl_relation(),
            record: %{"version" => version, "query" => sql, "txid" => "", "txts" => ""}
          }
        end

      build_transaction(connector_opts, records, lsn, commit_timestamp)
    end
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

  defp build_transaction(connector_opts, changes, lsn, commit_timestamp) do
    publication = Connectors.get_replication_opts(connector_opts).publication

    %Transaction{
      changes: changes,
      # NOTE(alco): not sure to which extent the value of this timestamp can affect the client.
      commit_timestamp: commit_timestamp,
      origin: Connectors.origin(connector_opts),
      publication: publication,
      lsn: lsn,
      ack_fn: fn -> :ok end
    }
  end

  defp with_lsn(%Transaction{lsn: lsn} = tx), do: {tx, lsn}
end
