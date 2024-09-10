defmodule Electric.Postgres.Configuration do
  @moduledoc """
  Module for functions that configure Postgres in some way using
  a provided connection.
  """
  alias Electric.Utils
  alias Electric.Shapes.Shape

  @type filter() :: String.t() | nil
  @type maybe_filter() :: filter() | :filter_not_found

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
          String.t()
        ) ::
          {:ok, [:ok]}
  def configure_tables_for_replication!(pool, relations, publication_name) do
    Postgrex.transaction(pool, fn conn ->
      for {relation, _} <- relations,
          table = Utils.relation_to_sql(relation),
          do: Postgrex.query!(conn, "ALTER TABLE #{table} REPLICA IDENTITY FULL", [])

      for {relation, rel_where_clause} <- relations, table = Utils.relation_to_sql(relation) do
        Postgrex.query!(conn, "SAVEPOINT before_publication", [])

        filter = get_publication_filter(conn, relation, publication_name)

        alter_publication_sql =
          make_alter_publication_query(table, publication_name, filter, rel_where_clause)

        case Postgrex.query(conn, alter_publication_sql, []) do
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

  # Returns the filter of the given publication.
  # If the publication has no filter it returns `nil`.
  # If the publication does not exist it returns `:publication_not_found`.
  @spec get_publication_filter(Postgrex.conn(), Electric.relation(), String.t()) :: maybe_filter()
  defp get_publication_filter(conn, {schema, tbl}, publication_name) do
    case Postgrex.query!(
           conn,
           "SELECT rowfilter FROM pg_publication_tables WHERE pubname = $1 AND schemaname = $2 AND tablename = $3",
           [publication_name, schema, tbl]
         ).rows do
      [[rowfilter]] -> rowfilter
      _ -> :filter_not_found
    end
  end

  # Creates a SQL query that alters the given publication
  # to add or set a table based on the publication's filters for that table
  # and the shape's where clause for that table.
  @spec make_alter_publication_query(String.t(), String.t(), maybe_filter(), filter()) ::
          String.t()
  defp make_alter_publication_query(table, publication_name, :filter_not_found, nil) do
    "ALTER PUBLICATION #{publication_name} ADD TABLE #{table}"
  end

  defp make_alter_publication_query(table, publication_name, :filter_not_found, where_clause) do
    "ALTER PUBLICATION #{publication_name} ADD TABLE #{table} WHERE #{where_clause}"
  end

  defp make_alter_publication_query(table, publication_name, filter, where_clause)
       when is_nil(filter) or is_nil(where_clause) do
    # if one of the filters is nil, then we should not use a filter for the table
    "ALTER PUBLICATION #{publication_name} SET TABLE #{table}"
  end

  defp make_alter_publication_query(table, publication_name, filter, where_clause) do
    "ALTER PUBLICATION #{publication_name} SET TABLE #{table} WHERE (#{filter} OR #{where_clause})"
  end
end
