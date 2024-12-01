defmodule Electric.Shapes.Filter.Index do
  alias Electric.Replication.Eval.Env
  alias Electric.Shapes.Filter.Index
  alias Electric.Shapes.Shape

  defstruct [:type, :values]

  def new(type), do: %Index{type: type, values: %{}}

  def empty?(%Index{values: values}), do: values == %{}

  # TODO: Renmame handle to shape_id
  def add_shape(value, {handle, shape}, and_where, %Index{} = index) do
    %{
      index
      | values:
          Map.update(
            index.values,
            value,
            [%{handle: handle, and_where: and_where, shape: shape}],
            fn shapes -> [%{handle: handle, and_where: and_where, shape: shape} | shapes] end
          )
    }
  end

  def remove_shape(%Index{} = index, handle) do
    %{
      index
      | values:
          index.values
          |> Map.new(fn {value, shapes} ->
            {value, shapes |> Enum.reject(&(&1.handle == handle))}
          end)
          |> Enum.reject(fn {_value, shapes} -> shapes == [] end)
          |> Map.new()
    }
  end

  def affected_shapes(%Index{values: values, type: type}, field, record) do
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
