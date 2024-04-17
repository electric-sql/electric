defmodule Electric.Postgres.Extension.Migrations.Migration_20240417131000_ClientReconnectionInfoTables do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2024_04_17_13_10_00

  @impl true
  def up(_schema) do
    additional_data_subject_enum = Extension.client_additional_data_subject_type()
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
      """,
      """
      CREATE TYPE #{additional_data_subject_enum} AS ENUM (
        'transaction',
        'subscription'
      )
      """,
      """
      CREATE TABLE #{Extension.client_additional_data_table()} (
        client_id VARCHAR(64),
        min_txid #{txid_type} NOT NULL,
        ord BIGINT NOT NULL,
        subject #{additional_data_subject_enum} NOT NULL,
        subscription_id UUID,
        graph_diff BYTEA NOT NULL,
        included_txns BIGINT[] NOT NULL,
        PRIMARY KEY (client_id, min_txid, ord)
      )
      """
    ]
  end

  @impl true
  def down(_), do: []
end
