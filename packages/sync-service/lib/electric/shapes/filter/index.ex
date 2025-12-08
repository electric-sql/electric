defmodule Electric.Shapes.Filter.Index do
  @moduledoc """
  Efficiently finds shapes that are affected by a change, specifically for a particular operation in where clause.

  Each type of operation that has been optimised such as `=` or `@>` has its own index module
  (EqualityIndex, InclusionIndex) that stores data in ETS tables.

  This module dispatches to the appropriate index implementation based on the operation type.
  """
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.Indexes.EqualityIndex
  alias Electric.Shapes.Filter.Indexes.InclusionIndex

  defp module_for("="), do: EqualityIndex
  defp module_for("@>"), do: InclusionIndex

  def empty?(filter, where_cond_id, field, operation) do
    module_for(operation).empty?(filter, where_cond_id, field)
  end

  def add_shape(%Filter{} = filter, where_cond_id, shape_id, %{operation: op} = optimisation) do
    module_for(op).add_shape(filter, where_cond_id, shape_id, optimisation)
  end

  def remove_shape(%Filter{} = filter, where_cond_id, shape_id, %{operation: op} = optimisation) do
    module_for(op).remove_shape(filter, where_cond_id, shape_id, optimisation)
  end

  def affected_shapes(%Filter{} = filter, where_cond_id, field, operation, record) do
    module_for(operation).affected_shapes(filter, where_cond_id, field, record)
  end

  def all_shape_ids(%Filter{} = filter, where_cond_id, field, operation) do
    module_for(operation).all_shape_ids(filter, where_cond_id, field)
  end
end
