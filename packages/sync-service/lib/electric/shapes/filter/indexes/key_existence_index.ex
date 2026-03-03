defmodule Electric.Shapes.Filter.Indexes.KeyExistenceIndex do
  @moduledoc """
  Efficiently finds shapes that are affected by a change when the shape's where clause has `jsonb_field ? 'key'` in it.

  Data is stored in the Filter's key_exists_index_table ETS table with keys of the form:
  `{condition_id, field, key}` -> `{type, next_condition_id}`

  When a change arrives, we extract all keys from the JSONB field and look up shapes
  that require any of those keys.

  Additionally, the field type is cached at:
  `{:type, condition_id, field}` -> type
  This enables O(1) type lookup for parsing record values.
  """

  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.WhereCondition

  def add_shape(
        %Filter{key_exists_index_table: table} = filter,
        condition_id,
        shape_id,
        optimisation
      ) do
    %{field: field, type: type, value: key, and_where: and_where} = optimisation
    index_key = {condition_id, field, key}

    next_condition_id =
      case :ets.lookup(table, index_key) do
        [] ->
          new_id = make_ref()
          WhereCondition.init(filter, new_id)
          :ets.insert(table, {index_key, {type, new_id}})
          :ets.insert(table, {{:type, condition_id, field}, type})
          increment_key_count(table, condition_id, field)

          new_id

        [{_, {_type, existing_id}}] ->
          existing_id
      end

    WhereCondition.add_shape(filter, next_condition_id, shape_id, and_where)
  end

  def remove_shape(
        %Filter{key_exists_index_table: table} = filter,
        condition_id,
        shape_id,
        optimisation
      ) do
    %{field: field, value: key, and_where: and_where} = optimisation
    index_key = {condition_id, field, key}

    case :ets.lookup(table, index_key) do
      [] ->
        :deleted

      [{_, {_type, next_condition_id}}] ->
        case WhereCondition.remove_shape(filter, next_condition_id, shape_id, and_where) do
          :deleted ->
            :ets.delete(table, index_key)

            if decrement_key_count(table, condition_id, field) == 0 do
              :ets.delete(table, {:type, condition_id, field})
              :deleted
            else
              :ok
            end

          :ok ->
            :ok
        end
    end
  end

  def affected_shapes(
        %Filter{key_exists_index_table: table} = filter,
        condition_id,
        field,
        record
      ) do
    case :ets.lookup(table, {:type, condition_id, field}) do
      [] -> MapSet.new()
      [{_, _type}] -> affected_shapes_for_record(filter, table, condition_id, field, record)
    end
  end

  defp affected_shapes_for_record(filter, table, condition_id, field, record) do
    case record[field] do
      nil ->
        MapSet.new()

      value when is_binary(value) ->
        # JSONB stored as string - parse it first
        case Jason.decode(value) do
          {:ok, parsed} ->
            find_shapes_for_keys(filter, table, condition_id, field, parsed, record)

          {:error, _} ->
            MapSet.new()
        end

      value when is_map(value) ->
        # Already parsed JSONB
        find_shapes_for_keys(filter, table, condition_id, field, value, record)

      value when is_list(value) ->
        # JSONB array - check for string elements (? operator on arrays checks membership)
        find_shapes_for_array_elements(filter, table, condition_id, field, value, record)

      _ ->
        MapSet.new()
    end
  end

  defp find_shapes_for_keys(filter, table, condition_id, field, json_map, record)
       when is_map(json_map) do
    json_map
    |> Map.keys()
    |> Enum.reduce(MapSet.new(), fn key, acc ->
      case :ets.lookup(table, {condition_id, field, key}) do
        [] ->
          acc

        [{_, {_type, next_condition_id}}] ->
          MapSet.union(acc, WhereCondition.affected_shapes(filter, next_condition_id, record))
      end
    end)
  end

  defp find_shapes_for_keys(_filter, _table, _condition_id, _field, _non_map, _record) do
    MapSet.new()
  end

  defp find_shapes_for_array_elements(filter, table, condition_id, field, json_array, record) do
    json_array
    |> Enum.filter(&is_binary/1)
    |> Enum.reduce(MapSet.new(), fn element, acc ->
      case :ets.lookup(table, {condition_id, field, element}) do
        [] ->
          acc

        [{_, {_type, next_condition_id}}] ->
          MapSet.union(acc, WhereCondition.affected_shapes(filter, next_condition_id, record))
      end
    end)
  end

  defp increment_key_count(table, condition_id, field) do
    count_key = {:count, condition_id, field}

    case :ets.lookup(table, count_key) do
      [] -> :ets.insert(table, {count_key, 1})
      [{_, count}] -> :ets.insert(table, {count_key, count + 1})
    end
  end

  defp decrement_key_count(table, condition_id, field) do
    count_key = {:count, condition_id, field}
    [{_, count}] = :ets.lookup(table, count_key)
    new_count = count - 1

    if new_count == 0 do
      :ets.delete(table, count_key)
    else
      :ets.insert(table, {count_key, new_count})
    end

    new_count
  end

  def all_shape_ids(%Filter{key_exists_index_table: table} = filter, condition_id, field) do
    table
    |> :ets.match({{condition_id, field, :_}, {:"$1", :"$2"}})
    |> Enum.reduce(MapSet.new(), fn [_type, next_condition_id], acc ->
      MapSet.union(acc, WhereCondition.all_shape_ids(filter, next_condition_id))
    end)
  end
end
