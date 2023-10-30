defmodule Electric.Postgres.Extension.Migrations.Migration_20230512000000_conflict_resolution_triggers do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  files =
    "20230512000000_conflict_resolution_triggers/*.sql"
    |> Path.expand(__DIR__)
    |> Path.wildcard()

  for file <- files, do: @external_resource(file)

  @contents for file <- files, into: %{}, do: {Path.basename(file, ".sql"), File.read!(file)}

  @impl true
  def version, do: 2023_05_12_00_00_00

  @impl true
  def up(schema) do
    [
      @contents["electric_tag_type_and_operators"],
      @contents["trigger_function_installers"],
      @contents["shadow_table_creation_and_update"],
      Extension.Functions.by_name(:install_conflict_resolution_functions)
      # We need to actually run shadow table creation/updates, but that's handled in the next migration.
    ]
    |> Enum.map(&String.replace(&1, "electric", schema))
  end

  @impl true
  def down(_schema) do
    []
  end
end
