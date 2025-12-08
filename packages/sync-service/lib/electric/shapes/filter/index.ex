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

  @doc """
  Check if an index is empty.
  """
  def empty?(filter, where_cond_id, field, "=") do
    EqualityIndex.empty?(filter, where_cond_id, field)
  end

  def empty?(filter, where_cond_id, field, "@>") do
    InclusionIndex.empty?(filter, where_cond_id, field)
  end

  @doc """
  Add a shape to an index.
  """
  def add_shape(%Filter{} = filter, where_cond_id, shape_id, %{operation: "="} = optimisation) do
    EqualityIndex.add_shape(
      filter,
      where_cond_id,
      optimisation.field,
      optimisation.type,
      optimisation.value,
      shape_id,
      optimisation.and_where
    )
  end

  def add_shape(%Filter{} = filter, where_cond_id, shape_id, %{operation: "@>"} = optimisation) do
    InclusionIndex.add_shape(
      filter,
      where_cond_id,
      optimisation.field,
      optimisation.type,
      optimisation.value,
      shape_id,
      optimisation.and_where
    )
  end

  @doc """
  Remove a shape from an index.
  """
  def remove_shape(%Filter{} = filter, where_cond_id, shape_id, %{operation: "="} = optimisation) do
    EqualityIndex.remove_shape(
      filter,
      where_cond_id,
      shape_id,
      optimisation.field,
      optimisation.value,
      optimisation.and_where
    )
  end

  def remove_shape(%Filter{} = filter, where_cond_id, shape_id, %{operation: "@>"} = optimisation) do
    InclusionIndex.remove_shape(
      filter,
      where_cond_id,
      shape_id,
      optimisation.field,
      optimisation.value,
      optimisation.and_where
    )
  end

  @doc """
  Find shapes affected by a record change.
  """
  def affected_shapes(%Filter{} = filter, where_cond_id, field, "=", record) do
    EqualityIndex.affected_shapes(filter, where_cond_id, field, record)
  end

  def affected_shapes(%Filter{} = filter, where_cond_id, field, "@>", record) do
    InclusionIndex.affected_shapes(filter, where_cond_id, field, record)
  end

  @doc """
  Get all shape IDs in an index.
  """
  def all_shape_ids(%Filter{} = filter, where_cond_id, field, "=") do
    EqualityIndex.all_shape_ids(filter, where_cond_id, field)
  end

  def all_shape_ids(%Filter{} = filter, where_cond_id, field, "@>") do
    InclusionIndex.all_shape_ids(filter, where_cond_id, field)
  end
end
