defmodule Electric.Shapes.Filter.Index do
  alias Electric.Replication.Eval.Env
  alias Electric.Shapes.Filter.Index
  alias Electric.Shapes.Shape
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
            [%{shape_id: shape_id, and_where: and_where, shape: shape}],
            fn shapes -> [%{shape_id: shape_id, and_where: and_where, shape: shape} | shapes] end
          )
    }
  end

  def remove_shape(%Index{} = index, shape_id) do
    %{
      index
      | values:
          index.values
          |> Map.new(fn {value, shapes} ->
            {value, shapes |> Enum.reject(&(&1.shape_id == shape_id))}
          end)
          |> Enum.reject(fn {_value, shapes} -> shapes == [] end)
          |> Map.new()
    }
  end

  def affected_shapes(%Index{values: values, type: type} = index, field, record) do
    case value_from_record(record, field, type) do
      {:ok, value} ->
        shapes_for_value(value, values, record)

      :error ->
        Logger.error("Could not parse value for field #{inspect(field)} of type #{inspect(type)}")
        # We can't tell which shapes are affected, the safest thing to do is return all shapes
        index
        |> all_shapes()
        |> MapSet.new(fn {shape_id, _shape} -> shape_id end)
    end
  end

  defp shapes_for_value(value, values, record) do
    case values[value] do
      nil ->
        MapSet.new()

      shapes ->
        shapes
        |> Enum.filter(&record_in_where?(&1.and_where, record))
        |> Enum.map(& &1.shape_id)
        |> MapSet.new()
    end
  end

  @env Env.new()
  defp value_from_record(record, field, type) do
    Env.parse_const(@env, record[field], type)
  end

  defp record_in_where?(nil, _), do: true

  defp record_in_where?(where_clause, record) do
    # TODO: Move record_in_shape? out of shapes into Where module
    Shape.record_in_shape?(%{where: where_clause}, record)
  end

  def all_shapes(%Index{values: values}) do
    for {_value, shapes} <- values,
        %{shape_id: shape_id, shape: shape} <- shapes,
        into: %{} do
      {shape_id, shape}
    end
  end
end
