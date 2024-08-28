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
    storage = shape_storage(config, shape_id)

    if shape_cache.has_shape?(shape_id, opts) do
      with :started <- shape_cache.await_snapshot_start(shape_id, opts) do
        {:ok, Storage.get_snapshot(shape_id, storage)}
      end
    else
      {:error, "invalid shape_id #{inspect(shape_id)}"}
    end
  end

  @doc """
  Get stream of the log since a given offset
  """
  def get_log_stream(config, shape_id, opts) do
    {shape_cache, shape_cache_opts} = Access.get(config, :shape_cache, {ShapeCache, []})
    offset = Access.get(opts, :since, LogOffset.before_all())
    max_offset = Access.get(opts, :up_to, LogOffset.last())
    storage = shape_storage(config, shape_id)

    with true <- shape_cache.has_shape?(shape_id, shape_cache_opts) do
      Storage.get_log_stream(shape_id, offset, max_offset, storage)
    end
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
    {shape_cache, opts} = Access.get(config, :shape_cache, {ShapeCache, []})

    shape_cache.has_shape?(shape_id, opts)
  end

  @doc """
  Clean up all data (meta data and shape log + snapshot) associated with the given shape ID
  """
  @spec clean_shape(Storage.shape_id(), keyword()) :: :ok
  def clean_shape(shape_id, opts \\ []) do
    {shape_cache, opts} = Access.get(opts, :shape_cache, {ShapeCache, []})
    shape_cache.clean_shape(shape_id, opts)
    :ok
  end

  @spec clean_shapes([Storage.shape_id()], keyword()) :: :ok
  def clean_shapes(shape_ids, opts \\ []) do
    {shape_cache, opts} = Access.get(opts, :shape_cache, {ShapeCache, []})

    for shape_id <- shape_ids do
      shape_cache.clean_shape(shape_id, opts)
    end

    :ok
  end

  defp shape_storage(config, shape_id) do
    Storage.for_shape(shape_id, Access.fetch!(config, :storage))
  end
end
