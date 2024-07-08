defmodule Electric.Shapes.Shape do
  @moduledoc """
  Struct describing the requested shape
  """
  @enforce_keys [:root_table]
  defstruct [:root_table]

  @type t() :: %__MODULE__{root_table: Electric.relation()}

  def hash(%__MODULE__{} = shape), do: :erlang.phash2(shape)

  def new!(definition, opts) do
    case from_string(definition, opts) do
      {:ok, shape} -> shape
      {:error, [message | _]} -> raise message
    end
  end

  def from_string(definition, _opts) do
    case String.split(definition, ".") do
      [table_name] when table_name != "" ->
        {:ok, %__MODULE__{root_table: {"public", table_name}}}

      [schema_name, table_name] when schema_name != "" and table_name != "" ->
        {:ok, %__MODULE__{root_table: {schema_name, table_name}}}

      _ ->
        {:error, ["table name does not match expected format"]}
    end
  end

  def change_in_shape?(%__MODULE__{} = shape, change), do: shape.root_table == change.relation
end

defimpl Inspect, for: Electric.Shapes.Shape do
  import Inspect.Algebra

  def inspect(shape, _opts) do
    {schema, table} = shape.root_table
    concat(["Shape.new!(\"", schema, ".", table, "\", opts)"])
  end
end
