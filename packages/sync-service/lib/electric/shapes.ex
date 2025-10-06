defmodule Electric.Shapes do
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache
  alias Electric.Shapes.Shape

  import Electric, only: [is_stack_id: 1, is_shape_handle: 1]

  @type shape_handle :: Electric.ShapeCacheBehaviour.shape_handle()
  @type stack_id :: Electric.stack_id()

  @doc """
  Get the snapshot followed by the log.
  """
  def get_merged_log_stream(stack_id, shape_handle, opts)
      when is_shape_handle(shape_handle) and is_stack_id(stack_id) do
    offset = Access.get(opts, :since, LogOffset.before_all())
    max_offset = Access.get(opts, :up_to, LogOffset.last())

    if ShapeCache.has_shape?(shape_handle, stack_id) do
      with :started <- ShapeCache.await_snapshot_start(shape_handle, stack_id) do
        storage = shape_storage(stack_id, shape_handle)
        {:ok, Storage.get_log_stream(offset, max_offset, storage)}
      end
    else
      # If we have a shape handle, but no shape, it means the shape was deleted. Send a 409
      # and expect the client to retry - if the state of the world allows, it'll get a new handle.
      {:error, Electric.Shapes.Api.Error.must_refetch()}
    end
  end

  @doc """
  Get the shape that corresponds to this shape definition and return it along with the latest offset of the shape
  """
  @spec get_shape(stack_id(), Shape.t()) :: {shape_handle(), LogOffset.t()} | nil
  def get_shape(stack_id, shape_def) when is_stack_id(stack_id) do
    ShapeCache.get_shape(shape_def, stack_id)
  end

  @spec fetch_shape_by_handle(stack_id(), shape_handle()) :: Shape.t() | nil
  def fetch_shape_by_handle(stack_id, shape_handle)
      when is_shape_handle(shape_handle) and is_stack_id(stack_id) do
    ShapeCache.fetch_shape_by_handle(shape_handle, stack_id)
  end

  @doc """
  Get or create a shape handle and return it along with the latest offset of the shape
  """
  @spec get_or_create_shape_handle(stack_id(), Shape.t()) :: {shape_handle(), LogOffset.t()}
  def get_or_create_shape_handle(stack_id, shape_def) when is_stack_id(stack_id) do
    ShapeCache.get_or_create_shape_handle(
      shape_def,
      stack_id,
      otel_ctx: :otel_ctx.get_current()
    )
  end

  @doc """
  Get the last exclusive offset of the chunk starting from the given offset

  If `nil` is returned, chunk is not complete and the shape's latest offset should be used
  """
  @spec get_chunk_end_log_offset(stack_id(), shape_handle(), LogOffset.t()) :: LogOffset.t() | nil
  def get_chunk_end_log_offset(stack_id, shape_handle, offset) do
    storage = shape_storage(stack_id, shape_handle)
    Storage.get_chunk_end_log_offset(offset, storage)
  end

  @doc """
  Check whether the log has an entry for a given shape handle
  """
  @spec has_shape?(stack_id(), shape_handle()) :: boolean()
  def has_shape?(stack_id, shape_handle) do
    ShapeCache.has_shape?(shape_handle, stack_id)
  end

  @doc """
  Remove and clean up all data (meta data and shape log + snapshot) associated with
  the given shape handle
  """
  @spec clean_shape(stack_id(), shape_handle()) :: :ok
  def clean_shape(stack_id, shape_handle) do
    ShapeCache.clean_shape(shape_handle, stack_id)
    :ok
  end

  @spec clean_shapes(stack_id(), [shape_handle()]) :: :ok
  def clean_shapes(stack_id, shape_handles) do
    for shape_handle <- shape_handles do
      ShapeCache.clean_shape(shape_handle, stack_id)
    end

    :ok
  end

  defp shape_storage(stack_id, shape_handle) do
    Storage.for_shape(shape_handle, Storage.for_stack(stack_id))
  end

  def query_subset(handle, shape, subset, opts) do
    Electric.Shapes.PartialModes.query_subset(handle, shape, subset, opts)
  end
end
