defmodule Electric.ShapeCache.ShapeStatus.ShapeDb do
  @moduledoc """
  SQLite-backed persistent storage for shape metadata.

  The WriteBuffer provides buffering for writes to prevent timeout cascades.
  Only `handle_for_shape` and `shape_for_handle` need buffer awareness since
  they are entry points for new requests. Other functions are called after
  ShapeStatus has already updated its ETS cache.
  """

  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Connection
  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Query
  alias Electric.ShapeCache.ShapeStatus.ShapeDb.WriteBuffer

  import Electric, only: [is_stack_id: 1, is_shape_handle: 1]

  import Connection,
    only: [
      checkout!: 3,
      checkout_write!: 3,
      checkout_write!: 4
    ]

  @type shape_handle() :: Electric.shape_handle()
  @type stack_id() :: Electric.stack_id()

  defmodule Error do
    defexception [:message]

    @impl true
    def exception(args) do
      action = Keyword.get(args, :action, :read)
      {:ok, error} = Keyword.fetch(args, :error)
      %__MODULE__{message: "ShapeDb #{action} failed: #{inspect(error)}"}
    end
  end

  # ============================================================================
  # Write operations - go through WriteBuffer
  # ============================================================================

  def add_shape(stack_id, %Shape{} = shape, shape_handle)
      when is_stack_id(stack_id) and is_shape_handle(shape_handle) do
    {comparable_shape, shape_hash} = Shape.comparable_hash(shape)
    relations = Shape.list_relations(shape)
    shape_binary = :erlang.term_to_binary(shape)
    comparable_binary = :erlang.term_to_binary(comparable_shape)

    :ok =
      WriteBuffer.add_shape(
        stack_id,
        shape_handle,
        shape_binary,
        comparable_binary,
        shape_hash,
        relations
      )

    {:ok, shape_hash}
  end

  def remove_shape(stack_id, shape_handle) when is_stack_id(stack_id) do
    if handle_exists?(stack_id, shape_handle) do
      WriteBuffer.remove_shape(stack_id, shape_handle)
    else
      {:error, "No shape matching #{inspect(shape_handle)}"}
    end
  end

  def mark_snapshot_started(stack_id, shape_handle) do
    if handle_exists?(stack_id, shape_handle) do
      WriteBuffer.queue_snapshot_started(stack_id, shape_handle)
    else
      :error
    end
  end

  def mark_snapshot_complete(stack_id, shape_handle) do
    if handle_exists?(stack_id, shape_handle) do
      WriteBuffer.queue_snapshot_complete(stack_id, shape_handle)
    else
      :error
    end
  end

  def reset(stack_id) when is_stack_id(stack_id) do
    WriteBuffer.clear(stack_id)
    checkout_write!(stack_id, :reset, &Query.reset/1)
  end

  # ============================================================================
  # Lookup operations - need buffer awareness (entry points for new requests)
  # ============================================================================

  @doc """
  Find a handle for a shape. Checks buffer first, then SQLite.
  Returns :error if the handle is tombstoned (being deleted).
  """
  def handle_for_shape(stack_id, %Shape{} = shape) when is_stack_id(stack_id) do
    {comparable_shape, _shape_hash} = Shape.comparable_hash(shape)
    comparable_binary = :erlang.term_to_binary(comparable_shape)

    # Check buffer first (includes tombstone check)
    case WriteBuffer.lookup_handle(stack_id, comparable_binary) do
      {:ok, handle} ->
        {:ok, handle}

      :not_found ->
        # Check SQLite, but reject tombstoned handles
        case checkout!(stack_id, :handle_for_shape, &Query.handle_for_shape(&1, comparable_shape)) do
          {:ok, handle} ->
            if WriteBuffer.is_tombstoned?(stack_id, handle) do
              :error
            else
              {:ok, handle}
            end

          :error ->
            :error
        end
    end
  end

  @doc """
  Find a shape by its handle. Checks buffer first, then SQLite.
  Returns :error if the handle is tombstoned (being deleted).
  """
  def shape_for_handle(stack_id, shape_handle) when is_stack_id(stack_id) do
    # Check buffer first (includes tombstone check)
    case WriteBuffer.lookup_shape(stack_id, shape_handle) do
      {:ok, shape} ->
        {:ok, shape}

      :not_found ->
        # Check SQLite, but reject tombstoned handles
        if WriteBuffer.is_tombstoned?(stack_id, shape_handle) do
          :error
        else
          checkout!(stack_id, :shape_for_handle, &Query.shape_for_handle(&1, shape_handle))
        end
    end
  end

  # ============================================================================
  # Read operations - go directly to SQLite (ShapeStatus ETS is source of truth)
  # ============================================================================

  def list_shapes(stack_id) when is_stack_id(stack_id) do
    # Get shapes from buffer (newly added, not yet in SQLite)
    buffered = WriteBuffer.list_buffered_shapes(stack_id)
    buffered_handles = buffered |> Enum.map(fn {h, _} -> h end) |> MapSet.new()

    # Get tombstoned handles
    tombstones = WriteBuffer.tombstoned_handles(stack_id)

    # Get shapes from SQLite
    case checkout!(stack_id, :list_shapes, &Query.list_shapes/1) do
      {:ok, sqlite_shapes} ->
        # Filter SQLite shapes: remove tombstoned and already-in-buffer handles
        filtered_sqlite =
          sqlite_shapes
          |> Enum.reject(fn {handle, _shape} ->
            MapSet.member?(tombstones, handle) or MapSet.member?(buffered_handles, handle)
          end)

        # Merge: buffered shapes + filtered SQLite shapes
        {:ok, buffered ++ filtered_sqlite}

      error ->
        error
    end
  end

  def list_shapes!(stack_id) when is_stack_id(stack_id) do
    stack_id |> list_shapes() |> raise_on_error!(:list_shapes)
  end

  def shape_handles_for_relations(stack_id, relations) when is_stack_id(stack_id) do
    # Get handles from buffer
    buffered_handles = WriteBuffer.handles_for_relations(stack_id, relations)
    buffered_set = MapSet.new(buffered_handles)
    tombstones = WriteBuffer.tombstoned_handles(stack_id)

    case checkout!(
           stack_id,
           :shape_handles_for_relations,
           &Query.shape_handles_for_relations(&1, relations)
         ) do
      {:ok, sqlite_handles} ->
        # Filter SQLite handles: remove tombstoned and already-in-buffer
        filtered_sqlite =
          sqlite_handles
          |> Enum.reject(fn handle ->
            MapSet.member?(tombstones, handle) or MapSet.member?(buffered_set, handle)
          end)

        {:ok, buffered_handles ++ filtered_sqlite}

      error ->
        error
    end
  end

  def shape_handles_for_relations!(stack_id, relations) when is_stack_id(stack_id) do
    stack_id
    |> shape_handles_for_relations(relations)
    |> raise_on_error!(:shape_handles_for_relations)
  end

  def reduce_shapes(stack_id, acc, reducer_fun) when is_function(reducer_fun, 2) do
    # Get all shapes (buffer + SQLite, excluding tombstones)
    case list_shapes(stack_id) do
      {:ok, shapes} ->
        Enum.reduce(shapes, acc, reducer_fun)

      {:error, _} = error ->
        error
    end
  end

  def reduce_shape_meta(stack_id, acc, reducer_fun) when is_function(reducer_fun, 2) do
    # Only used during boot when buffer is empty, reads directly from SQLite
    checkout!(stack_id, :reduce_shape_meta, fn %Connection{} = conn ->
      conn
      |> Query.list_shape_meta_stream()
      |> Enum.reduce(acc, reducer_fun)
    end)
  end

  def count_shapes(stack_id) do
    # Get buffered count
    buffered_count = WriteBuffer.buffered_shape_count(stack_id)
    buffered_handles = WriteBuffer.list_buffered_shapes(stack_id) |> Enum.map(fn {h, _} -> h end) |> MapSet.new()
    tombstones = WriteBuffer.tombstoned_handles(stack_id)

    # Get SQLite shapes and count those not in buffer/tombstones
    case checkout!(stack_id, :list_shapes, &Query.list_shapes/1) do
      {:ok, sqlite_shapes} ->
        sqlite_not_in_buffer =
          sqlite_shapes
          |> Enum.reject(fn {handle, _} ->
            MapSet.member?(buffered_handles, handle) or MapSet.member?(tombstones, handle)
          end)
          |> length()

        {:ok, buffered_count + sqlite_not_in_buffer}

      error ->
        error
    end
  end

  def count_shapes!(stack_id) do
    stack_id |> count_shapes() |> raise_on_error!(:count_shapes)
  end

  @doc false
  # Internal function used by remove_shape, mark_snapshot_started, mark_snapshot_complete.
  # Checks buffer first, then SQLite. Returns false if tombstoned.
  def handle_exists?(stack_id, shape_handle) when is_stack_id(stack_id) do
    case WriteBuffer.has_handle?(stack_id, shape_handle) do
      true -> true
      false -> false
      :unknown -> checkout!(stack_id, :handle_exists?, &Query.handle_exists?(&1, shape_handle))
    end
  end

  def validate_existing_shapes(stack_id) do
    # Must flush buffer before validating so we check persisted state
    WriteBuffer.flush_sync(stack_id)

    with {:ok, removed_handles} <-
           checkout_write!(
             stack_id,
             :validate_existing_shapes,
             fn %Connection{} = conn ->
               with {:ok, handles} <- Query.select_invalid(conn) do
                 Enum.each(handles, fn handle ->
                   :ok = Query.remove_shape(conn, handle)
                 end)

                 {:ok, handles}
               end
             end,
             # increase timeout because we may end up doing a lot of work here
             60_000
           ),
         {:ok, count} <- count_shapes(stack_id) do
      {:ok, removed_handles, count}
    end
  end

  def explain(stack_id) do
    Connection.explain(stack_id)

    :ok
  end

  @doc "Returns the number of pending writes in the buffer"
  @spec pending_buffer_size(stack_id()) :: non_neg_integer()
  def pending_buffer_size(stack_id) when is_stack_id(stack_id) do
    WriteBuffer.pending_operations_count(stack_id)
  end

  defp raise_on_error!({:ok, result}, _action), do: result

  defp raise_on_error!({:error, reason}, action) do
    raise Error, error: reason, action: action
  end
end
