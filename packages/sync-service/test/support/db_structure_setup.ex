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
end
