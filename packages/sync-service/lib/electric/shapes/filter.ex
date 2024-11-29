defmodule Electric.Shapes.Filter do
  alias Electric.Replication.Changes.DeletedRecord
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.TruncatedRelation
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Replication.Eval.Env
  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Parser.Const
  alias Electric.Replication.Eval.Parser.Func
  alias Electric.Replication.Eval.Parser.Ref
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.TableFilter
  alias Electric.Shapes.Shape

  defstruct tables: %{}

  def new(shapes), do: shapes |> Map.to_list() |> new(empty())
  defp new([{handle, shape} | shapes], filter), do: new(shapes, add_shape(filter, handle, shape))
  defp new([], filter), do: filter

  def add_shape(%Filter{tables: tables}, handle, shape) do
    %Filter{
      tables:
        Map.update(
          tables,
          shape.root_table,
          add_shape_to_table_filter({handle, shape}, empty_table_filter()),
          fn table_filter -> add_shape_to_table_filter({handle, shape}, table_filter) end
        )
    }
  end

  def remove_shape(%Filter{tables: tables}, handle) do
    %Filter{
      tables:
        tables
        |> Enum.map(fn {table, table_filter} ->
          {table, TableFilter.remove_shape(table_filter, handle)}
        end)
        |> Enum.reject(fn {_table, table_filter} -> map_size(table_filter.fields) == 0 end)
        |> Map.new()
    }
  end

  def empty, do: %Filter{}
  defp empty_table_filter, do: %{fields: %{}, other_shapes: %{}}
  defp init_field_filter(type), do: %{type: type, values: %{}}

  defp add_shape_to_table_filter({handle, shape} = shape_instance, table_filter) do
    case optimise_where(shape.where) do
      %{operation: "=", field: field, type: type, value: value, and_where: and_where} ->
        %{
          table_filter
          | fields:
              add_shape_to_fields(
                field,
                type,
                value,
                shape_instance,
                table_filter.fields,
                and_where
              )
        }

      :not_optimised ->
        %{table_filter | other_shapes: Map.put(table_filter.other_shapes, handle, shape)}
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
        %{params | and_where: arg2}

      {_, %{operation: "=", and_where: nil} = params} ->
        %{params | and_where: arg1}

      _ ->
        :not_optimised
    end
  end

  defp optimise_where(_), do: :not_optimised

  def affected_shapes(%Filter{} = filter, %Relation{} = relation) do
    # Check all shapes is all tables becuase the table may have been renamed
    for {handle, shape} <- all_shapes_in_filter(filter),
        Shape.is_affected_by_relation_change?(shape, relation),
        into: MapSet.new() do
      handle
    end
  end

  def affected_shapes(%Filter{} = filter, %Transaction{changes: changes}) do
    changes
    |> Enum.map(&affected_shapes(filter, &1))
    |> Enum.reduce(MapSet.new(), &MapSet.union(&1, &2))
  end

  # TODO: Optimisation: each time a shape is affected, take it out of `other_shapes`

  def affected_shapes(%Filter{} = filter, %NewRecord{relation: relation, record: record}) do
    affected_shapes_by_record(filter, relation, record)
  end

  def affected_shapes(%Filter{} = filter, %DeletedRecord{relation: relation, old_record: record}) do
    affected_shapes_by_record(filter, relation, record)
  end

  def affected_shapes(%Filter{} = filter, %UpdatedRecord{relation: relation} = change) do
    MapSet.union(
      affected_shapes_by_record(filter, relation, change.record),
      affected_shapes_by_record(filter, relation, change.old_record)
    )
  end

  # TODO: Optimisation: Do TruncatedRelations first and then just process other changes for other tables

  def affected_shapes(%Filter{} = filter, %TruncatedRelation{relation: table}) do
    for {handle, _shape} <- all_shapes_for_table(filter, table),
        into: MapSet.new() do
      handle
    end
  end

  defp affected_shapes_by_record(filter, table, record) do
    case Map.get(filter.tables, table) do
      nil -> MapSet.new()
      table_filter -> affected_shapes_by_table(table_filter, record)
    end
  end

  defp affected_shapes_by_table(%{fields: fields} = table_filter, record) do
    fields
    |> Enum.map(&affected_shapes_by_field(&1, record))
    |> Enum.reduce(MapSet.new(), &MapSet.union(&1, &2))
    |> MapSet.union(other_shapes_affected(table_filter, record))
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

  defp value_from_record(record, field, type) do
    # TODO: should we expect this to be ok?
    {:ok, value} = Env.parse_const(Env.new(), record[field], type)
    value
  end

  defp record_in_where?(nil, _), do: true

  defp record_in_where?(where_clause, record) do
    # TODO: Move record_in_shape? out of shapes into Where module
    # Keep full Expr in shape
    Shape.record_in_shape?(
      %{where: %Expr{eval: where_clause, used_refs: Parser.find_refs(where_clause)}},
      record
    )
  end

  defp other_shapes_affected(%{other_shapes: shapes}, record) do
    for {handle, shape} <- shapes,
        # TODO: Test Shape.record_in_shape? is called
        Shape.record_in_shape?(shape, record),
        into: MapSet.new() do
      handle
    end
  end

  defp all_shapes_in_filter(%Filter{} = filter) do
    for {_table, table_filter} <- filter.tables,
        {handle, shape} <- all_shapes_in_table_filter(table_filter),
        into: %{} do
      {handle, shape}
    end
  end

  defp all_shapes_in_table_filter(%{fields: fields, other_shapes: other_shapes}) do
    for {_field, %{values: values}} <- fields,
        {_value, shapes} <- values,
        %{handle: handle, shape: shape} <- shapes,
        into: %{} do
      {handle, shape}
    end
    |> Map.merge(other_shapes)
  end

  defp all_shapes_for_table(%Filter{} = filter, table) do
    case Map.get(filter.tables, table) do
      nil ->
        %{}

      table_filter ->
        all_shapes_in_table_filter(table_filter)
    end
  end
end
