defmodule Electric.Shapes.Filter.Table do
  alias Electric.Replication.Eval.Env
  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Parser.Const
  alias Electric.Replication.Eval.Parser.Func
  alias Electric.Replication.Eval.Parser.Ref
  alias Electric.Shapes.Filter.Table
  alias Electric.Shapes.Shape

  defstruct fields: %{}, other_shapes: %{}

  def empty, do: %Table{}
  def init_field_filter(type), do: %{type: type, values: %{}}

  def add_shape({handle, shape} = shape_instance, table) do
    case optimise_where(shape.where) do
      %{operation: "=", field: field, type: type, value: value, and_where: and_where} ->
        %{
          table
          | fields:
              add_shape_to_fields(
                field,
                type,
                value,
                shape_instance,
                table.fields,
                and_where
              )
        }

      :not_optimised ->
        %{table | other_shapes: Map.put(table.other_shapes, handle, shape)}
    end
  end

  defp add_shape_to_fields(field, type, value, shape_instance, fields, and_where) do
    Map.update(
      fields,
      field,
      add_shape_to_field_filter(value, shape_instance, and_where, init_field_filter(type)),
      fn field_filter ->
        add_shape_to_field_filter(value, shape_instance, and_where, field_filter)
      end
    )
  end

  # TODO: Renmame handle to shape_id
  defp add_shape_to_field_filter(value, {handle, shape}, and_where, field_filter) do
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

  defp optimise_where(%Expr{eval: eval}), do: optimise_where(eval)

  # TODO: Is this really ~s("=") or is it just "="?
  defp optimise_where(%Func{
         name: ~s("="),
         args: [%Ref{path: [field], type: type}, %Const{value: value}]
       }) do
    %{operation: "=", field: field, type: type, value: value, and_where: nil}
  end

  defp optimise_where(%Func{
         name: ~s("="),
         args: [%Const{value: value}, %Ref{path: [field], type: type}]
       }) do
    %{operation: "=", field: field, type: type, value: value, and_where: nil}
  end

  defp optimise_where(%Func{name: "and", args: [arg1, arg2]}) do
    case {optimise_where(arg1), optimise_where(arg2)} do
      {%{operation: "=", and_where: nil} = params, _} ->
        %{params | and_where: where_expr(arg2)}

      {_, %{operation: "=", and_where: nil} = params} ->
        %{params | and_where: where_expr(arg1)}

      _ ->
        :not_optimised
    end
  end

  defp optimise_where(_), do: :not_optimised

  defp where_expr(eval) do
    %Expr{eval: eval, used_refs: Parser.find_refs(eval), returns: :bool}
  end

  def remove_shape(%{fields: fields, other_shapes: other_shapes}, handle) do
    %Table{
      fields: remove_shape_from_fields(fields, handle),
      other_shapes: Map.delete(other_shapes, handle)
    }
  end

  defp remove_shape_from_fields(fields, handle) do
    fields
    |> Map.new(fn {field, %{values: value_filter} = field_filter} ->
      {field, %{field_filter | values: remove_shape_from_value_filter(value_filter, handle)}}
    end)
    |> Enum.reject(fn {_field, %{values: value_filter}} -> map_size(value_filter) == 0 end)
    |> Map.new()
  end

  defp remove_shape_from_value_filter(value_filter, handle) do
    value_filter
    |> Map.new(fn {value, shapes} -> {value, shapes |> Enum.reject(&(&1.handle == handle))} end)
    |> Enum.reject(fn {_value, shapes} -> shapes == [] end)
    |> Map.new()
  end

  def affected_shapes(%{fields: fields} = table, record) do
    fields
    |> Enum.map(&affected_shapes_by_field(&1, record))
    |> Enum.reduce(MapSet.new(), &MapSet.union(&1, &2))
    |> MapSet.union(other_shapes_affected(table, record))
  end

  def affected_shapes_by_field({field, %{values: values, type: type}}, record) do
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

  defp other_shapes_affected(%{other_shapes: shapes}, record) do
    for {handle, shape} <- shapes,
        # TODO: Test Shape.record_in_shape? is called
        Shape.record_in_shape?(shape, record),
        into: MapSet.new() do
      handle
    end
  end
end
