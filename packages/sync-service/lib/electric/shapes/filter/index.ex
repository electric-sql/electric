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
  defdelegate add_shape(index, value, shape_id, and_where, shape_bitmap), to: Protocol
  defdelegate remove_shape(index, value, shape_id, and_where, shape_bitmap), to: Protocol
  defdelegate affected_shapes(index, field, record, shapes), to: Protocol
  defdelegate affected_shapes_bitmap(index, field, record, shapes, shape_bitmap), to: Protocol
  defdelegate all_shape_ids(index), to: Protocol
  defdelegate all_shapes_bitmap(index, shape_bitmap), to: Protocol
end

defprotocol Electric.Shapes.Filter.Index.Protocol do
  @doc "Returns true if the index is empty"
  def empty?(index)

  @doc "Adds a shape to the index"
  def add_shape(index, value, shape_id, and_where, shape_bitmap)

  @doc "Removes a shape from the index"
  def remove_shape(index, value, shape_id, and_where, shape_bitmap)

  @doc "Returns a MapSet of shape IDs affected by the record (legacy)"
  def affected_shapes(index, field, record, shapes)

  @doc "Returns a RoaringBitmap of shape IDs affected by the record (optimized)"
  def affected_shapes_bitmap(index, field, record, shapes, shape_bitmap)

  @doc "Returns a MapSet of all shape IDs in the index (legacy)"
  def all_shape_ids(index)

  @doc "Returns a RoaringBitmap of all shape IDs in the index (optimized)"
  def all_shapes_bitmap(index, shape_bitmap)
end
