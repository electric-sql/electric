defmodule Electric.Shapes.Filter.Index do
  @moduledoc """
  Responsible for knowing which shapes are affected by a change to a specific field.

  The `%Table{}` struct contains `values` a map of values for a specific field to shapes that are affected by that field value.
  This acts as an index for the shapes, providing a fast way to know which shapes have been affected without having to
  iterate over all the shapes.

  Currently only `=` operations are indexed.
  """

  alias Electric.Replication.Eval.Env
  alias Electric.Shapes.Filter.Index
  alias Electric.Shapes.Filter.WhereCondition
  alias Electric.Telemetry.OpenTelemetry
  require Logger

  defstruct [:type, :values]

  def new(type), do: %Index{type: type, values: %{}}

  def empty?(%Index{values: values}), do: values == %{}

  def add_shape(%Index{} = index, value, {shape_id, shape}, and_where) do
    %{
      index
      | values:
          Map.update(
            index.values,
            value,
            WhereCondition.add_shape(WhereCondition.new(), {shape_id, shape}, and_where),
            fn condition ->
              WhereCondition.add_shape(condition, {shape_id, shape}, and_where)
            end
          )
    }
  end

  def remove_shape(%Index{} = index, shape_id) do
    %{
      index
      | values:
          index.values
          |> Map.new(fn {value, condition} ->
            {value, WhereCondition.remove_shape(condition, shape_id)}
          end)
          |> Enum.reject(fn {_table, condition} -> WhereCondition.empty?(condition) end)
          |> Map.new()
    }
  end

  def affected_shapes(%Index{values: values, type: type}, field, record) do
    case Map.get(values, value_from_record(record, field, type)) do
      nil ->
        MapSet.new()

      condition ->
        OpenTelemetry.add_span_attributes(field: field)
        WhereCondition.affected_shapes(condition, record)
    end
  end

  @env Env.new()
  defp value_from_record(record, field, type) do
    case Env.parse_const(@env, record[field], type) do
      {:ok, value} ->
        value

      :error ->
        raise RuntimeError,
          message: "Could not parse value for field #{inspect(field)} of type #{inspect(type)}"
    end
  end

  def all_shapes(%Index{values: values}) do
    for {_value, condition} <- values,
        {shape_id, shape} <- WhereCondition.all_shapes(condition),
        into: %{} do
      {shape_id, shape}
    end
  end
end
