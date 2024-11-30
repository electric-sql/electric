defmodule Electric.Shapes.Filter.Field do
  alias Electric.Replication.Eval.Env
  alias Electric.Shapes.Shape

  defstruct fields: %{}, other_shapes: %{}

  def new(type), do: %{type: type, values: %{}}

  # TODO: Renmame handle to shape_id
  def add_shape(value, {handle, shape}, and_where, field_filter) do
    %{
      field_filter
      | values:
          Map.update(
            field_filter.values,
            value,
            [%{handle: handle, and_where: and_where, shape: shape}],
            fn shapes -> [%{handle: handle, and_where: and_where, shape: shape} | shapes] end
          )
    }
  end

  def remove_shape_from_value_filter(value_filter, handle) do
    value_filter
    |> Map.new(fn {value, shapes} -> {value, shapes |> Enum.reject(&(&1.handle == handle))} end)
    |> Enum.reject(fn {_value, shapes} -> shapes == [] end)
    |> Map.new()
  end

  def affected_shapes({field, %{values: values, type: type}}, record) do
    case values[value_from_record(record, field, type)] do
      nil ->
        MapSet.new()

      shapes ->
        shapes
        |> Enum.filter(&record_in_where?(&1.and_where, record))
        |> Enum.map(& &1.handle)
        |> MapSet.new()
    end
  end

  @env Env.new()
  defp value_from_record(record, field, type) do
    # TODO: should we expect this to be ok?
    {:ok, value} = Env.parse_const(@env, record[field], type)
    value
  end

  defp record_in_where?(nil, _), do: true

  defp record_in_where?(where_clause, record) do
    # TODO: Move record_in_shape? out of shapes into Where module
    Shape.record_in_shape?(%{where: where_clause}, record)
  end
end
