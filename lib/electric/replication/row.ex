defmodule Electric.Replication.Row do
  use Vax.Schema

  schema "rows" do
    field(:table, :string)
    field(:schema, :string)
    field(:row, Vax.Types.Map)
  end

  def new(schema, table, record) do
    id = extract_id(record)

    %__MODULE__{
      id: schema <> ":" <> table <> ":" <> id,
      table: table,
      schema: schema,
      row: record
    }
  end

  # TODO: other column names?
  defp extract_id(%{"id" => id}), do: id
  defp extract_id(%{id: id}), do: id
end
