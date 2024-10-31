defmodule Electric.Postgres.Configuration do
  @moduledoc """
  Module for functions that configure Postgres in some way using
  a provided connection.
  """
  alias Electric.Utils
  alias Electric.Shapes.Shape

  @type filter() :: String.t() | nil
  @type filters() :: %{Electric.relation() => filter()}

  @pg_15 150_000

  @doc """
  Ensure that all tables are configured for replication.

  Table is considered configured for replication when it's `REPLICA IDENTITY` is set to `FULL`
  and it's added to the specified publication.

  Important: this function should not be ran in a transaction, because it starts multiple
  internal transactions that are sometimes expected to fail.

  Raises if it fails to configure all the tables in the expected way.
  """
  @spec configure_tables_for_replication!(
          Postgrex.conn(),
          [Shape.table_with_where_clause()],
          (-> String.t()),
          float()
        ) ::
          {:ok, [:ok]}
  def configure_tables_for_replication!(pool, relations, get_pg_version, publication_name) do
    configure_tables_for_replication_internal!(
      pool,
      relations,
      get_pg_version.(),
      publication_name
    )
  end

  defp configure_tables_for_replication_internal!(pool, relations, pg_version, publication_name)
       when pg_version < @pg_15 do
    Postgrex.transaction(pool, fn conn ->
      for {relation, _} <- relations,
          table = Utils.relation_to_sql(relation),
          publication = Utils.quote_name(publication_name) do
        Postgrex.query!(conn, "SAVEPOINT before_publication", [])

        # PG 14 and below do not support filters on tables of publications
        case Postgrex.query(
               conn,
               "ALTER PUBLICATION #{publication} ADD TABLE #{table}",
               []
             ) do
          {:ok, _} ->
            Postgrex.query!(conn, "RELEASE SAVEPOINT before_publication", [])
            :ok

          # Duplicate object error is raised if we're trying to add a table to the publication when it's already there.
          {:error, %{postgres: %{code: :duplicate_object}}} ->
            Postgrex.query!(conn, "ROLLBACK TO SAVEPOINT before_publication", [])
            Postgrex.query!(conn, "RELEASE SAVEPOINT before_publication", [])
            :ok

          {:error, reason} ->
            raise reason
        end
      end

      set_replica_identity!(conn, relations)
    end)
  end

  defp configure_tables_for_replication_internal!(pool, relations, _pg_version, publication_name) do
    Postgrex.transaction(pool, fn conn ->
      # We're using advisory locks to prevent race conditions when multiple
      # processes try to read-then-update the publication configuration. We're not using `SELECT FOR UPDATE`
      # because it doesn't read the value that was updated by other transaction holding the lock. This lock
      # is thus acquired before reading the existing configuration, so the first read sees the latest value.
      Postgrex.query!(conn, "SELECT pg_advisory_xact_lock($1)", [:erlang.phash2(publication_name)])

      filters = get_publication_filters(conn, publication_name)

      # Get the existing filter for the table
      # and extend it with the where clause for the table
      # and update the table in the map with the new filter
      filters =
        Enum.reduce(relations, filters, fn {relation, clause}, acc ->
          Map.update(acc, relation, clause, &extend_where_clause(&1, clause))
        end)

      Postgrex.query!(conn, make_alter_publication_query(publication_name, filters), [])

      # `ALTER TABLE` should be after the publication altering, because it takes out an exclusive lock over this table,
      # but the publication altering takes out a shared lock on all mentioned tables, so a concurrent transaction will
      # deadlock if the order is reversed.
      set_replica_identity!(conn, relations)

      [:ok]
    end)
  end

  defp set_replica_identity!(conn, relations) do
    for {relation, _} <- relations,
        table = Utils.relation_to_sql(relation) do
      Postgrex.query!(conn, "ALTER TABLE #{table} REPLICA IDENTITY FULL", [])
    end
  end

  # Returns the filters grouped by table for the given publication.
  @spec get_publication_filters(Postgrex.conn(), String.t()) :: filters()
  defp get_publication_filters(conn, publication) do
    Postgrex.query!(
      conn,
      "SELECT schemaname, tablename, rowfilter FROM pg_publication_tables WHERE pubname = $1",
      [publication]
    )
    |> Map.fetch!(:rows)
    |> Enum.map(&{Enum.take(&1, 2) |> List.to_tuple(), Enum.at(&1, 2)})
    |> Map.new()
  end

  @doc """
  Drops all tables from the given publication.
  """
  @spec drop_all_publication_tables(Postgrex.conn(), String.t()) :: Postgrex.Result.t()
  def drop_all_publication_tables(conn, publication_name) do
    Postgrex.query!(
      conn,
      "
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = '#{publication_name}')
        LOOP
          EXECUTE 'ALTER PUBLICATION #{Utils.quote_name(publication_name)} DROP TABLE ' || r.schemaname || '.' || r.tablename || ';';
        END LOOP;
      END $$;
      ",
      []
    )
  end

  # Joins the existing filter for the table with the where clause for the table.
  # If one of them is `nil` (i.e. no filter) then the resulting filter is `nil`.
  @spec extend_where_clause(filter(), filter()) :: filter()
  defp extend_where_clause(filter, where_clause) when is_nil(filter) or is_nil(where_clause) do
    nil
  end

  defp extend_where_clause(filter, where_clause) do
    "(#{filter} OR #{where_clause})"
  end

  # Makes an SQL query that alters the given publication whith the given tables and filters.
  @spec make_alter_publication_query(String.t(), filters()) :: String.t()
  defp make_alter_publication_query(publication_name, filters) do
    base_sql = "ALTER PUBLICATION #{Utils.quote_name(publication_name)} SET TABLE "

    tables =
      filters
      |> Enum.map(&make_table_clause/1)
      |> Enum.join(", ")

    base_sql <> tables
  end

  @spec make_table_clause({Electric.relation(), filter()}) :: String.t()
  defp make_table_clause({{schema, tbl}, nil}) do
    Utils.relation_to_sql({schema, tbl})
  end

  defp make_table_clause({{schema, tbl}, where}) do
    table = Utils.relation_to_sql({schema, tbl})
    table <> " WHERE " <> where
  end
end
