defmodule Support.DbStructureSetup do
  def with_basic_tables(%{db_conn: conn} = context) do
    statements = [
      """
      CREATE TABLE serial_ids (
        id BIGSERIAL PRIMARY KEY
        #{additional_fields(context)}
      );
      """,
      """
      CREATE TABLE items (
        id UUID PRIMARY KEY,
        value TEXT NOT NULL
        #{additional_fields(context)}
      )
      """
    ]

    Enum.each(statements, &Postgrex.query!(conn, &1, []))

    %{tables: [{"public", "serial_ids"}, {"public", "items"}]}
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

    %{sql_execute: results}
  end

  def with_sql_execute(_), do: :ok

  defp additional_fields(%{additional_fields: additional_fields}), do: ", " <> additional_fields
  defp additional_fields(_), do: nil
end
