defmodule Electric.Postgres.Extension.Migrations.Migration_20240110110200_DropUnusedFunctions do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2024_01_10_11_02_00

  @impl true
  def up(schema) do
    [
      "DROP ROUTINE IF EXISTS #{schema}.__validate_table_column_defaults(text)",
      "DROP ROUTINE IF EXISTS #{schema}.__validate_table_column_types(text)"
    ]
  end

  @impl true
  def down(_schema) do
    []
  end
end
