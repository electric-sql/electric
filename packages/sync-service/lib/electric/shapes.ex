defmodule Electric.Shapes do
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache
  alias Electric.Shapes.Shape
  require Logger

  @doc """
  Get snapshot for the shape ID
  """
  def get_snapshot(config, shape_id) do
    {shape_cache, opts} = Access.get(config, :shape_cache, {ShapeCache, []})
    storage = Access.fetch!(config, :storage)
    server = Access.get(opts, :server, shape_cache)

    with :started <- shape_cache.await_snapshot_start(server, shape_id) do
      {:ok, Storage.get_snapshot(shape_id, storage)}
    end
  end

  @doc """
  Get stream of the log since a given offset
  """
  def get_log_stream(config, shape_id, opts) do
    offset = Access.get(opts, :since, LogOffset.before_all())
    max_offset = Access.get(opts, :up_to, LogOffset.last())
    storage = Access.fetch!(config, :storage)

    Storage.get_log_stream(shape_id, offset, max_offset, storage)
  end

  @doc """
  Get or create a shape ID and return it along with the latest
  offset available
  """
  @spec get_or_create_shape_id(Shape.t(), keyword()) :: {Storage.shape_id(), LogOffset.t()}
  def get_or_create_shape_id(shape_def, opts \\ []) do
    {shape_cache, opts} = Access.get(opts, :shape_cache, {ShapeCache, []})

    shape_cache.get_or_create_shape_id(shape_def, opts)
  end

  @doc """
  Check whether the log has an entry for a given shape ID
  """
  @spec has_shape?(keyword(), Storage.shape_id()) :: boolean()
  def has_shape?(config, shape_id) do
    storage = Access.fetch!(config, :storage)
    Storage.has_shape?(shape_id, storage)
  end

  @doc """
  Clean up all data (meta data and shape log + snapshot) associated with the given shape ID
  """
  @spec clean_shape(Storage.shape_id(), keyword()) :: :ok
  def clean_shape(shape_id, opts \\ []) do
    {shape_cache, opts} = Access.get(opts, :shape_cache, {ShapeCache, []})
    server = Access.get(opts, :server, shape_cache)
    shape_cache.clean_shape(server, shape_id)
    :ok
  end

  @spec clean_shapes([Storage.shape_id()], keyword()) :: :ok
  def clean_shapes(shape_ids, opts \\ []) do
    {shape_cache, opts} = Access.get(opts, :shape_cache, {ShapeCache, []})
    server = Access.get(opts, :server, shape_cache)

    for shape_id <- shape_ids do
      shape_cache.clean_shape(server, shape_id)
    end

    :ok
  end
end
