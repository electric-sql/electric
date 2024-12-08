defmodule Electric.Shapes do
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache
  alias Electric.Shapes.Shape
  require Logger

  @type shape_handle :: Electric.ShapeCacheBehaviour.shape_handle()

  @doc """
  Get the snapshot followed by the log.
  """
  def get_merged_log_stream(config, shape_handle, opts) do
    {shape_cache, shape_cache_opts} = Access.get(config, :shape_cache, {ShapeCache, []})
    storage = shape_storage(config, shape_handle)
    offset = Access.get(opts, :since, LogOffset.before_all())
    max_offset = Access.get(opts, :up_to, LogOffset.last())

    if shape_cache.has_shape?(shape_handle, shape_cache_opts) do
      with :started <- shape_cache.await_snapshot_start(shape_handle, shape_cache_opts) do
        Storage.get_log_stream(offset, max_offset, storage)
      end
    else
      raise "Unknown shape: #{shape_handle}"
    end
  end

  @doc """
  Get the shape that corresponds to this shape definition and return it along with the latest offset of the shape
  """
  @spec get_shape(keyword(), Shape.t()) :: {shape_handle(), LogOffset.t()} | nil
  def get_shape(config, shape_def) do
    {shape_cache, opts} = Access.get(config, :shape_cache, {ShapeCache, []})

    shape_cache.get_shape(shape_def, opts)
  end

  @doc """
  Get or create a shape handle and return it along with the latest offset of the shape
  """
  @spec get_or_create_shape_handle(keyword(), Shape.t()) :: {shape_handle(), LogOffset.t()}
  def get_or_create_shape_handle(config, shape_def) do
    {shape_cache, opts} = Access.get(config, :shape_cache, {ShapeCache, []})

    shape_cache.get_or_create_shape_handle(shape_def, opts)
  end

  @doc """
  Get the last exclusive offset of the chunk starting from the given offset

  If `nil` is returned, chunk is not complete and the shape's latest offset should be used
  """
  @spec get_chunk_end_log_offset(keyword(), shape_handle(), LogOffset.t()) ::
          LogOffset.t() | nil
  def get_chunk_end_log_offset(config, shape_handle, offset) do
    storage = shape_storage(config, shape_handle)
    Storage.get_chunk_end_log_offset(offset, storage)
  end

  @doc """
  Check whether the log has an entry for a given shape handle
  """
  @spec has_shape?(keyword(), shape_handle()) :: boolean()
  def has_shape?(config, shape_handle) do
    {shape_cache, opts} = Access.get(config, :shape_cache, {ShapeCache, []})

    shape_cache.has_shape?(shape_handle, opts)
  end

  @doc """
  Clean up all data (meta data and shape log + snapshot) associated with the given shape handle
  """
  @spec clean_shape(shape_handle(), keyword()) :: :ok
  def clean_shape(shape_handle, opts \\ []) do
    {shape_cache, opts} = Access.get(opts, :shape_cache, {ShapeCache, []})
    shape_cache.clean_shape(shape_handle, opts)
    :ok
  end

  @spec clean_shapes([shape_handle()], keyword()) :: :ok
  def clean_shapes(shape_handles, opts \\ []) do
    {shape_cache, opts} = Access.get(opts, :shape_cache, {ShapeCache, []})

    for shape_handle <- shape_handles do
      shape_cache.clean_shape(shape_handle, opts)
    end

    :ok
  end

  defp shape_storage(config, shape_handle) do
    Storage.for_shape(shape_handle, Access.fetch!(config, :storage))
  end
end
