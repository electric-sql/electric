defmodule Electric.Replication.Row do
  use Vax.Schema

  @type t() :: %__MODULE__{}

  schema "rows" do
    field(:table, :string)
    field(:schema, :string)
    field(:last_operation, :string)
    field(:deleted?, Vax.Types.Flag, conflict_resolution: :disable_wins)
    field(:row, Vax.Types.Map)
  end

  @spec new(schema :: String.t(), table :: String.t(), record :: map(), keys :: [String.t(), ...]) ::
          t()
  def new(schema, table, record, primary_keys) do
    %__MODULE__{
      id: extract_id(schema, table, primary_keys, record),
      table: table,
      schema: schema,
      row: record,
      deleted?: false
    }
  end

  # hack, fix in vax (change is not being propagated because of default value)
  def force_deleted_update(%__MODULE__{} = row, value) do
    row
    |> Ecto.Changeset.change()
    |> force_deleted_update(value)
  end

  def force_deleted_update(%Ecto.Changeset{} = changeset, value) do
    %{changeset | changes: Map.put(changeset.changes, :deleted?, value)}
  end

  defp extract_id(schema, table, keys, record) do
    primary_keys_joined =
      record
      |> Map.take(keys)
      |> Map.values()
      |> Enum.join(":")

    schema <> ":" <> table <> ":" <> primary_keys_joined
  end
end
