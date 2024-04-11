defmodule Electric.Postgres.Extension.Migrations.Migration_20240501000000_UnsubPoints do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2024_05_01_00_00_00

  @impl true
  def up(_schema) do
    [
      """
      CREATE TABLE #{Extension.client_unsub_points_table()} (
        client_id VARCHAR(64) NOT NULL,
        subscription_id UUID NOT NULL,
        wal_pos BIGINT NOT NULL,
        PRIMARY KEY (client_id, subscription_id)
      )
      """
    ]
  end

  @impl true
  def down(_), do: []
end
