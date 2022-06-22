defmodule Electric.Replication.Row do
  use Vax.Schema

  @type t() :: %__MODULE__{}

  schema "rows" do
    field(:table, :string)
    field(:schema, :string)
    field(:deleted?, Vax.Types.Flag, strategy: :enable_wins)
    field(:row, Vax.Types.Map)
  end

  @spec new(schema :: String.t(), table :: String.t(), record :: map()) :: t()
  def new(schema, table, record) do
    id = extract_id(record)

    %__MODULE__{
      id: schema <> ":" <> table <> ":" <> id,
      table: table,
      schema: schema,
      row: record
    }
  end

  @spec mark_as_deleted(t()) :: Ecto.Changeset.t(t())
  def mark_as_deleted(%__MODULE__{} = row) do
    Ecto.Changeset.change(row, deleted?: true)
  end

  # TODO: other column names?
  defp extract_id(%{"id" => id}), do: id
  defp extract_id(%{id: id}), do: id
end
