defmodule Electric.Shapes.Consumer.Materialzer do
  use GenServer

  alias Electric.Shapes.Consumer
  alias Electric.ShapeCache.Storage
  alias Electric.Replication.LogOffset

  def name(stack_id, shape_handle) when is_binary(shape_handle) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, shape_handle)
  end

  def name(%{
        stack_id: stack_id,
        shape_handle: shape_handle
      }) do
    name(stack_id, shape_handle)
  end

  def get_link_values(columns, opts) do
    GenServer.call(name(opts), {:get_link_values, columns})
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
        ref: nil
      })

    {:ok, state, {:continue, :start_materializer}}
  end

  def handle_continue(:start_materializer, state) do
    ref = make_ref()
    Registry.register(state.registry, state.shape_handle, ref)
    {:ok, _latest_offset} = Consumer.name(opts) |> Consumer.initial_state()

    {:noreply, Map.merge(state, %{ref: ref}), {:continue, :read_stream}}
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
            Map.put(view, key, value)

          "update" ->
            Map.update!(view, key, &Map.merge(&1, value))

          "delete" ->
            Map.delete(view, key)
        end
      end)

    {:noreply, %{state | offset: offset, view: view}, {:continue, :read_stream}}
  end

  def get_stream_up_to_date(min_offset, state) do
    case Storage.get_chunk_end_log_offset(min_offset, state.storage) do
      nil ->
        {:ok, max_offset, _} = Storage.get_current_position(state.storage)
        stream = Storage.get_log_stream(min_offset, max_offset, state.storage)
        {:ok, offset, stream}

      max_offset ->
        stream1 = Storage.get_log_stream(min_offset, max_offset, state.storage)
        {:ok, offset, stream2} = get_stream_up_to_date(max_offset, state)
        {:ok, offset, Stream.concat(stream1, stream2)}
    end
  end

  def handle_info({ref, :new_changes, log_offset}, %{offset: offset, ref: ref} = state)
      when is_log_offset_lte(log_offset, offset) do
    {:noreply, state}
  end

  def handle_info({ref, :new_changes, _}, %{ref: ref} = state) do
    {:noreply, state, {:continue, :read_stream}}
  end

  def handle_call({:get_link_values, [column]}, state) do
    values =
      state.view
      |> MapSet.new(fn {_, value} -> Map.fetch!(value, column) end)

    {:reply, values, state}
  end
end
