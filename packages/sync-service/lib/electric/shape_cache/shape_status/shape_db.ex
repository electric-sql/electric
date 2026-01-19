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
    seq = WriteBuffer.timestamp()

    true =
      :ets.insert(
        WriteBuffer.pending_table_name(stack_id),
        {{:add, shape_handle}, {seq, shape_binary, comparable_binary, shape_hash, relations}, false}
      )

    {:ok, shape_hash}
  end

  def remove_shape(stack_id, shape_handle) when is_stack_id(stack_id) do
    table = WriteBuffer.pending_table_name(stack_id)

    case :ets.lookup(table, {:add, shape_handle}) do
      [{_key, _data, false = _flushing}] ->
        :ets.delete(table, {:add, shape_handle})
        :ets.delete(table, {:snapshot_started, shape_handle})
        :ets.delete(table, {:snapshot_complete, shape_handle})
        :ok

      [{_key, _data, true = _flushing}] ->
        # Being flushed to SQLite - must queue remove since shape will exist after flush
        seq = WriteBuffer.timestamp()
        true = :ets.insert(table, {{:remove, shape_handle}, {seq}, false})
        :ok

      [] ->
        case checkout!(stack_id, :handle_exists?, fn %Connection{} = conn ->
               Query.handle_exists?(conn, shape_handle)
             end) do
          true ->
            seq = WriteBuffer.timestamp()
            true = :ets.insert(table, {{:remove, shape_handle}, {seq}, false})
            :ok

          false ->
            {:error, "No shape matching #{inspect(shape_handle)}"}
        end
    end
  end

  def handle_for_shape(stack_id, %Shape{} = shape) when is_stack_id(stack_id) do
    {comparable_shape, _shape_hash} = Shape.comparable_hash(shape)
    comparable_binary = :erlang.term_to_binary(comparable_shape)
    table = WriteBuffer.pending_table_name(stack_id)

    case lookup_buffered_by_comparable(stack_id, comparable_binary) do
      {:ok, handle} ->
        {:ok, handle}

      :not_found ->
        case checkout!(stack_id, :handle_for_shape, &Query.handle_for_shape(&1, comparable_shape)) do
          {:ok, handle} ->
            if :ets.member(table, {:remove, handle}), do: :error, else: {:ok, handle}

          :error ->
            :error
        end
    end
  end

  def shape_for_handle(stack_id, shape_handle) when is_stack_id(stack_id) do
    case lookup_buffered_shape(stack_id, shape_handle) do
      {:ok, shape} -> {:ok, shape}
      :not_found -> checkout!(stack_id, :shape_for_handle, &Query.shape_for_handle(&1, shape_handle))
    end
  end

  def list_shapes(stack_id) when is_stack_id(stack_id) do
    with {:ok, sqlite_shapes} <- checkout!(stack_id, :list_shapes, &Query.list_shapes/1) do
      {buffered_shapes, pending_removes} = get_buffered_shapes_and_removes(stack_id)

      filtered_sqlite =
        Enum.reject(sqlite_shapes, fn {handle, _} -> MapSet.member?(pending_removes, handle) end)

      {:ok, Enum.sort_by(buffered_shapes ++ filtered_sqlite, &elem(&1, 0))}
    end
  end

  def list_shapes!(stack_id) when is_stack_id(stack_id) do
    stack_id |> list_shapes() |> raise_on_error!(:list_shapes)
  end

  def shape_handles_for_relations(stack_id, relations) when is_stack_id(stack_id) do
    with {:ok, sqlite_handles} <-
           checkout!(stack_id, :shape_handles_for_relations, &Query.shape_handles_for_relations(&1, relations)) do
      {buffered_handles, pending_removes} = get_buffered_handles_for_relations(stack_id, relations)
      filtered_sqlite = Enum.reject(sqlite_handles, &MapSet.member?(pending_removes, &1))
      {:ok, (buffered_handles ++ filtered_sqlite) |> Enum.uniq() |> Enum.sort()}
    end
  end

  def shape_handles_for_relations!(stack_id, relations) when is_stack_id(stack_id) do
    stack_id
    |> shape_handles_for_relations(relations)
    |> raise_on_error!(:shape_handles_for_relations)
  end

  def reduce_shapes(stack_id, acc, reducer_fun) when is_function(reducer_fun, 2) do
    {buffered_shapes, pending_removes} = get_buffered_shapes_and_removes(stack_id)
    acc = Enum.reduce(buffered_shapes, acc, reducer_fun)

    checkout!(stack_id, :reduce_shapes, fn %Connection{} = conn ->
      conn
      |> Query.list_shape_stream()
      |> Stream.reject(fn {handle, _} -> MapSet.member?(pending_removes, handle) end)
      |> Enum.reduce(acc, reducer_fun)
    end)
  end

  def reduce_shape_meta(stack_id, acc, reducer_fun) when is_function(reducer_fun, 2) do
    {buffered_meta, pending_removes} = get_buffered_shape_meta(stack_id)
    acc = Enum.reduce(buffered_meta, acc, reducer_fun)

    checkout!(stack_id, :reduce_shape_meta, fn %Connection{} = conn ->
      conn
      |> Query.list_shape_meta_stream()
      |> Stream.reject(fn {handle, _, _} -> MapSet.member?(pending_removes, handle) end)
      |> Enum.reduce(acc, reducer_fun)
    end)
  end

  def shape_hash(stack_id, shape_handle) do
    case lookup_buffered_hash(stack_id, shape_handle) do
      {:ok, hash} -> {:ok, hash}
      :not_found -> checkout!(stack_id, :shape_hash, &Query.shape_hash(&1, shape_handle))
    end
  end

  def handle_exists?(stack_id, shape_handle) do
    table = WriteBuffer.pending_table_name(stack_id)

    cond do
      :ets.member(table, {:remove, shape_handle}) -> false
      :ets.member(table, {:add, shape_handle}) -> true
      true -> checkout!(stack_id, :handle_exists?, &Query.handle_exists?(&1, shape_handle))
    end
  end

  def count_shapes(stack_id) do
    with {:ok, sqlite_count} <- checkout!(stack_id, :count_shapes, &Query.count_shapes/1) do
      {buffered_adds, pending_removes} = count_buffered_changes(stack_id)
      {:ok, sqlite_count + buffered_adds - MapSet.size(pending_removes)}
    end
  end

  def count_shapes!(stack_id) do
    stack_id |> count_shapes() |> raise_on_error!(:count_shapes)
  end

  def mark_snapshot_started(stack_id, shape_handle) do
    table = WriteBuffer.pending_table_name(stack_id)

    if shape_exists_in_buffer_or_sqlite?(stack_id, shape_handle) do
      seq = WriteBuffer.timestamp()
      true = :ets.insert(table, {{:snapshot_started, shape_handle}, {seq}, false})
      :ok
    else
      :error
    end
  end

  def snapshot_started?(stack_id, shape_handle) do
    table = WriteBuffer.pending_table_name(stack_id)

    # snapshot_complete implies started
    case :ets.lookup(table, {:snapshot_started, shape_handle}) do
      [_] ->
        {:ok, true}

      [] ->
        case :ets.lookup(table, {:snapshot_complete, shape_handle}) do
          [_] -> {:ok, true}
          [] -> checkout!(stack_id, :snapshot_started?, &Query.snapshot_started?(&1, shape_handle))
        end
    end
  end

  def mark_snapshot_complete(stack_id, shape_handle) do
    table = WriteBuffer.pending_table_name(stack_id)

    if shape_exists_in_buffer_or_sqlite?(stack_id, shape_handle) do
      seq = WriteBuffer.timestamp()
      true = :ets.insert(table, {{:snapshot_complete, shape_handle}, {seq}, false})
      :ok
    else
      :error
    end
  end

  def snapshot_complete?(stack_id, shape_handle) do
    table = WriteBuffer.pending_table_name(stack_id)

    case :ets.lookup(table, {:snapshot_complete, shape_handle}) do
      [_] -> {:ok, true}
      [] -> checkout!(stack_id, :snapshot_complete?, &Query.snapshot_complete?(&1, shape_handle))
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
    table = WriteBuffer.pending_table_name(stack_id)
    :ets.delete_all_objects(table)
    checkout_write!(stack_id, :reset, &Query.reset/1)
  end

  def explain(stack_id) do
    Connection.explain(stack_id)

    :ok
  end

  @doc "Returns the number of pending writes in the buffer"
  @spec pending_buffer_size(stack_id()) :: non_neg_integer()
  def pending_buffer_size(stack_id) when is_stack_id(stack_id) do
    table = WriteBuffer.pending_table_name(stack_id)
    :ets.info(table, :size)
  end

  defp raise_on_error!({:ok, result}, _action), do: result

  defp raise_on_error!({:error, reason}, action) do
    raise Error, error: reason, action: action
  end

  defp lookup_buffered_shape(stack_id, handle) do
    table = WriteBuffer.pending_table_name(stack_id)

    case :ets.lookup(table, {:add, handle}) do
      [{{:add, ^handle}, {_seq, shape_binary, _, _, _}, _flushing}] ->
        {:ok, :erlang.binary_to_term(shape_binary)}

      [] ->
        :not_found
    end
  end

  defp lookup_buffered_by_comparable(stack_id, comparable_binary) do
    table = WriteBuffer.pending_table_name(stack_id)
    pattern = {{:add, :"$1"}, {:_, :_, comparable_binary, :_, :_}, :_}

    case :ets.match(table, pattern) do
      [[handle]] ->
        if :ets.member(table, {:remove, handle}), do: :not_found, else: {:ok, handle}

      [] ->
        :not_found
    end
  end

  defp lookup_buffered_hash(stack_id, handle) do
    table = WriteBuffer.pending_table_name(stack_id)

    case :ets.lookup_element(table, {:add, handle}, 2, :not_found) do
      :not_found -> :not_found
      {_, _, _, hash, _} -> {:ok, hash}
    end
  end

  defp get_buffered_shapes_and_removes(stack_id) do
    table = WriteBuffer.pending_table_name(stack_id)

    add_pattern = [{{{:add, :"$1"}, {:_, :"$2", :_, :_, :_}, :_}, [], [{{:"$1", :"$2"}}]}]
    adds = :ets.select(table, add_pattern)

    buffered_shapes =
      Enum.map(adds, fn {handle, shape_binary} ->
        {handle, :erlang.binary_to_term(shape_binary)}
      end)

    remove_pattern = [{{{:remove, :"$1"}, :_, :_}, [], [:"$1"]}]
    pending_removes = MapSet.new(:ets.select(table, remove_pattern))

    {buffered_shapes, pending_removes}
  end

  defp count_buffered_changes(stack_id) do
    table = WriteBuffer.pending_table_name(stack_id)

    add_count_pattern = [{{{:add, :_}, :_, :_}, [], [true]}]
    buffered_adds = :ets.select_count(table, add_count_pattern)

    remove_pattern = [{{{:remove, :"$1"}, :_, :_}, [], [:"$1"]}]
    pending_removes = MapSet.new(:ets.select(table, remove_pattern))

    {buffered_adds, pending_removes}
  end

  defp get_buffered_handles_for_relations(stack_id, relations) do
    table = WriteBuffer.pending_table_name(stack_id)

    # Compare by OID only since relation names may differ
    relation_oids = MapSet.new(relations, fn {oid, _relation} -> oid end)

    add_pattern = [{{{:add, :"$1"}, {:_, :_, :_, :_, :"$2"}, :_}, [], [{{:"$1", :"$2"}}]}]
    adds = :ets.select(table, add_pattern)

    buffered_handles =
      adds
      |> Enum.filter(fn {_handle, entry_relations} ->
        Enum.any?(entry_relations, fn {oid, _} -> MapSet.member?(relation_oids, oid) end)
      end)
      |> Enum.map(fn {handle, _} -> handle end)

    remove_pattern = [{{{:remove, :"$1"}, :_, :_}, [], [:"$1"]}]
    pending_removes = MapSet.new(:ets.select(table, remove_pattern))

    {buffered_handles, pending_removes}
  end

  defp get_buffered_shape_meta(stack_id) do
    table = WriteBuffer.pending_table_name(stack_id)

    add_pattern = [{{{:add, :"$1"}, {:_, :_, :_, :"$2", :_}, :_}, [], [{{:"$1", :"$2"}}]}]
    adds = :ets.select(table, add_pattern)

    started_pattern = [{{{:snapshot_started, :"$1"}, :_, :_}, [], [:"$1"]}]
    started_handles = MapSet.new(:ets.select(table, started_pattern))

    # snapshot_complete implies started
    complete_pattern = [{{{:snapshot_complete, :"$1"}, :_, :_}, [], [:"$1"]}]
    complete_handles = MapSet.new(:ets.select(table, complete_pattern))

    buffered_meta =
      Enum.map(adds, fn {handle, hash} ->
        snapshot_started =
          MapSet.member?(started_handles, handle) or MapSet.member?(complete_handles, handle)

        {handle, hash, snapshot_started}
      end)

    remove_pattern = [{{{:remove, :"$1"}, :_, :_}, [], [:"$1"]}]
    pending_removes = MapSet.new(:ets.select(table, remove_pattern))

    {buffered_meta, pending_removes}
  end

  defp shape_exists_in_buffer_or_sqlite?(stack_id, shape_handle) do
    table = WriteBuffer.pending_table_name(stack_id)

    cond do
      :ets.member(table, {:remove, shape_handle}) -> false
      :ets.member(table, {:add, shape_handle}) -> true
      true -> checkout!(stack_id, :handle_exists?, &Query.handle_exists?(&1, shape_handle))
    end
  end
end
