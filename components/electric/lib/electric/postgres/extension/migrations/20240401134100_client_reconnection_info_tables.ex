defmodule Electric.Postgres.Extension.Migrations.Migration_20240401134100_ClientReconnectionInfoTables do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2024_04_01_13_41_00

  @impl true
  def up(_schema) do
    txid_type = Extension.txid_type()

    [
      """
      CREATE TABLE #{Extension.client_shape_subscriptions_table()} (
        client_id VARCHAR(64),
        subscription_id UUID,
        min_txid #{txid_type} NOT NULL,
        ord BIGINT NOT NULL,
        shape_requests BYTEA NOT NULL,
        PRIMARY KEY (client_id, subscription_id)
      )
      """,
      """
      CREATE TABLE #{Extension.client_checkpoints_table()} (
        client_id VARCHAR(64) PRIMARY KEY,
        pg_wal_pos BIGINT NOT NULL,
        sent_rows_graph BYTEA NOT NULL
      )
      """,
      """
      CREATE TABLE #{Extension.client_actions_table()} (
        client_id VARCHAR(64),
        txid #{txid_type} NOT NULL,
        subquery_actions BYTEA NOT NULL,
        PRIMARY KEY (client_id, txid)
      )
      """
    ]
  end

  @impl true
  def down(_), do: []
end
