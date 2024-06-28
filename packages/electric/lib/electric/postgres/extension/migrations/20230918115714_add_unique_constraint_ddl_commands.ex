defmodule Electric.Postgres.Extension.Migrations.Migration_20230918115714_DDLCommandUniqueConstraint do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2023_09_18_11_57_14

  @impl true
  def up(_schema) do
    ddl_table = Extension.ddl_table()

    [
      """
      ALTER TABLE #{ddl_table}
        ADD CONSTRAINT ddl_table_unique_migrations
        UNIQUE (txid, txts, version, query);
      """
    ]
  end

  @impl true
  def down(_), do: []
end
