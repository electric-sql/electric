defmodule Electric.Postgres.Extension.Migrations.Migration_20240212161153_DDLXCommands do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2024_02_12_16_11_53

  @impl true
  def up(schema) do
    ddlx_table = Extension.ddlx_table()
    assignments_table = Extension.assignments_table()
    txid_type = Extension.txid_type()
    txts_type = Extension.txts_type()

    [
      """
      CREATE TABLE #{ddlx_table} (
          id serial8 NOT NULL PRIMARY KEY,
          txid #{txid_type} NOT NULL DEFAULT #{schema}.current_xact_id(),
          txts #{txts_type} NOT NULL DEFAULT #{schema}.current_xact_ts(),
          ddlx bytea NOT NULL
      );
      """,
      """
      DROP PROCEDURE #{schema}.assign(text,text,text,text,text,text,text);
      """,
      """
      DROP PROCEDURE #{schema}.unassign(text,text,text,text,text,text);
      """,
      # change assignment id type because we're now generating this externally
      """
      ALTER TABLE #{assignments_table} ALTER COLUMN id TYPE text,
          ALTER COLUMN id DROP DEFAULT;
      """,
      Extension.add_table_to_publication_sql(ddlx_table)
    ]
  end

  @impl true
  def down(_schema) do
    []
  end
end
