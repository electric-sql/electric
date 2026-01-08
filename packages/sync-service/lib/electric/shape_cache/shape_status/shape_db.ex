defmodule Electric.ShapeCache.ShapeStatus.ShapeDb do
  @moduledoc false

  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Connection

  import Electric, only: [is_stack_id: 1, is_shape_handle: 1]

  import Connection,
    only: [
      checkout!: 2,
      checkout_write!: 2,
      execute_all: 2,
      fetch_all: 4,
      fetch_one: 3,
      modify: 3,
      stream_query: 3,
      transaction: 2
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
      %{
        insert_shape: insert_shape,
        insert_relation: insert_relation,
        increment_counter: increment_counter
      } = conn

      with :ok <-
             transaction(conn, fn ->
               with {:ok, 1} <-
                      modify(conn, insert_shape, [
                        {:blob, shape_handle},
                        {:blob, term_to_binary(shape)},
                        {:blob, term_to_binary(comparable_shape)},
                        shape_hash
                      ]),
                    {:ok, 1} <- modify(conn, increment_counter, [1]),
                    :ok <-
                      Enum.reduce_while(Shape.list_relations(shape), :ok, fn {oid, _name}, :ok ->
                        case modify(conn, insert_relation, [{:blob, shape_handle}, oid]) do
                          {:ok, 1} -> {:cont, :ok}
                          error -> {:halt, error}
                        end
                      end) do
                 :ok
               end
             end) do
        {:ok, shape_hash}
      end
    end)
  end

  def remove_shape(stack_id, shape_handle) when is_stack_id(stack_id) do
    checkout_write!(stack_id, fn %Connection{} = conn ->
      transaction(conn, fn ->
        remove_shape_in_transaction(conn, shape_handle)
      end)
    end)
  end

  defp remove_shape_in_transaction(conn, shape_handle) do
    %{
      delete_shape: delete_shape,
      delete_relation: delete_relation,
      increment_counter: increment_counter
    } = conn

    case modify(conn, delete_shape, [{:blob, shape_handle}]) do
      {:ok, 0} ->
        {:error, "No shape matching #{inspect(shape_handle)}"}

      {:ok, 1} ->
        with {:ok, 1} <- modify(conn, increment_counter, [-1]),
             {:ok, n} when n > 0 <- modify(conn, delete_relation, [{:blob, shape_handle}]) do
          :ok
        end
    end
  end

  def handle_for_shape(stack_id, %Shape{} = shape) when is_stack_id(stack_id) do
    {comparable_shape, _shape_hash} = Shape.comparable_hash(shape)

    checkout!(stack_id, fn %Connection{handle_lookup: stmt} = conn ->
      with {:ok, [handle]} <- fetch_one(conn, stmt, [{:blob, term_to_binary(comparable_shape)}]) do
        {:ok, handle}
      end
    end)
  end

  def shape_for_handle(stack_id, shape_handle) when is_stack_id(stack_id) do
    checkout!(stack_id, fn %Connection{shape_lookup: stmt} = conn ->
      with {:ok, [serialized_shape]} <- fetch_one(conn, stmt, [{:blob, shape_handle}]) do
        {:ok, :erlang.binary_to_term(serialized_shape)}
      end
    end)
  end

  def list_shapes(stack_id) when is_stack_id(stack_id) do
    checkout!(stack_id, fn %Connection{list_shapes: stmt} = conn ->
      fetch_all(conn, stmt, [], fn [handle, serialized_shape] ->
        {handle, :erlang.binary_to_term(serialized_shape)}
      end)
    end)
  end

  def list_shapes!(stack_id) when is_stack_id(stack_id) do
    stack_id |> list_shapes() |> raise_on_error!(:list_shapes)
  end

  def shape_handles_for_relations(stack_id, relations) when is_stack_id(stack_id) do
    {placeholders, binds} =
      Enum.map_reduce(Enum.with_index(relations, 1), %{}, fn {{oid, _relation}, idx}, binds ->
        {"@oid#{idx}", Map.put(binds, "@oid#{idx}", oid)}
      end)

    sql =
      "SELECT handle FROM relations WHERE oid IN (#{Enum.join(placeholders, ", ")}) ORDER BY handle"

    checkout!(stack_id, fn %Connection{} = conn ->
      fetch_all(conn, sql, binds, fn [handle] -> handle end)
    end)
  end

  def shape_handles_for_relations!(stack_id, relations) when is_stack_id(stack_id) do
    stack_id
    |> shape_handles_for_relations(relations)
    |> raise_on_error!(:shape_handles_for_relations)
  end

  def reduce_shapes(stack_id, acc, reducer_fun) when is_function(reducer_fun, 2) do
    checkout!(stack_id, fn %Connection{list_shapes: stmt} = conn ->
      conn
      |> list_shape_stream(stmt, fn [handle, shape] -> {handle, :erlang.binary_to_term(shape)} end)
      |> Enum.reduce(acc, reducer_fun)
    end)
  end

  def reduce_shape_handles(stack_id, acc, reducer_fun) when is_function(reducer_fun, 2) do
    checkout!(stack_id, fn %Connection{list_handles: stmt} = conn ->
      conn
      |> list_shape_stream(stmt, fn [handle] -> handle end)
      |> Enum.reduce(acc, reducer_fun)
    end)
  end

  def shape_hash(stack_id, shape_handle) do
    checkout!(stack_id, fn %Connection{hash_lookup: stmt} = conn ->
      with {:ok, [hash]} <- fetch_one(conn, stmt, [{:blob, shape_handle}]) do
        {:ok, hash}
      end
    end)
  end

  def handle_exists?(stack_id, shape_handle) do
    checkout!(stack_id, fn %Connection{handle_exists: stmt} = conn ->
      case fetch_one(conn, stmt, [{:blob, shape_handle}]) do
        {:ok, [1]} -> true
        :error -> false
      end
    end)
  end

  def count_shapes(stack_id) do
    checkout!(stack_id, fn %Connection{shape_count: stmt} = conn ->
      with {:ok, [count]} <- fetch_one(conn, stmt, []) do
        {:ok, count}
      end
    end)
  end

  def count_shapes!(stack_id) do
    stack_id |> count_shapes() |> raise_on_error!(:count_shapes)
  end

  def mark_snapshot_started(stack_id, shape_handle) do
    checkout_write!(stack_id, fn %Connection{} = conn ->
      %{mark_snapshot_started: mark_snapshot_started} = conn

      transaction(conn, fn ->
        with {:ok, n} <- modify(conn, mark_snapshot_started, [{:blob, shape_handle}]) do
          if n == 1, do: :ok, else: :error
        end
      end)
    end)
  end

  def snapshot_started?(stack_id, shape_handle) do
    checkout!(stack_id, fn %Connection{conn: conn, snapshot_state: stmt} ->
      case fetch_one(conn, stmt, [{:blob, shape_handle}]) do
        {:ok, [s]} -> s in [1, 2]
        :error -> false
      end
    end)
  end

  def mark_snapshot_complete(stack_id, shape_handle) do
    checkout_write!(stack_id, fn %Connection{} = conn ->
      %{mark_snapshot_complete: mark_snapshot_complete} = conn

      transaction(conn, fn ->
        with {:ok, n} <- modify(conn, mark_snapshot_complete, [{:blob, shape_handle}]) do
          if n == 1, do: :ok, else: :error
        end
      end)
    end)
  end

  def snapshot_complete?(stack_id, shape_handle) do
    checkout!(stack_id, fn %Connection{conn: conn, snapshot_state: stmt} ->
      case fetch_one(conn, stmt, [{:blob, shape_handle}]) do
        {:ok, [s]} -> s == 2
        :error -> false
      end
    end)
  end

  def validate_existing_shapes(stack_id) do
    with {:ok, removed_handles} <-
           checkout_write!(stack_id, fn %Connection{} = conn ->
             %{select_invalid: select_invalid} = conn

             transaction(conn, fn ->
               with {:ok, handles} <-
                      fetch_all(conn, select_invalid, [], fn [handle] ->
                        handle
                      end) do
                 Enum.each(handles, fn handle ->
                   :ok = remove_shape_in_transaction(conn, handle)
                 end)

                 {:ok, handles}
               end
             end)
           end),
         {:ok, count} <- count_shapes(stack_id) do
      {:ok, removed_handles, count}
    end
  end

  def reset(stack_id) when is_stack_id(stack_id) do
    checkout_write!(stack_id, fn %Connection{} = conn ->
      transaction(conn, fn ->
        execute_all(conn, [
          "DELETE FROM shapes",
          "DELETE FROM relations",
          "UPDATE shape_count SET count = 0"
        ])
      end)
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

  defp term_to_binary(term), do: :erlang.term_to_binary(term, [:deterministic])

  defp list_shape_stream(conn, stmt, row_mapper_fun) do
    stream_query(conn, stmt, row_mapper_fun)
  end
end
