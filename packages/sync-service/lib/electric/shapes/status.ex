defmodule Electric.Shapes.Status do
  use GenServer

  require Logger

  # responsibilities:
  # - record active connections to each shape handle
  # - monitor shape supervisor instances
  # - cleanup after a shape terminates and all connections have ended
  # - a process can only register for a single shape handle at a time
  # - consumers that are just shutdown normally (because being moved or instance shutdown) should not be deleted

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            on_remove: [type: {:fun, 2}]
          )

  def name(opts_or_stack_id) do
    Electric.ProcessRegistry.name(opts_or_stack_id, __MODULE__)
  end

  def start_link(opts) do
    with {:ok, config} <- NimbleOptions.validate(Map.new(opts), @schema) do
      GenServer.start_link(__MODULE__, config, name: name(opts))
    end
  end

  def register_subscriber(stack_id, shape_handle, pid \\ self()) do
    GenServer.call(name(stack_id), {:register_subscriber, shape_handle, pid})
  end

  def unregister_subscriber(stack_id, shape_handle, pid \\ self()) do
    GenServer.call(name(stack_id), {:unregister_subscriber, shape_handle, pid})
  end

  def register_consumer(stack_id, shape_handle, pid \\ self()) do
    GenServer.call(name(stack_id), {:register_consumer, shape_handle, pid})
  end

  def consumer_count(stack_id, shape_handle) do
    case :ets.lookup(table(stack_id), shape_handle) do
      [{_, count}] -> {:ok, count}
      [] -> {:ok, 0}
    end
  end

  defp table(stack_id) do
    :"#{__MODULE__}:#{stack_id}"
  end

  @impl GenServer
  def init(%{stack_id: stack_id} = opts) do
    Process.set_label({:shape_status, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    on_remove = Map.get(opts, :on_remove, fn _, _ -> :ok end)

    subscriber_table =
      :ets.new(table(stack_id), [
        :protected,
        :named_table,
        read_concurrency: true
      ])

    monitor_table = :ets.new(:"#{__MODULE__}:#{stack_id}:monitor", [])

    state = %{
      stack_id: stack_id,
      monitor_table: monitor_table,
      subscriber_table: subscriber_table,
      on_remove: on_remove
    }

    {:ok, state}
  end

  @impl GenServer
  def handle_call({:register_subscriber, handle, pid}, _from, state) do
    ref = Process.monitor(pid)

    if :ets.insert_new(state.monitor_table, {pid, handle, ref}) do
      count = update_counter(state.stack_id, handle, 1)

      Logger.debug(fn ->
        "register: #{inspect(pid)}, #{count} registered processes for shape #{inspect(handle)}"
      end)

      {:reply, {:ok, count}, state}
    else
      {:reply, {:error, "pid is already registered"}, state}
    end
  end

  def handle_call({:unregister_subscriber, _handle, pid}, _from, state) do
    response =
      with {:ok, _handle, count} <- delete_pid(pid, true, state) do
        {:ok, count}
      end

    {:reply, response, state}
  end

  def handle_call({:register_consumer, handle, pid}, _from, state) do
    ref = Process.monitor(pid)

    if :ets.insert_new(state.monitor_table, {pid, :consumer, handle, ref}) do
      {:reply, {:ok, count}, state}
    else
      {:reply, {:error, "pid is already registered"}, state}
    end
  end

  @impl GenServer
  def handle_info({:DOWN, _ref, :process, pid, _reason}, state) do
    {:ok, handle, count} = delete_pid(pid, true, state)

    Logger.debug(fn ->
      "deregister: #{inspect(pid)}, #{count} registered processes for shape #{inspect(handle)}"
    end)

    {:noreply, state}
  end

  defp update_counter(stack_id, handle, incr) do
    :ets.update_counter(table(stack_id), handle, incr, {handle, 0})
  end

  defp delete_pid(pid, demonitor, state) do
    %{stack_id: stack_id} = state

    case :ets.lookup(state.monitor_table, pid) do
      [{_, :subscriber, handle, ref}] ->
        if demonitor, do: Process.demonitor(ref, [:flush])
        :ets.delete(state.monitor_table, pid)
        counter = update_counter(stack_id, handle, -1)
        state.on_remove.(handle, pid)

        {:ok, handle, counter}

      [{_, :consumer, handle, ref}] ->
        :ets.delete(state.monitor_table, pid)
        state.on_remove.(handle, pid)

      [] ->
        {:error, "pid not registered"}
    end
  end
end
