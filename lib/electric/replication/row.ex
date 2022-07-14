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

  @spec new(schema :: String.t(), table :: String.t(), record :: map()) :: t()
  def new(schema, table, record) do
    id = extract_id(record)

    %__MODULE__{
      id: schema <> ":" <> table <> ":" <> id,
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

  # TODO: other column names?
  defp extract_id(%{"id" => id}), do: id
  defp extract_id(%{id: id}), do: id
end
