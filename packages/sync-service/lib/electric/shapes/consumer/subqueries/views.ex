defmodule Electric.Shapes.Consumer.Subqueries.Views do
  # Applies dependency move operations against the current subquery view map.

  @type ref() :: [String.t()]
  @type t() :: %{ref() => MapSet.t()}

  @spec current(t(), ref()) :: MapSet.t()
  def current(views, subquery_ref), do: Map.get(views, subquery_ref, MapSet.new())

  @spec apply_move(t(), ref(), list(), :move_in | :move_out) :: t()
  def apply_move(views, subquery_ref, values, :move_in) do
    Map.update!(views, subquery_ref, fn view ->
      Enum.reduce(values, view, fn {value, _original_value}, view ->
        MapSet.put(view, value)
      end)
    end)
  end

  def apply_move(views, subquery_ref, values, :move_out) do
    Map.update!(views, subquery_ref, fn view ->
      Enum.reduce(values, view, fn {value, _original_value}, view ->
        MapSet.delete(view, value)
      end)
    end)
  end
end
