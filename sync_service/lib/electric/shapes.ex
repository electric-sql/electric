defmodule Electric.Shapes do
  alias Electric.ShapeCache.Storage
  alias Electric.InMemShapeCache
  alias Electric.ShapeCache
  alias Electric.Shapes.Shape
  require Logger

  @doc """
  Get snapshot for the shape ID
  """
  def get_snapshot(config, shape_id, shape) do
    shape_cache = Access.get(config, :shape_cache, InMemShapeCache)
    storage = Access.fetch!(config, :storage)

    with :ready <- InMemShapeCache.wait_for_snapshot(shape_cache, shape_id, shape) do
      Storage.get_snapshot(shape_id, storage)
    end
  end

  @doc """
  Get stream of the log since a given offset
  """
  def get_log_stream(config, shape_id, opts) do
    offset = Keyword.get(opts, :since, -1)
    storage = Access.fetch!(config, :storage)

    Storage.get_log_stream(shape_id, offset, storage)
  end

  @spec get_or_create_shape_id(Shape.t(), keyword()) :: {ShapeCache.shape_id(), non_neg_integer()}
  def get_or_create_shape_id(shape_def, opts \\ []) do
    {shape_cache, opts} = Keyword.pop(opts, :shape_cache, Electric.InMemShapeCache)

    shape_cache.get_or_create_shape_id(shape_def, opts)
  end
end
