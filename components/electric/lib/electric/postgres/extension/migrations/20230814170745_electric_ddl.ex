defmodule Electric.Postgres.Extension.Migrations.Migration_20230814170745_ElectricDDL do
  alias Electric.Postgres.Extension

  require EEx

  @behaviour Extension.Migration

  sql_file = Path.expand("20230814170745_electric_ddl/ddlx_init.sql.eex", __DIR__)

  @external_resource sql_file

  @impl true
  def version, do: 2023_08_14_17_07_45

  @impl true
  def up(schema) do
    grants_table = Extension.grants_table()
    roles_table = Extension.roles_table()
    assignments_table = Extension.assignments_table()

    ddlx_sql = ddlx_init_sql(schema, grants_table, roles_table, assignments_table)

    publish_tables =
      Enum.map(
        [grants_table, roles_table, assignments_table],
        &Extension.add_table_to_publication_sql/1
      )

    [ddlx_sql] ++ publish_tables
  end

  @impl true
  def down(_), do: []

  EEx.function_from_file(:defp, :ddlx_init_sql, sql_file, [
    :schema,
    :grants_table,
    :roles_table,
    :assignments_table
  ])
end
