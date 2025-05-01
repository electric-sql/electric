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
            storage: [type: :mod_arg, required: true],
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

  def subscriber_count(stack_id, shape_handle) do
    case :ets.lookup(table(stack_id), shape_handle) do
      [{_, count}] -> {:ok, count}
      [] -> {:ok, 0}
    end
  end

  def wait_subscriber_termination(stack_id, shape_handle, pid \\ self()) do
    case subscriber_count(stack_id, shape_handle) do
      {:ok, 0} ->
        notify_subscriber_termination(pid)
        :ok

      {:ok, _} ->
        GenServer.call(name(stack_id), {:wait_subscriber_termination, shape_handle, pid})
    end
  end

  defp notify_subscriber_termination(pids) when is_list(pids) do
    Enum.each(pids, &notify_subscriber_termination/1)
  end

  defp notify_subscriber_termination(pid) when is_pid(pid) do
    send(pid, {__MODULE__, :subscriber_termination})
  end

  defp table(stack_id) do
    :"#{__MODULE__}:#{stack_id}"
  end

  @impl GenServer
  def init(%{stack_id: stack_id} = opts) do
    Process.set_label({:shape_status, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    storage = Map.fetch!(opts, :storage)
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
      storage: storage,
      monitor_table: monitor_table,
      subscriber_table: subscriber_table,
      on_remove: on_remove,
      termination_watchers: %{}
    }

    {:ok, state}
  end

  @impl GenServer
  def handle_call({:register_subscriber, handle, pid}, _from, state) do
    ref = Process.monitor(pid)

    if :ets.insert_new(state.monitor_table, {pid, :subscriber, handle, ref}) do
      count = update_counter(state.stack_id, handle, 1)

      Logger.info(fn ->
        "register: #{inspect(pid)}, #{count} registered processes for shape #{inspect(handle)}"
      end)

      {:reply, {:ok, count}, state}
    else
      # {:reply, {:error, "pid is already registered"}, state}
      {:reply, {:ok, count(state.stack_id, handle)}, state}
    end
  end

  def handle_call({:unregister_subscriber, _handle, pid}, _from, state) do
    {state, count} = delete_subscriber(pid, true, state)

    {:reply, {:ok, count}, state}
  end

  def handle_call({:register_consumer, handle, pid}, _from, state) do
    ref = Process.monitor(pid)

    if :ets.insert_new(state.monitor_table, {pid, :consumer, handle, ref}) do
      {:reply, :ok, state}
    else
      {:reply, {:error, "pid is already registered"}, state}
    end
  end

  def handle_call({:wait_subscriber_termination, shape_handle, pid}, _from, state) do
    %{stack_id: stack_id} = state

    state =
      case subscriber_count(stack_id, shape_handle) do
        {:ok, 0} ->
          notify_subscriber_termination(pid)
          state

        {:ok, _} ->
          add_subscriber_termination_watcher(shape_handle, pid, state)
      end

    {:reply, :ok, state}
  end

  @impl GenServer
  def handle_info({:DOWN, _ref, :process, pid, _reason}, state) do
    {state, _count} = delete_subscriber(pid, false, state)

    {:noreply, state}
  end

  defp add_subscriber_termination_watcher(shape_handle, pid, state) do
    Map.update!(state, :termination_watchers, fn watchers ->
      Map.update(watchers, shape_handle, [pid], &[pid | &1])
    end)
  end

  defp count(stack_id, handle) do
    case :ets.lookup(table(stack_id), handle) do
      [{^handle, count}] -> count
      [] -> 0
    end
  end

  defp update_counter(stack_id, handle, incr) do
    :ets.update_counter(table(stack_id), :all, incr, {:all, 0})
    # IO.inspect(total_subscribers(stack_id))
    :ets.update_counter(table(stack_id), handle, incr, {handle, 0})
  end

  defp total_subscribers(stack_id) do
    case :ets.lookup(table(stack_id), :all) do
      [{:all, count}] -> count
      [] -> 0
    end
  end

  defp delete_subscriber(pid, demonitor?, state) do
    %{stack_id: stack_id} = state

    case :ets.lookup(state.monitor_table, pid) do
      [{_, :subscriber, handle, ref}] ->
        if demonitor?, do: Process.demonitor(ref, [:flush])
        :ets.delete(state.monitor_table, pid)
        count = update_counter(stack_id, handle, -1)
        state.on_remove.(handle, pid)

        Logger.debug(fn ->
          "deregister: #{inspect(pid)}, #{count} registered processes for shape #{inspect(handle)}"
        end)

        state =
          if count == 0 do
            {pids, termination_watchers} = Map.pop(state.termination_watchers, handle, [])
            notify_subscriber_termination(pids)
            %{state | termination_watchers: termination_watchers}
          else
            state
          end

        {state, count}

      [{_, :consumer, handle, _ref}] ->
        try do
          Logger.debug("Consumer #{inspect(handle)} terminated")
          :ets.delete(state.monitor_table, pid)
          state.on_remove.(handle, pid)

          Electric.Shapes.Status.CleanupTaskSupervisor.cleanup(
            state.stack_id,
            state.storage,
            handle
          )
        catch
          type, reason ->
            dbg({type, reason})
        end

        {state, 0}

      [] ->
        {state, 0}
    end
  end
end
