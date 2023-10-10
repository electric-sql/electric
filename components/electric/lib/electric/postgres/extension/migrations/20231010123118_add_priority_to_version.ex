defmodule Electric.Postgres.Extension.Migrations.Migration20231010123118_AddPriorityToVersion do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2023_10_10_12_31_18

  @impl true
  def up(_schema) do
    version_table = Extension.version_table()

    [
      """
      ALTER TABLE #{version_table} ADD COLUMN priority int2 NOT NULL DEFAULT 0;
      """
    ]
  end

  @impl true
  def down(_schema) do
    []
  end
end
