defmodule Electric.Postgres.Extension.Migrations.Migration_20230715000000_UtilitiesTable do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2023_07_15_00_00_00

  @impl true
  def up(_) do
    table = Extension.transaction_marker_table()

    [
      """
      CREATE TABLE #{table} (
        id VARCHAR(64) PRIMARY KEY,
        content jsonb NULL
      )
      """,
      """
      INSERT INTO #{table} (id, content) VALUES ('magic write', '{}')
      """
    ]
  end

  @impl true
  def published_tables do
    [
      Extension.transaction_marker_relation()
    ]
  end
end
