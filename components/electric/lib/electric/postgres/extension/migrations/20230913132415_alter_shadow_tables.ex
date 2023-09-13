defmodule Electric.Postgres.Extension.Migrations.Migration_20230913132415_AlterShadowTables do
  alias Electric.Postgres.Extension

  require EEx

  @behaviour Extension.Migration

  sql_file = Path.expand("20230913132415/alter_shadow_tables.sql.eex", __DIR__)

  @external_resource sql_file

  @impl true
  def version, do: 20230913_132415

  @impl true
  def up(schema) do
    sql = alter_shadow_tables_sql(schema)

    [sql]
  end

  @impl true
  def down(_), do: []

  EEx.function_from_file(:defp, :alter_shadow_tables_sql, sql_file, [
    :schema
  ])
end
