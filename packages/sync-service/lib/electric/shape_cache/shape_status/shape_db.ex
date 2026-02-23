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
  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Statistics

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

  def add_shape(stack_id, %Shape{} = shape, shape_handle)
      when is_stack_id(stack_id) and is_shape_handle(shape_handle) do
    {comparable_shape, shape_hash} = Shape.comparable_hash(shape)
    relations = Shape.list_relations(shape)

    with :ok <-
           WriteBuffer.add_shape(
             stack_id,
             shape_handle,
             shape,
             comparable_shape,
             shape_hash,
             relations
           ) do
      {:ok, shape_hash}
    end
  end

  def remove_shape(stack_id, shape_handle) when is_stack_id(stack_id) do
    if handle_exists?(stack_id, shape_handle) do
      WriteBuffer.remove_shape(stack_id, shape_handle)
    else
      {:error, {:enoshape, shape_handle}}
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

  @doc """
  Find a handle for a shape. Checks buffer first, then SQLite.
  Returns :error if the handle is tombstoned (being deleted).
  """
  def handle_for_shape(stack_id, %Shape{} = shape) when is_stack_id(stack_id) do
    checkout_fun = &checkout!(stack_id, :handle_for_shape, &1)
    handle_for_shape_inner(stack_id, shape, checkout_fun)
  end

  @doc """
  Find a handle for a shape using the write connection to guarantee consistency.
  """
  def handle_for_shape_critical(stack_id, %Shape{} = shape) when is_stack_id(stack_id) do
    checkout_fun = &checkout_write!(stack_id, :handle_for_shape_critical, &1)
    handle_for_shape_inner(stack_id, shape, checkout_fun)
  end

  defp handle_for_shape_inner(stack_id, %Shape{} = shape, checkout_fun) do
    {comparable_shape, _shape_hash} = Shape.comparable_hash(shape)

    case WriteBuffer.lookup_handle(stack_id, comparable_shape) do
      {:ok, handle} ->
        {:ok, handle}

      :not_found ->
        case checkout_fun.(&Query.handle_for_shape(&1, comparable_shape)) do
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
    case WriteBuffer.lookup_shape(stack_id, shape_handle) do
      {:ok, shape} ->
        {:ok, shape}

      :not_found ->
        if WriteBuffer.is_tombstoned?(stack_id, shape_handle) do
          :error
        else
          case checkout!(stack_id, :shape_for_handle, &Query.shape_for_handle(&1, shape_handle)) do
            {:ok, shape} ->
              # Re-check tombstone after SQLite read to avoid race where
              # shape was tombstoned between the first check and SQLite query
              if WriteBuffer.is_tombstoned?(stack_id, shape_handle),
                do: :error,
                else: {:ok, shape}

            :error ->
              :error
          end
        end
    end
  end

  def list_shapes(stack_id) when is_stack_id(stack_id) do
    buffered = WriteBuffer.list_buffered_shapes(stack_id)
    tombstones = WriteBuffer.tombstoned_handles(stack_id)

    case checkout!(stack_id, :list_shapes, &Query.list_shapes/1) do
      {:ok, sqlite_shapes} ->
        shapes =
          buffered
          |> Stream.concat(
            Stream.reject(sqlite_shapes, fn {handle, _shape} ->
              MapSet.member?(tombstones, handle)
            end)
          )
          # Deduplicate to handle race between buffer flush and SQLite read
          |> Enum.uniq_by(fn {handle, _} -> handle end)

        {:ok, shapes}

      error ->
        error
    end
  end

  def list_shapes!(stack_id) when is_stack_id(stack_id) do
    stack_id |> list_shapes() |> raise_on_error!(:list_shapes)
  end

  def shape_handles_for_relations(stack_id, relations) when is_stack_id(stack_id) do
    buffered_handles = WriteBuffer.handles_for_relations(stack_id, relations)
    tombstones = WriteBuffer.tombstoned_handles(stack_id)

    case checkout!(
           stack_id,
           :shape_handles_for_relations,
           &Query.shape_handles_for_relations(&1, relations)
         ) do
      {:ok, sqlite_handles} ->
        filtered_sqlite = Enum.reject(sqlite_handles, &MapSet.member?(tombstones, &1))
        {:ok, Enum.uniq(buffered_handles ++ filtered_sqlite)}

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
    case list_shapes(stack_id) do
      {:ok, shapes} -> Enum.reduce(shapes, acc, reducer_fun)
      {:error, _} = error -> error
    end
  end

  # Only used during boot when buffer is empty
  def reduce_shape_meta(stack_id, acc, reducer_fun) when is_function(reducer_fun, 2) do
    checkout!(stack_id, :reduce_shape_meta, fn %Connection{} = conn ->
      conn
      |> Query.list_shape_meta_stream()
      |> Enum.reduce(acc, reducer_fun)
    end)
  end

  # May be slightly inaccurate during concurrent modifications due to
  # the `pending_count_diff` being updated after writes are in the database
  # meaning that changes may be counted twice for a (very) short period.
  def count_shapes(stack_id) do
    case checkout!(stack_id, :count_shapes, &Query.count_shapes/1) do
      {:ok, sqlite_count} -> {:ok, sqlite_count + WriteBuffer.pending_count_diff(stack_id)}
      error -> error
    end
  end

  def count_shapes!(stack_id) do
    stack_id |> count_shapes() |> raise_on_error!(:count_shapes)
  end

  @doc false
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

  def statistics(stack_id) do
    Statistics.current(stack_id)
  end
end
