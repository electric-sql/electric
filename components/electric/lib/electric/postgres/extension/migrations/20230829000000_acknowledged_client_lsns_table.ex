defmodule Electric.Postgres.Extension.Migrations.Migration_20230829000000_AcknowledgedClientLsnsTable do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  sql_file =
    Path.expand(
      "20230829000000_acknowledged_client_lsns_table/deduplicating_trigger.sql",
      __DIR__
    )

  @external_resource sql_file

  @trigger_sql File.read!(sql_file)

  @impl true
  def version, do: 2023_08_29_00_00_00

  @impl true
  def up(_) do
    table = Extension.acked_client_lsn_table()

    [
      create_table_ddl(),
      @trigger_sql,
      Extension.add_table_to_publication_sql(table)
    ]
  end

  @impl true
  def down(_), do: []

  @impl true
  def create_table_ddl do
    """
    CREATE TABLE #{Extension.acked_client_lsn_table()} (
      client_id TEXT PRIMARY KEY,
      lsn BYTEA NOT NULL
    )
    """
  end
end
