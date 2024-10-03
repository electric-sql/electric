defmodule Electric.Postgres.Configuration do
  @moduledoc """
  Module for functions that configure Postgres in some way using
  a provided connection.
  """
  alias Electric.Utils
  alias Electric.Shapes.Shape

  @type filter() :: String.t() | nil
  @type maybe_filter() :: filter() | :relation_not_found
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
      set_replica_identity!(conn, relations)

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
    end)
  end

  defp configure_tables_for_replication_internal!(pool, relations, _pg_version, publication_name) do
    Postgrex.transaction(pool, fn conn ->
      set_replica_identity!(conn, relations)

      for {relation, rel_where_clause} <- relations do
        Postgrex.query!(conn, "SAVEPOINT before_publication", [])

        filters = get_publication_filters(conn, publication_name)

        # Get the existing filter for the table
        # and extend it with the where clause for the table
        # and update the table in the map with the new filter
        filter = Map.get(filters, relation, :relation_not_found)
        rel_filter = extend_where_clause(filter, rel_where_clause)
        filters = Map.put(filters, relation, rel_filter)

        alter_publication_sql =
          make_alter_publication_query(publication_name, filters)

        case Postgrex.query(conn, alter_publication_sql, []) do
          {:ok, _} ->
            Postgrex.query!(conn, "RELEASE SAVEPOINT before_publication", [])
            :ok

          {:error, reason} ->
            raise reason
        end
      end
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
  @spec extend_where_clause(maybe_filter(), filter()) :: filter()
  defp extend_where_clause(:relation_not_found, where_clause) do
    where_clause
  end

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

  @spec make_table_clause(filter()) :: String.t()
  defp make_table_clause({{schema, tbl}, nil}) do
    Utils.relation_to_sql({schema, tbl})
  end

  defp make_table_clause({{schema, tbl}, where}) do
    table = Utils.relation_to_sql({schema, tbl})
    table <> " WHERE " <> where
  end
end
