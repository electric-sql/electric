defmodule Electric.Shapes.Filter.Indexes.EqualityIndex do
  @moduledoc """
  Efficiently finds shapes that are affected by a change when the shape's where clause has `field = const` in it.

  Data is stored in the Filter's eq_index_table ETS table with keys of the form:
  `{where_cond_id, field, value}` -> `{type, nested_where_cond_id}`

  The type is stored to know how to parse values from records.
  The nested_where_cond_id points to a WhereCondition that can contain further optimizations
  or shapes with additional conditions.

  Additionally, the field type is cached at:
  `{:type, where_cond_id, field}` -> type
  This enables O(1) type lookup for parsing record values.
  """

  alias Electric.Replication.Eval.Env
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.WhereCondition

  @env Env.new()

  @doc """
  Check if the index for a field is empty.
  """
  def empty?(%Filter{eq_index_table: table}, where_cond_id, field) do
    # If the type entry exists, the index has at least one value
    :ets.lookup(table, {:type, where_cond_id, field}) == []
  end

  @doc """
  Add a shape to the equality index.
  """
  def add_shape(
        %Filter{eq_index_table: table} = filter,
        where_cond_id,
        field,
        type,
        value,
        shape_id,
        and_where
      ) do
    key = {where_cond_id, field, value}

    nested_where_cond_id =
      case :ets.lookup(table, key) do
        [] ->
          # Create new nested WhereCondition
          new_id = make_ref()
          WhereCondition.init(filter, new_id)
          :ets.insert(table, {key, {type, new_id}})

          # Cache the type for O(1) lookup
          :ets.insert(table, {{:type, where_cond_id, field}, type})

          new_id

        [{_, {_type, existing_id}}] ->
          existing_id
      end

    # Add shape to nested WhereCondition
    WhereCondition.add_shape(filter, nested_where_cond_id, shape_id, and_where)
  end

  @doc """
  Remove a shape from the equality index.
  """
  def remove_shape(
        %Filter{eq_index_table: table} = filter,
        where_cond_id,
        shape_id,
        field,
        value,
        and_where
      ) do
    key = {where_cond_id, field, value}

    case :ets.lookup(table, key) do
      [] ->
        :ok

      [{_, {_type, nested_where_cond_id}}] ->
        # Remove shape from nested WhereCondition
        WhereCondition.remove_shape(filter, nested_where_cond_id, shape_id, and_where)

        # If nested condition is now empty, remove the entry
        if WhereCondition.empty?(filter, nested_where_cond_id) do
          WhereCondition.delete(filter, nested_where_cond_id)
          :ets.delete(table, key)

          # If no more values for this field, delete the type entry
          if no_values?(table, where_cond_id, field) do
            :ets.delete(table, {:type, where_cond_id, field})
          end
        end
    end
  end

  @doc """
  Delete all entries for this index.
  """
  def delete_all(%Filter{eq_index_table: table} = filter, where_cond_id, field) do
    # Find all entries for this where_cond_id and field
    pattern = {{where_cond_id, field, :_}, :"$1"}
    entries = :ets.match(table, pattern)

    # Delete each entry's nested WhereCondition
    Enum.each(entries, fn [{_type, nested_where_cond_id}] ->
      WhereCondition.delete(filter, nested_where_cond_id)
    end)

    # Delete all value entries and the type entry
    :ets.match_delete(table, {{where_cond_id, field, :_}, :_})
    :ets.delete(table, {:type, where_cond_id, field})
  end

  @doc """
  Find shapes affected by a record change.
  """
  def affected_shapes(%Filter{eq_index_table: table} = filter, where_cond_id, field, record) do
    type_key = {:type, where_cond_id, field}

    case :ets.lookup(table, type_key) do
      [] ->
        MapSet.new()

      [{_, type}] ->
        # Parse the value from the record
        case value_from_record(record, field, type) do
          {:ok, value} ->
            key = {where_cond_id, field, value}

            case :ets.lookup(table, key) do
              [] ->
                MapSet.new()

              [{_, {_type, nested_where_cond_id}}] ->
                WhereCondition.affected_shapes(filter, nested_where_cond_id, record, fn _shape ->
                  %{}
                end)
            end

          :error ->
            raise RuntimeError,
              message:
                "Could not parse value for field #{inspect(field)} of type #{inspect(type)}"
        end
    end
  end

  defp value_from_record(record, field, type) do
    Env.parse_const(@env, record[field], type)
  end

  # Check if there are any value entries for this field
  defp no_values?(table, where_cond_id, field) do
    :ets.match(table, {{where_cond_id, field, :_}, :_}, 1) == :"$end_of_table"
  end

  @doc """
  Get all shape IDs in this index.
  """
  def all_shape_ids(%Filter{eq_index_table: table} = filter, where_cond_id, field) do
    # Find all entries for this where_cond_id and field
    pattern = {{where_cond_id, field, :_}, {:"$1", :"$2"}}
    entries = :ets.match(table, pattern)

    Enum.reduce(entries, MapSet.new(), fn [_type, nested_where_cond_id], acc ->
      MapSet.union(acc, WhereCondition.all_shape_ids(filter, nested_where_cond_id))
    end)
  end
end
