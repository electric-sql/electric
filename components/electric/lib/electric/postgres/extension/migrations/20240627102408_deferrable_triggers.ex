defmodule Electric.Postgres.Extension.Migrations.Migration_20240627102408_DeferrableTriggers do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2024_06_27_10_24_08

  @impl true
  def up(_schema) do
    electrified_tracking_table = Extension.electrified_tracking_table()

    [
      # set the default false because future tables will not have the triggers installed by default
      """
      ALTER TABLE #{electrified_tracking_table} ADD COLUMN write_triggers_installed boolean NOT NULL DEFAULT false;
      """,
      # but any existing electrified tables do have the triggers installed
      """
      UPDATE #{electrified_tracking_table} SET write_triggers_installed=true;
      """
    ]
  end
end
