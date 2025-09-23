defmodule Electric.Shapes.Filter.Index do
  @moduledoc """
  Efficiently finds shapes that are affected by a change, specifically for a particular operation in where clause.

  Each type of operation that has been optimised such as `=` or `@>` will have it's own index module that implements the `Protocol` for this module.
  """
  alias Electric.Shapes.Filter.Index.Protocol
  alias Electric.Shapes.Filter.Indexes

  def new("=", type), do: Indexes.EqualityIndex.new(type)
  def new("@>", type), do: Indexes.InclusionIndex.new(type)

  defdelegate empty?(index), to: Protocol
  defdelegate add_shape(index, value, shape_instance, and_where), to: Protocol
  defdelegate remove_shape(index, value, shape_instance, and_where), to: Protocol
  defdelegate affected_shapes(index, field, record), to: Protocol
  defdelegate all_shapes(index), to: Protocol
end

defprotocol Electric.Shapes.Filter.Index.Protocol do
  def empty?(index)
  def add_shape(index, value, shape_instance, and_where)
  def remove_shape(index, value, shape_instance, and_where)
  def affected_shapes(index, field, record)
  def all_shapes(index)
end
