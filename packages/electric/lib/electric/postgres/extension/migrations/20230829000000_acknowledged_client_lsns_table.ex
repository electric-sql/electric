defmodule Electric.Postgres.Extension.Migrations.Migration_20230829000000_AcknowledgedClientLsnsTable do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2023_08_29_00_00_00

  @impl true
  def up(schema) do
    table = Extension.acked_client_lsn_table()

    replicated_table_ddls() ++
      [
        Extension.Functions.by_name(:upsert_acknowledged_client_lsn),
        """
        CREATE OR REPLACE TRIGGER upsert_acknowledged_client_lsn
        BEFORE INSERT ON #{table}
        FOR EACH ROW
        WHEN (pg_trigger_depth() < 1)
        EXECUTE FUNCTION #{schema}.upsert_acknowledged_client_lsn()
        """,
        "ALTER TABLE #{table} ENABLE REPLICA TRIGGER upsert_acknowledged_client_lsn",
        Extension.add_table_to_publication_sql(table)
      ]
  end

  @impl true
  def down(_), do: []

  @impl true
  def replicated_table_ddls do
    [
      """
      CREATE TABLE #{Extension.acked_client_lsn_table()} (
        client_id TEXT PRIMARY KEY,
        lsn BYTEA NOT NULL
      )
      """
    ]
  end
end
