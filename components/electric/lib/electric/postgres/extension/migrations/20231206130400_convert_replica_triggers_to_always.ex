defmodule Electric.Postgres.Extension.Migrations.Migration_20231206130400_ConvertReplicaTriggersToAlways do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  sql_file =
    Path.expand(
      "20231206130400_convert_replica_triggers_to_always/replace_replica_triggers.sql",
      __DIR__
    )

  @external_resource sql_file

  @migration_sql File.read!(sql_file)

  @impl true
  def version, do: 2023_12_06_13_04_00

  @impl true
  def up(_schema) do
    [Extension.Functions.by_name(:__session_replication_role), @migration_sql]
  end

  @impl true
  def down(_schema) do
    []
  end
end
