defmodule Electric.Postgres.Extension.Migrations.Migration_20240313134400_ClientShapeSubscriptionsTable do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2024_03_13_13_44_00

  @impl true
  def up(_schema) do
    [
      """
      CREATE TABLE #{Extension.client_shape_subscriptions_table()} (
        client_id TEXT,
        subscription_id UUID,
        shape_requests JSONB NOT NULL,
        PRIMARY KEY (client_id, subscription_id)
      )
      """
    ]
  end

  @impl true
  def down(_), do: []
end
