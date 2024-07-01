defmodule Electric.Postgres.Extension.Migrations.Migration_20231009121515_AllowLargeMigrations do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2023_10_09_121515

  @impl true

  def up(_schema) do
    ddl_table = Extension.ddl_table()

    [
      """
      ALTER TABLE #{ddl_table} ADD COLUMN query_hash bytea NOT NULL GENERATED ALWAYS AS (sha256(query::bytea)) STORED
      """,
      """
      ALTER TABLE #{ddl_table} DROP CONSTRAINT ddl_table_unique_migrations
      """,
      """
      ALTER TABLE #{ddl_table}
        ADD CONSTRAINT ddl_table_unique_migrations
        UNIQUE (txid, txts, query_hash);
      """
    ]
  end

  @impl true
  def down(_), do: []
end
