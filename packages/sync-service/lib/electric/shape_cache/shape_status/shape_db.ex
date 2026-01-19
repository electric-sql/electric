defmodule Electric.ShapeCache.ShapeStatus.ShapeDb do
  @moduledoc false

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
    if shape_exists_in_buffer_or_sqlite?(stack_id, shape_handle) do
      WriteBuffer.remove_shape(stack_id, shape_handle)
    else
      {:error, "No shape matching #{inspect(shape_handle)}"}
    end
  end

  def handle_for_shape(stack_id, %Shape{} = shape) when is_stack_id(stack_id) do
    {comparable_shape, _shape_hash} = Shape.comparable_hash(shape)
    comparable_binary = :erlang.term_to_binary(comparable_shape)

    case WriteBuffer.lookup_handle(stack_id, comparable_binary) do
      {:ok, handle} ->
        {:ok, handle}

      :not_found ->
        # Check SQLite, but filter out handles with pending removes
        case checkout!(stack_id, :handle_for_shape, &Query.handle_for_shape(&1, comparable_shape)) do
          {:ok, handle} ->
            pending_removes = WriteBuffer.pending_removes(stack_id)

            if MapSet.member?(pending_removes, handle) do
              :error
            else
              {:ok, handle}
            end

          :error ->
            :error
        end
    end
  end

  def shape_for_handle(stack_id, shape_handle) when is_stack_id(stack_id) do
    case WriteBuffer.lookup_shape(stack_id, shape_handle) do
      {:ok, shape} ->
        {:ok, shape}

      :not_found ->
        checkout!(stack_id, :shape_for_handle, &Query.shape_for_handle(&1, shape_handle))
    end
  end

  def list_shapes(stack_id) when is_stack_id(stack_id) do
    with {:ok, sqlite_shapes} <- checkout!(stack_id, :list_shapes, &Query.list_shapes/1) do
      buffered_shapes = WriteBuffer.list_shapes(stack_id)
      pending_removes = WriteBuffer.pending_removes(stack_id)
      buffered_handles = MapSet.new(buffered_shapes, &elem(&1, 0))

      # Filter SQLite shapes: exclude those with pending removes or already in buffer
      filtered_sqlite =
        Enum.reject(sqlite_shapes, fn {handle, _} ->
          MapSet.member?(pending_removes, handle) or MapSet.member?(buffered_handles, handle)
        end)

      {:ok, Enum.sort_by(buffered_shapes ++ filtered_sqlite, &elem(&1, 0))}
    end
  end

  def list_shapes!(stack_id) when is_stack_id(stack_id) do
    stack_id |> list_shapes() |> raise_on_error!(:list_shapes)
  end

  def shape_handles_for_relations(stack_id, relations) when is_stack_id(stack_id) do
    with {:ok, sqlite_handles} <-
           checkout!(
             stack_id,
             :shape_handles_for_relations,
             &Query.shape_handles_for_relations(&1, relations)
           ) do
      buffered_handles = WriteBuffer.handles_for_relations(stack_id, relations)
      pending_removes = WriteBuffer.pending_removes(stack_id)
      buffered_set = MapSet.new(buffered_handles)

      # Filter SQLite handles: exclude those with pending removes or already in buffer
      filtered_sqlite =
        Enum.reject(sqlite_handles, fn handle ->
          MapSet.member?(pending_removes, handle) or MapSet.member?(buffered_set, handle)
        end)

      {:ok, (buffered_handles ++ filtered_sqlite) |> Enum.sort()}
    end
  end

  def shape_handles_for_relations!(stack_id, relations) when is_stack_id(stack_id) do
    stack_id
    |> shape_handles_for_relations(relations)
    |> raise_on_error!(:shape_handles_for_relations)
  end

  def reduce_shapes(stack_id, acc, reducer_fun) when is_function(reducer_fun, 2) do
    buffered_shapes = WriteBuffer.list_shapes(stack_id)
    pending_removes = WriteBuffer.pending_removes(stack_id)
    buffered_handles = MapSet.new(buffered_shapes, &elem(&1, 0))
    acc = Enum.reduce(buffered_shapes, acc, reducer_fun)

    checkout!(stack_id, :reduce_shapes, fn %Connection{} = conn ->
      conn
      |> Query.list_shape_stream()
      |> Stream.reject(fn {handle, _} ->
        MapSet.member?(pending_removes, handle) or MapSet.member?(buffered_handles, handle)
      end)
      |> Enum.reduce(acc, reducer_fun)
    end)
  end

  def reduce_shape_meta(stack_id, acc, reducer_fun) when is_function(reducer_fun, 2) do
    buffered_meta = WriteBuffer.list_shape_meta(stack_id)
    pending_removes = WriteBuffer.pending_removes(stack_id)
    pending_snapshot_started = WriteBuffer.pending_snapshot_started(stack_id)
    buffered_handles = MapSet.new(buffered_meta, &elem(&1, 0))
    acc = Enum.reduce(buffered_meta, acc, reducer_fun)

    checkout!(stack_id, :reduce_shape_meta, fn %Connection{} = conn ->
      conn
      |> Query.list_shape_meta_stream()
      |> Stream.reject(fn {handle, _, _} ->
        MapSet.member?(pending_removes, handle) or MapSet.member?(buffered_handles, handle)
      end)
      |> Stream.map(fn {handle, hash, snapshot_started} ->
        # Update snapshot_started if there's a pending operation
        if MapSet.member?(pending_snapshot_started, handle) do
          {handle, hash, true}
        else
          {handle, hash, snapshot_started}
        end
      end)
      |> Enum.reduce(acc, reducer_fun)
    end)
  end

  def shape_hash(stack_id, shape_handle) do
    case WriteBuffer.lookup_hash(stack_id, shape_handle) do
      {:ok, hash} -> {:ok, hash}
      :not_found -> checkout!(stack_id, :shape_hash, &Query.shape_hash(&1, shape_handle))
    end
  end

  def handle_exists?(stack_id, shape_handle) do
    # Check buffer first - if shape is there, it exists
    if WriteBuffer.handle_exists?(stack_id, shape_handle) do
      true
    else
      # Shape not in buffer - check if there's a pending remove or check SQLite
      pending_removes = WriteBuffer.pending_removes(stack_id)

      if MapSet.member?(pending_removes, shape_handle) do
        false
      else
        checkout!(stack_id, :handle_exists?, &Query.handle_exists?(&1, shape_handle))
      end
    end
  end

  def count_shapes(stack_id) do
    with {:ok, sqlite_count} <- checkout!(stack_id, :count_shapes, &Query.count_shapes/1) do
      buffered_count = WriteBuffer.shapes_count(stack_id)
      pending_adds = WriteBuffer.pending_adds(stack_id)
      pending_removes = WriteBuffer.pending_removes(stack_id)

      # Only count removes for shapes that are actually in SQLite (not pending adds)
      # If a shape has both pending add and pending remove, they cancel out
      removes_from_sqlite = MapSet.difference(pending_removes, pending_adds)

      # Total = buffer shapes + SQLite shapes - removes that will affect SQLite
      {:ok, buffered_count + sqlite_count - MapSet.size(removes_from_sqlite)}
    end
  end

  def count_shapes!(stack_id) do
    stack_id |> count_shapes() |> raise_on_error!(:count_shapes)
  end

  def mark_snapshot_started(stack_id, shape_handle) do
    if shape_exists_in_buffer_or_sqlite?(stack_id, shape_handle) do
      WriteBuffer.queue_snapshot_started(stack_id, shape_handle)
    else
      :error
    end
  end

  def snapshot_started?(stack_id, shape_handle) do
    case WriteBuffer.snapshot_started?(stack_id, shape_handle) do
      {:ok, true} ->
        true

      {:ok, false} ->
        checkout!(stack_id, :snapshot_started?, &Query.snapshot_started?(&1, shape_handle))

      :not_found ->
        checkout!(stack_id, :snapshot_started?, &Query.snapshot_started?(&1, shape_handle))
    end
  end

  def mark_snapshot_complete(stack_id, shape_handle) do
    if shape_exists_in_buffer_or_sqlite?(stack_id, shape_handle) do
      WriteBuffer.queue_snapshot_complete(stack_id, shape_handle)
    else
      :error
    end
  end

  def snapshot_complete?(stack_id, shape_handle) do
    case WriteBuffer.snapshot_complete?(stack_id, shape_handle) do
      {:ok, true} ->
        true

      {:ok, false} ->
        checkout!(stack_id, :snapshot_complete?, &Query.snapshot_complete?(&1, shape_handle))

      :not_found ->
        checkout!(stack_id, :snapshot_complete?, &Query.snapshot_complete?(&1, shape_handle))
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

  def reset(stack_id) when is_stack_id(stack_id) do
    WriteBuffer.clear(stack_id)
    checkout_write!(stack_id, :reset, &Query.reset/1)
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

  defp shape_exists_in_buffer_or_sqlite?(stack_id, shape_handle) do
    # Check buffer first - if shape is there, it exists
    if WriteBuffer.handle_exists?(stack_id, shape_handle) do
      true
    else
      # Shape not in buffer - check if there's a pending remove
      pending_removes = WriteBuffer.pending_removes(stack_id)

      if MapSet.member?(pending_removes, shape_handle) do
        # Shape is being removed, treat as non-existent
        false
      else
        # Check SQLite
        checkout!(stack_id, :handle_exists?, &Query.handle_exists?(&1, shape_handle))
      end
    end
  end
end
