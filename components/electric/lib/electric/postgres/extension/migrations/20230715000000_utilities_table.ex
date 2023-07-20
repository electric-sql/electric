defmodule Electric.Postgres.Extension.Migrations.Migration_20230715000000_UtilitiesTable do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2023_07_15_00_00_00

  @impl true
  def up(_) do
    [
      """
      CREATE TABLE #{Extension.transaction_marker_table()} (
        id VARCHAR(64) PRIMARY KEY,
        content jsonb NULL
      )
      """,
      """
      INSERT INTO #{Extension.transaction_marker_table()} (id, content) VALUES ('magic write', '{}')
      """,
      Extension.add_table_to_publication_sql(Extension.transaction_marker_table())
    ]
  end

  @impl true
  def down(_), do: []
end
