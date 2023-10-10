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

    tables = [
      """
      CREATE TABLE IF NOT EXISTS #{grants_table} (
          privilege VARCHAR(20) NOT NULL,
          on_table VARCHAR(64) NOT NULL,
          role VARCHAR(64) NOT NULL,
          column_name VARCHAR(64) NOT NULL,
          scope VARCHAR(64) NOT NULL,
          using_path TEXT,
          check_fn TEXT,
          CONSTRAINT grants_pkey PRIMARY KEY (privilege, on_table, role, scope, column_name)
      );
      """,
      """
      CREATE TABLE IF NOT EXISTS #{roles_table} (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          role VARCHAR(64) NOT NULL,
          user_id VARCHAR(256) NOT NULL,
          scope_table VARCHAR(64),
          scope_id VARCHAR(256)
      );
      """,
      """
      CREATE TABLE IF NOT EXISTS #{assignments_table} (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          table_name VARCHAR(64) NOT NULL,
          scope_table VARCHAR(64) NOT NULL,
          user_column VARCHAR(64) NOT NULL,
          role_name VARCHAR(64) NOT NULL,
          role_column VARCHAR(64) NOT NULL,
          if_fn TEXT,
          CONSTRAINT unique_assign UNIQUE (table_name, scope_table, user_column, role_name, role_column)
      );
      """
    ]

    publish_tables =
      Enum.map(
        [grants_table, roles_table, assignments_table],
        &Extension.add_table_to_publication_sql/1
      )

    tables ++ [ddlx_sql] ++ publish_tables
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
