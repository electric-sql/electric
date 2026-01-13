defmodule Electric.ShapeCache.ShapeStatus.ShapeDb do
  @moduledoc false

  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Connection
  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Query

  import Electric, only: [is_stack_id: 1, is_shape_handle: 1]

  import Connection,
    only: [
      checkout!: 2,
      checkout_write!: 2,
      checkout_write!: 3
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

    checkout_write!(stack_id, fn %Connection{} = conn ->
      with :ok <-
             Query.add_shape(
               conn,
               shape_handle,
               shape,
               comparable_shape,
               shape_hash,
               Shape.list_relations(shape)
             ) do
        {:ok, shape_hash}
      end
    end)
  end

  def remove_shape(stack_id, shape_handle) when is_stack_id(stack_id) do
    checkout_write!(stack_id, fn %Connection{} = conn ->
      Query.remove_shape(conn, shape_handle)
    end)
  end

  def handle_for_shape(stack_id, %Shape{} = shape) when is_stack_id(stack_id) do
    {comparable_shape, _shape_hash} = Shape.comparable_hash(shape)

    checkout!(stack_id, fn %Connection{} = conn ->
      Query.handle_for_shape(conn, comparable_shape)
    end)
  end

  def shape_for_handle(stack_id, shape_handle) when is_stack_id(stack_id) do
    checkout!(stack_id, fn %Connection{} = conn ->
      Query.shape_for_handle(conn, shape_handle)
    end)
  end

  def list_shapes(stack_id) when is_stack_id(stack_id) do
    checkout!(stack_id, fn %Connection{} = conn ->
      Query.list_shapes(conn)
    end)
  end

  def list_shapes!(stack_id) when is_stack_id(stack_id) do
    stack_id |> list_shapes() |> raise_on_error!(:list_shapes)
  end

  def shape_handles_for_relations(stack_id, relations) when is_stack_id(stack_id) do
    checkout!(stack_id, fn %Connection{} = conn ->
      Query.shape_handles_for_relations(conn, relations)
    end)
  end

  def shape_handles_for_relations!(stack_id, relations) when is_stack_id(stack_id) do
    stack_id
    |> shape_handles_for_relations(relations)
    |> raise_on_error!(:shape_handles_for_relations)
  end

  def reduce_shapes(stack_id, acc, reducer_fun) when is_function(reducer_fun, 2) do
    checkout!(stack_id, fn %Connection{} = conn ->
      conn
      |> Query.list_shape_stream()
      |> Enum.reduce(acc, reducer_fun)
    end)
  end

  def reduce_shape_handles(stack_id, acc, reducer_fun) when is_function(reducer_fun, 2) do
    checkout!(stack_id, fn %Connection{} = conn ->
      conn
      |> Query.list_handles_stream()
      |> Enum.reduce(acc, reducer_fun)
    end)
  end

  def shape_hash(stack_id, shape_handle) do
    checkout!(stack_id, fn %Connection{} = conn ->
      Query.shape_hash(conn, shape_handle)
    end)
  end

  def handle_exists?(stack_id, shape_handle) do
    checkout!(stack_id, fn %Connection{} = conn ->
      Query.handle_exists?(conn, shape_handle)
    end)
  end

  def count_shapes(stack_id) do
    checkout!(stack_id, fn %Connection{} = conn ->
      Query.count_shapes(conn)
    end)
  end

  def count_shapes!(stack_id) do
    stack_id |> count_shapes() |> raise_on_error!(:count_shapes)
  end

  def mark_snapshot_started(stack_id, shape_handle) do
    checkout_write!(stack_id, fn %Connection{} = conn ->
      Query.mark_snapshot_started(conn, shape_handle)
    end)
  end

  def snapshot_started?(stack_id, shape_handle) do
    checkout!(stack_id, fn %Connection{} = conn ->
      Query.snapshot_started?(conn, shape_handle)
    end)
  end

  def mark_snapshot_complete(stack_id, shape_handle) do
    checkout_write!(stack_id, fn %Connection{} = conn ->
      Query.mark_snapshot_complete(conn, shape_handle)
    end)
  end

  def snapshot_complete?(stack_id, shape_handle) do
    checkout!(stack_id, fn %Connection{} = conn ->
      Query.snapshot_complete?(conn, shape_handle)
    end)
  end

  def validate_existing_shapes(stack_id) do
    with {:ok, removed_handles} <-
           checkout_write!(
             stack_id,
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
    checkout_write!(stack_id, fn %Connection{} = conn ->
      Query.reset(conn)
    end)
  end

  def explain(stack_id) do
    Connection.explain(stack_id)

    :ok
  end

  defp raise_on_error!({:ok, result}, _action), do: result

  defp raise_on_error!({:error, reason}, action) do
    raise Error, error: reason, action: action
  end
end
