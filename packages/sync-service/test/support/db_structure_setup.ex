defmodule Support.DbStructureSetup do
  def with_basic_tables(%{db_conn: conn}) do
    Postgrex.query!(
      conn,
      """
      CREATE TABLE items (
        id UUID PRIMARY KEY,
        value TEXT NOT NULL
      )
      """,
      []
    )

    {:ok, tables: [{"public", "items"}]}
  end

  def with_sql_execute(%{db_conn: conn, with_sql: sql}) do
    {:ok, results} =
      Postgrex.transaction(conn, fn conn ->
        sql
        |> List.wrap()
        |> Enum.map(fn
          stmt when is_binary(stmt) -> Postgrex.query!(conn, stmt, [])
          {stmt, params} -> Postgrex.query!(conn, stmt, params)
        end)
      end)

    {:ok, %{sql_execute: results}}
  end

  def with_sql_execute(_), do: :ok
end
