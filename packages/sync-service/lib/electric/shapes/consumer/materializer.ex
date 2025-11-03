defmodule Electric.Shapes.Consumer.Materializer do
  # TODOS:
  # - [x] Keep lockstep with the consumer
  # - [ ] Think about initial materialization needing to finish before we can continue
  # - [ ]
  # - [ ] Use the `get_link_values`

  # NOTES:
  # - Consumer does txn buffering until pg snapshot is known
  use GenServer, restart: :transient

  alias Electric.Utils
  alias Electric.Replication.Changes
  alias Electric.Shapes.Consumer
  alias Electric.ShapeCache.Storage
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Eval
  import Electric.Replication.LogOffset

  def name(stack_id, shape_handle) when is_binary(shape_handle) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, shape_handle)
  end

  def name(%{
        stack_id: stack_id,
        shape_handle: shape_handle
      }) do
    name(stack_id, shape_handle)
  end

  def whereis(%{stack_id: stack_id, shape_handle: shape_handle}),
    do: whereis(stack_id, shape_handle)

  def whereis(stack_id, shape_handle), do: GenServer.whereis(name(stack_id, shape_handle))

  def new_changes(state, changes) do
    GenServer.call(name(state), {:new_changes, changes}, :infinity)
  end

  def wait_until_ready(state) do
    GenServer.call(name(state), :wait_until_ready, :infinity)
  end

  def get_link_values(opts) do
    GenServer.call(name(opts), :get_link_values)
  end

  def get_all_as_refs(shape, stack_id) do
    shape.shape_dependencies_handles
    |> Enum.with_index()
    |> Map.new(fn {shape_handle, index} ->
      {["$sublink", Integer.to_string(index)],
       get_link_values(%{
         shape_handle: shape_handle,
         stack_id: stack_id
       })}
    end)
  end

  def subscribe(opts), do: GenServer.call(name(opts), :subscribe)

  def subscribe(stack_id, shape_handle),
    do: subscribe(%{stack_id: stack_id, shape_handle: shape_handle})

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: name(opts))
  end

  def init(opts) do
    %{stack_id: stack_id, shape_handle: shape_handle} = opts

    Process.set_label({:materializer, shape_handle})
    Process.flag(:trap_exit, true)
    metadata = [stack_id: stack_id, shape_handle: shape_handle]
    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

    {storage, opts} = Map.pop(opts, :storage)
    shape_storage = Storage.for_shape(shape_handle, storage)

    state =
      Map.merge(opts, %{
        index: %{},
        value_counts: %{},
        offset: LogOffset.before_all(),
        ref: nil,
        subscribers: MapSet.new()
      })

    {:ok, state, {:continue, {:start_materializer, shape_storage}}}
  end

  def handle_continue({:start_materializer, storage}, state) do
    %{stack_id: stack_id, shape_handle: shape_handle} = state

    :started = Consumer.await_snapshot_start(stack_id, shape_handle)

    Consumer.subscribe_materializer(stack_id, shape_handle)

    Process.monitor(Consumer.whereis(stack_id, shape_handle),
      tag: {:consumer_down, state.shape_handle}
    )

    {:noreply, state, {:continue, {:read_stream, storage}}}
  end

  def handle_continue({:read_stream, storage}, state) do
    {:ok, offset, stream} = get_stream_up_to_date(state.offset, storage)

    {state, _} =
      stream
      |> Stream.map(&Jason.decode!/1)
      |> Enum.filter(fn decoded -> Map.has_key?(decoded, "key") end)
      |> Enum.map(fn %{"key" => key, "value" => value, "headers" => %{"operation" => operation}} ->
        case operation do
          "insert" -> %Changes.NewRecord{key: key, record: value}
          "update" -> %Changes.UpdatedRecord{key: key, record: value}
          "delete" -> %Changes.DeletedRecord{key: key, old_record: value}
        end
      end)
      |> apply_changes(state)

    {:noreply, %{state | offset: offset}}
  end

  def get_stream_up_to_date(min_offset, storage) do
    case Storage.get_chunk_end_log_offset(min_offset, storage) do
      nil ->
        {:ok, max_offset, _} = Storage.get_current_position(storage)

        if is_log_offset_lte(max_offset, min_offset) do
          {:ok, min_offset, []}
        else
          stream = Storage.get_log_stream(min_offset, max_offset, storage)
          {:ok, max_offset, stream}
        end

      max_offset ->
        stream1 = Storage.get_log_stream(min_offset, max_offset, storage)
        {:ok, offset, stream2} = get_stream_up_to_date(max_offset, storage)
        {:ok, offset, Stream.concat(stream1, stream2)}
    end
  end

  # def handle_info({ref, :new_changes, log_offset}, %{offset: offset, ref: ref} = state)
  #     when is_log_offset_lte(log_offset, offset) do
  #   {:noreply, state}
  # end

  # def handle_info({ref, :new_changes, _}, %{ref: ref} = state) do
  #   {:noreply, state, {:continue, :read_stream}}
  # end

  def handle_call(:get_link_values, _from, %{value_counts: value_counts} = state) do
    values = MapSet.new(Map.keys(value_counts))

    {:reply, values, state}
  end

  def handle_call(:wait_until_ready, _from, state) do
    {:reply, :ok, state}
  end

  def handle_call({:new_changes, changes}, _from, state) do
    {state, events} = apply_changes(changes, state)

    if events != [] do
      for pid <- state.subscribers do
        send(pid, {:materializer_changes, state.shape_handle, events})
      end
    end

    {:reply, :ok, state}
  end

  def handle_call(:subscribe, {pid, _ref} = _from, state) do
    Process.monitor(pid)

    {:reply, :ok, %{state | subscribers: MapSet.put(state.subscribers, pid)}}
  end

  def handle_info({:EXIT, _, reason}, state) do
    {:stop, reason, state}
  end

  # notify subscribers of the shape removal if the consumer exit reason is
  # anything other than a clean supervisor shutdown.
  def handle_info({{:consumer_down, _}, _ref, :process, _pid, :shutdown}, state) do
    {:noreply, state}
  end

  def handle_info({{:consumer_down, _}, _ref, :process, _pid, {:shutdown, reason}}, state)
      when reason != :cleanup do
    {:noreply, state}
  end

  def handle_info({{:consumer_down, _}, _ref, :process, _pid, _reason}, state) do
    for pid <- state.subscribers do
      send(pid, {:materializer_shape_invalidated, state.shape_handle})
    end

    {:stop, :shutdown, state}
  end

  def handle_info({:DOWN, _ref, :process, pid, _reason}, state) do
    {:noreply, %{state | subscribers: MapSet.delete(state.subscribers, pid)}}
  end

  defp cast!(record, %{columns: [column], materialized_type: {:array, type}}) do
    {:ok, value} = Eval.Env.parse_const(Eval.Env.new(), Map.fetch!(record, column), type)
    value
  end

  defp cast!(record, %{columns: columns, materialized_type: {:array, {:row, types}}}) do
    {:ok, values} =
      Enum.zip(columns, types)
      |> Utils.map_while_ok(fn {column, type} ->
        Eval.Env.parse_const(Eval.Env.new(), Map.fetch!(record, column), type)
      end)

    List.to_tuple(values)
  end

  defp apply_changes(changes, state) when is_list(changes) do
    {index, {value_counts, events}} =
      Enum.reduce(changes, {state.index, {state.value_counts, []}}, fn
        %Changes.NewRecord{key: key, record: record}, {index, counts_and_events} ->
          value = cast!(record, state)
          if is_map_key(index, key), do: raise("Key #{key} already exists")
          index = Map.put(index, key, value)

          {index, increment_value(counts_and_events, value)}

        %Changes.UpdatedRecord{key: key, record: record}, {index, counts_and_events} ->
          # TODO: this is written as if it supports multiple selected columns, but it doesn't for now
          if Enum.any?(state.columns, &is_map_key(record, &1)) do
            value = cast!(record, state)
            old_value = Map.fetch!(index, key)
            index = Map.put(index, key, value)

            {index, counts_and_events |> decrement_value(old_value) |> increment_value(value)}
          else
            # Nothing relevant to this materializer has been updated
            {index, counts_and_events}
          end

        %Changes.DeletedRecord{key: key}, {index, counts_and_events} ->
          {value, index} = Map.pop!(index, key)

          {index, decrement_value(counts_and_events, value)}
      end)

    {%{state | index: index, value_counts: value_counts}, Enum.reverse(events)}
  end

  defp increment_value({value_counts, events}, value) do
    case Map.fetch(value_counts, value) do
      {:ok, count} ->
        {Map.put(value_counts, value, count + 1), events}

      :error ->
        {Map.put(value_counts, value, 1), [{:move_in, value} | events]}
    end
  end

  defp decrement_value({value_counts, events}, value) do
    # If we're decrementing, it must have been added before
    case Map.fetch!(value_counts, value) do
      1 ->
        {Map.delete(value_counts, value), [{:move_out, value} | events]}

      count ->
        {Map.put(value_counts, value, count - 1), events}
    end
  end
end
