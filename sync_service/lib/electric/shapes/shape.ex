defmodule Electric.Shapes.Shape do
  @enforce_keys [:root_table]
  defstruct [:root_table]

  @type t() :: %__MODULE__{root_table: Electric.relation()}

  def hash(%__MODULE__{} = shape), do: :erlang.phash2(shape)

  def from_string(definition, _opts) do
    case String.split(definition, ".") do
      [table_name] ->
        {:ok, %__MODULE__{root_table: {"public", table_name}}}

      [schema_name, table_name] when schema_name != "" and table_name != "" ->
        {:ok, %__MODULE__{root_table: {schema_name, table_name}}}

      _ ->
        {:error, ["table name does not match expected format"]}
    end
  end

  def change_in_shape?(%__MODULE__{} = shape, change), do: shape.root_table == change.relation
end
