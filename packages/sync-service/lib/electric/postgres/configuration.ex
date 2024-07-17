defmodule Electric.Postgres.Configuration do
  @moduledoc """
  Module for functions that configure Postgres in some way using
  a provided connection.
  """
  alias Electric.Utils

  @doc """
  Ensure that all tables are configured for replication.

  Table is considered configured for replication when it's `REPLICA IDENTITY` is set to `FULL`
  and it's added to the specified publication.

  Important: this function should not be ran in a transaction, because it starts multiple
  internal transactions that are sometimes expected to fail.

  Raises if it fails to configure all the tables in the expected way.
  """
  @spec configure_tables_for_replication!(Postgrex.conn(), [Electric.relation()], String.t()) ::
          {:ok, [:ok]}
  def configure_tables_for_replication!(pool, relations, publication_name) do
    Postgrex.transaction(pool, fn conn ->
      for relation <- relations,
          table = Utils.relation_to_sql(relation),
          do: Postgrex.query!(conn, "ALTER TABLE #{table} REPLICA IDENTITY FULL", [])

      for relation <- relations, table = Utils.relation_to_sql(relation) do
        Postgrex.query!(conn, "SAVEPOINT before_publication", [])

        case Postgrex.query(
               conn,
               "ALTER PUBLICATION #{publication_name} ADD TABLE #{table}",
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
end
