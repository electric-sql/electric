defmodule Electric.Shapes do
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache
  alias Electric.Shapes.Shape
  require Logger

  @doc """
  Get snapshot for the shape ID
  """
  def get_snapshot(config, shape_id) do
    {shape_cache, _} = Access.get(config, :shape_cache, {ShapeCache, []})
    storage = Access.fetch!(config, :storage)

    with :ready <- shape_cache.wait_for_snapshot(shape_cache, shape_id) do
      {:ok, Storage.get_snapshot(shape_id, storage)}
    end
  end

  @doc """
  Get stream of the log since a given offset
  """
  def get_log_stream(config, shape_id, opts) do
    offset = Access.get(opts, :since, -1)
    max_offset = Access.get(opts, :up_to, :infinity)
    storage = Access.fetch!(config, :storage)

    Storage.get_log_stream(shape_id, offset, max_offset, storage)
  end

  @doc """
  Get or create a shape ID and return it along with the latest
  offset available
  """
  @spec get_or_create_shape_id(Shape.t(), keyword()) :: {Storage.shape_id(), non_neg_integer()}
  def get_or_create_shape_id(shape_def, opts \\ []) do
    {shape_cache, opts} = Access.get(opts, :shape_cache, {ShapeCache, []})

    shape_cache.get_or_create_shape_id(shape_def, opts)
  end

  @doc """
  Check whether the log has an entry for a given shape ID and offset
  """
  @spec has_log_entry?(keyword(), Storage.shape_id(), non_neg_integer()) ::
          boolean()
  def has_log_entry?(config, shape_id, offset) do
    storage = Access.fetch!(config, :storage)
    Storage.has_log_entry?(shape_id, offset, storage)
  end

  @doc """
  Clean up all data (meta data and shape log + snapshot) associated with the given shape ID
  """
  @spec clean_shape(Storage.shape_id(), keyword()) :: :ok
  def clean_shape(shape_id, opts \\ []) do
    {shape_cache, _} = Keyword.pop(opts, :shape_cache, Electric.ShapeCache)
    shape_cache.clean_shape(shape_id)
    :ok
  end
end
