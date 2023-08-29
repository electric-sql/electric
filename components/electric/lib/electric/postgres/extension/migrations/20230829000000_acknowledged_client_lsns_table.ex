defmodule Electric.Postgres.Extension.Migrations.Migration_20230829000000_AcknowledgedClientLsnsTable do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2023_08_29_00_00_00

  @impl true
  def up(_) do
    table = Extension.acked_client_lsn_table()

    [
      """
      CREATE TABLE #{table} (
        client_id TEXT PRIMARY KEY,
        lsn BYTEA NOT NULL
      )
      """,
      Extension.add_table_to_publication_sql(table)
    ]
  end

  @impl true
  def down(_), do: []
end
