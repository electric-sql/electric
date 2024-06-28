defmodule Electric.Postgres.Extension.Migrations.Migration_20240213160300_DropGenerateElectrifiedSqlFunction do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2024_02_13_16_03_00

  @impl true
  def up(schema) do
    [
      # We've changed the return type of this function so it needs to be dropped before the new definition can be
      # applied.
      "DROP ROUTINE IF EXISTS #{schema}.generate_electrified_sql(regclass)"
    ]
  end

  @impl true
  def down(_schema) do
    []
  end
end
