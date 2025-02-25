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
  require Logger

  defstruct [:type, :values]

  def new(type), do: %EqualityIndex{type: type, values: %{}}

  defimpl Index.Protocol, for: EqualityIndex do
    def empty?(%EqualityIndex{values: values}), do: values == %{}

    def add_shape(%EqualityIndex{} = index, value, {shape_id, shape}, and_where) do
      index.values
      |> Map.put_new(value, WhereCondition.new())
      |> Map.update!(value, &WhereCondition.add_shape(&1, {shape_id, shape}, and_where))
      |> then(&%{index | values: &1})
    end

    def remove_shape(%EqualityIndex{} = index, shape_id) do
      index.values
      |> Enum.map(fn {value, condition} ->
        {value, WhereCondition.remove_shape(condition, shape_id)}
      end)
      |> Enum.reject(fn {_table, condition} -> WhereCondition.empty?(condition) end)
      |> Map.new()
      |> then(&%{index | values: &1})
    end

    def affected_shapes(%EqualityIndex{values: values, type: type}, field, record) do
      case Map.get(values, value_from_record(record, field, type)) do
        nil ->
          MapSet.new()

        condition ->
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

    def all_shapes(%EqualityIndex{values: values}) do
      for {_value, condition} <- values,
          {shape_id, shape} <- WhereCondition.all_shapes(condition),
          into: %{} do
        {shape_id, shape}
      end
    end
  end
end
