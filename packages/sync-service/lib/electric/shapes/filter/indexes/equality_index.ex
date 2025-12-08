defmodule Electric.Shapes.Filter.Indexes.EqualityIndex do
  @moduledoc """
  Efficiently finds shapes that are affected by a change when the shape's where clause has `field = const` in it.

  Data is stored in the Filter's eq_index_table ETS table with keys of the form:
  `{condition_id, field, value}` -> `{type, next_condition_id}`

  The type is stored to know how to parse values from records.
  The next_condition_id points to a WhereCondition for the remaining conditions
  of the where clause.

  Additionally, the field type is cached at:
  `{:type, condition_id, field}` -> type
  This enables O(1) type lookup for parsing record values.
  """

  alias Electric.Replication.Eval.Env
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.WhereCondition

  @env Env.new()

  def empty?(%Filter{eq_index_table: table}, condition_id, field) do
    :ets.lookup(table, {:type, condition_id, field}) == []
  end

  def add_shape(%Filter{eq_index_table: table} = filter, condition_id, shape_id, optimisation) do
    %{field: field, type: type, value: value, and_where: and_where} = optimisation
    key = {condition_id, field, value}

    next_condition_id =
      case :ets.lookup(table, key) do
        [] ->
          new_id = make_ref()
          WhereCondition.init(filter, new_id)
          :ets.insert(table, {key, {type, new_id}})
          :ets.insert(table, {{:type, condition_id, field}, type})

          new_id

        [{_, {_type, existing_id}}] ->
          existing_id
      end

    WhereCondition.add_shape(filter, next_condition_id, shape_id, and_where)
  end

  def remove_shape(%Filter{eq_index_table: table} = filter, condition_id, shape_id, optimisation) do
    %{field: field, value: value, and_where: and_where} = optimisation
    key = {condition_id, field, value}

    case :ets.lookup(table, key) do
      [] ->
        :ok

      [{_, {_type, next_condition_id}}] ->
        case WhereCondition.remove_shape(filter, next_condition_id, shape_id, and_where) do
          :deleted ->
            :ets.delete(table, key)

            if no_values?(table, condition_id, field) do
              :ets.delete(table, {:type, condition_id, field})
            end

          :ok ->
            :ok
        end
    end
  end

  def affected_shapes(%Filter{eq_index_table: table} = filter, condition_id, field, record) do
    case :ets.lookup(table, {:type, condition_id, field}) do
      [] -> MapSet.new()
      [{_, type}] -> affected_shapes_for_type(filter, table, condition_id, field, record, type)
    end
  end

  defp affected_shapes_for_type(filter, table, condition_id, field, record, type) do
    case value_from_record(record, field, type) do
      {:ok, value} ->
        affected_shapes_for_value(filter, table, condition_id, field, value, record)

      :error ->
        raise RuntimeError,
          message: "Could not parse value for field #{inspect(field)} of type #{inspect(type)}"
    end
  end

  defp affected_shapes_for_value(filter, table, condition_id, field, value, record) do
    case :ets.lookup(table, {condition_id, field, value}) do
      [] ->
        MapSet.new()

      [{_, {_type, next_condition_id}}] ->
        WhereCondition.affected_shapes(filter, next_condition_id, record, fn _shape -> %{} end)
    end
  end

  defp value_from_record(record, field, type) do
    Env.parse_const(@env, record[field], type)
  end

  defp no_values?(table, condition_id, field) do
    :ets.match(table, {{condition_id, field, :_}, :_}, 1) == :"$end_of_table"
  end

  def all_shape_ids(%Filter{eq_index_table: table} = filter, condition_id, field) do
    table
    |> :ets.match({{condition_id, field, :_}, {:"$1", :"$2"}})
    |> Enum.reduce(MapSet.new(), fn [_type, next_condition_id], acc ->
      MapSet.union(acc, WhereCondition.all_shape_ids(filter, next_condition_id))
    end)
  end
end
