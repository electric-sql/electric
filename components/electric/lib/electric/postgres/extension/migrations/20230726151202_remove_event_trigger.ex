defmodule Electric.Postgres.Extension.Migrations.Migration_20230726151202_RemoveEventTrigger do
  alias Electric.Postgres.Extension

  @behaviour Extension.Migration

  @impl true
  def version, do: 2023_07_26_15_12_02

  @impl true
  def up(_) do
    Extension.event_triggers()
    |> Map.values()
    |> Enum.map(fn name -> "DROP EVENT TRIGGER #{name} CASCADE" end)
  end

  @impl true
  def down(_), do: []

  # special function to mark this migration as not needing event triggers
  # if we disable the event triggers for the migration then 
  # it's impossible to drop them...
  def disable_event_triggers?, do: false
end
