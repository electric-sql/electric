defmodule Electric.Postgres.Extension.Migrations.Migration_20240205141200_ReinstallTriggerFunctionWriteCorrectMaxTag do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2024_02_05_14_12_00

  @impl true
  def up(schema) do
    [
      Extension.Functions.by_name(:"function_installers.reinstall_trigger_function"),
      Extension.Functions.by_name(:"function_installers.utils"),
      Extension.Functions.by_name(:install_function__write_correct_max_tag),
      "CALL #{schema}.reinstall_trigger_function('install_function__write_correct_max_tag')"
    ]
  end

  @impl true
  def down(_schema) do
    []
  end
end
