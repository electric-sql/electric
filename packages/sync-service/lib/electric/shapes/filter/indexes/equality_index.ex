defmodule Electric.Shapes.Filter.Indexes.EqualityIndex do
  @moduledoc """
  Efficiently finds shapes that are affected by a change when the shape's where clause has `field = const` in it.

  The index maps the values to the shapes that have that value as it's const in the `field = const` condition.

  Rather than directly adding shapes, shapes are added to a `%WhereCondition{}` which represents can contain multiple
  shapes and allows for further optimisations of other conditions in the shape's where clause.
  """
  alias Electric.Replication.Eval.Env
  alias Electric.Shapes.Filter.Index
  alias Electric.Shapes.Filter.Indexes.EqualityIndex
  alias Electric.Shapes.Filter.WhereCondition

  defstruct [:type, :values]

  def new(type), do: %EqualityIndex{type: type, values: %{}}

  defimpl Index.Protocol, for: EqualityIndex do
    def empty?(%EqualityIndex{values: values}), do: values == %{}

    def add_shape(%EqualityIndex{} = index, value, shape_id, and_where) do
      index.values
      |> Map.put_new(value, WhereCondition.new())
      |> Map.update!(value, &WhereCondition.add_shape(&1, shape_id, and_where))
      |> then(&%{index | values: &1})
    end

    def remove_shape(%EqualityIndex{} = index, value, shape_id, and_where) do
      condition =
        index.values
        |> Map.fetch!(value)
        |> WhereCondition.remove_shape(shape_id, and_where)

      if WhereCondition.empty?(condition) do
        %{index | values: Map.delete(index.values, value)}
      else
        %{index | values: Map.put(index.values, value, condition)}
      end
    end

    def affected_shapes(%EqualityIndex{values: values, type: type}, field, record, shapes) do
      case Map.get(values, value_from_record(record, field, type)) do
        nil ->
          MapSet.new()

        condition ->
          WhereCondition.affected_shapes(condition, record, shapes)
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

    def all_shape_ids(%EqualityIndex{values: values}) do
      Enum.reduce(values, MapSet.new(), fn {_value, condition}, ids ->
        MapSet.union(ids, WhereCondition.all_shape_ids(condition))
      end)
    end
  end
end
