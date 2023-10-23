defmodule Electric.Postgres.Extension.Migrations.Migration_20230921161045_DropEventTriggers do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2023_09_21_161045

  @impl true
  def up(schema) do
    # this needs to run in a separate tx before the rest of the proxy conversion stuff
    [
      """
      DROP EVENT TRIGGER IF EXISTS "#{schema}_event_trigger_ddl_end" CASCADE;
      """,
      """
      DROP EVENT TRIGGER IF EXISTS "#{schema}_event_trigger_sql_drop" CASCADE;
      """,
      """
      DROP FUNCTION IF EXISTS "#{schema}.ddlx_sql_drop_handler" CASCADE;
      """,
      """
      DROP FUNCTION IF EXISTS "#{schema}.ddlx_command_end_handler" CASCADE;
      """
    ]
  end

  @impl true
  def down(_), do: []
end
