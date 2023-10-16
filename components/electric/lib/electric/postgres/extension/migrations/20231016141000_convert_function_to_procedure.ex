defmodule Electric.Postgres.Extension.Migrations.Migration_20231016141000_ConvertFunctionToProcedure do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2023_10_16_14_10_00

  @impl true
  def up(schema) do
    ["DROP FUNCTION IF EXISTS #{schema}.__validate_table_column_types(text)"]
  end

  @impl true
  def down(_schema) do
    []
  end
end
