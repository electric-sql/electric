defmodule Electric.Shapes.Consumer.Materializer do
  # TODOS:
  # - [x] Keep lockstep with the consumer
  # - [ ] Think about initial materialization needing to finish before we can continue
  # - [ ]
  # - [ ] Use the `get_link_values`

  # NOTES:
  # - Consumer does txn buffering until pg snapshot is known
  use GenServer

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

  def subscribe(stack_id, shape_handle) do
    GenServer.call(name(stack_id, shape_handle), :subscribe)
  end

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: name(opts))
  end

  def init(opts) do
    %{stack_id: stack_id, shape_handle: shape_handle} = opts

    Process.set_label({:materializer, shape_handle})
    metadata = [stack_id: stack_id, shape_handle: shape_handle]
    Logger.metadata(metadata)

    state =
      Map.merge(opts, %{
        view: %{},
        offset: LogOffset.before_all(),
        ref: nil,
        subscribers: MapSet.new()
      })

    {:ok, state |> Map.update!(:storage, &Storage.for_shape(shape_handle, &1)),
     {:continue, :start_materializer}}
  end

  def handle_continue(:start_materializer, state) do
    _ = Consumer.await_snapshot_start(state)
    Consumer.subscribe_materializer(state)

    {:noreply, state, {:continue, :read_stream}}
  end

  def handle_continue(:read_stream, state) do
    {:ok, offset, stream} = get_stream_up_to_date(state.offset, state)

    view =
      stream
      |> Stream.map(&Jason.decode!/1)
      |> Enum.reduce(state.view, fn %{
                                      "key" => key,
                                      "value" => value,
                                      "headers" => %{"operation" => operation}
                                    },
                                    view ->
        case operation do
          "insert" ->
            Map.put(view, key, cast!(value, state))

          "update" ->
            Map.put(view, key, cast!(value, state))

          "delete" ->
            Map.delete(view, key)
        end
      end)

    {:noreply, %{state | offset: offset, view: view}}
  end

  def get_stream_up_to_date(min_offset, state) do
    case Storage.get_chunk_end_log_offset(min_offset, state.storage) do
      nil ->
        {:ok, max_offset, _} = Storage.get_current_position(state.storage)

        if is_log_offset_lte(max_offset, min_offset) do
          {:ok, min_offset, []}
        else
          stream = Storage.get_log_stream(min_offset, max_offset, state.storage)
          {:ok, max_offset, stream}
        end

      max_offset ->
        stream1 = Storage.get_log_stream(min_offset, max_offset, state.storage)
        {:ok, offset, stream2} = get_stream_up_to_date(max_offset, state)
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

  def handle_call(:get_link_values, _from, %{view: view} = state) do
    values = MapSet.new(Map.values(view))

    {:reply, values, state}
  end

  def handle_call(:wait_until_ready, _from, state) do
    {:reply, :ok, state}
  end

  def handle_call({:new_changes, changes}, _from, state) do
    {view, events} =
      Enum.reduce(changes, {state.view, []}, fn
        %Changes.NewRecord{key: key, record: record}, {view, events} ->
          value = cast!(record, state)
          {Map.put(view, key, value), [{:move_in, value} | events]}

        %Changes.UpdatedRecord{key: key, record: record}, {view, events} ->
          # For now materializer for inner shape expects only PKs, so updates are not expected
          # We might need to figure out move in/out for updates if something other than PK is selected
          {Map.put(view, key, cast!(record, state)), events}

        %Changes.DeletedRecord{key: key, old_record: old_record}, {view, events} ->
          value = cast!(old_record, state)
          {Map.delete(view, key), [{:move_out, value} | events]}
      end)

    for pid <- state.subscribers do
      send(pid, {:materializer_changes, state.shape_handle, events})
    end

    {:reply, :ok, %{state | view: view}}
  end

  def handle_call(:subscribe, {pid, _ref} = _from, state) do
    Process.monitor(pid)

    {:reply, :ok, %{state | subscribers: MapSet.put(state.subscribers, pid)}}
  end

  def handle_info({:DOWN, _ref, :process, pid, _reason}, state) do
    {:noreply, %{state | subscribers: MapSet.delete(state.subscribers, pid)}}
  end

  defp cast!(record, %{columns: [column], materialized_type: {:array, type}}) do
    {:ok, value} = Eval.Env.parse_const(Eval.Env.new(), Map.fetch!(record, column), type)
    value
  end
end
