defmodule Electric.Postgres.Extension.Migrations.Migration_20231010123118_AddPriorityToVersion do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2023_10_10_12_31_18

  @impl true
  def up(schema) do
    version_table = Extension.version_table()

    [
      # drop the existing single-argument version of assign_migration_version
      """
      DROP PROCEDURE IF EXISTS #{schema}.assign_migration_version(text)
      """,
      """
      ALTER TABLE #{version_table} ADD COLUMN priority int2 NOT NULL DEFAULT 0
      """
    ]
  end

  @impl true
  def down(_schema) do
    []
  end
end
