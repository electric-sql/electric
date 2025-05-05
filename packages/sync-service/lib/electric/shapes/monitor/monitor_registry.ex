defmodule Electric.Shapes.Monitor.MonitorRegistry do
  @moduledoc """
  Tracks active uses of shapes, the number of readers (and their pids) and the
  active writer.

  Allows for registering callback messages when all readers of a shape have
  terminated or when some other process has terminated.

  Uses `Electric.Shapes.Monitor.CleanupTaskSupervisor` to trigger an
  `unsafe_cleanup!` of shape storage once the shape supervisor has terminated.
  """
  use GenServer

  alias Electric.Shapes.Monitor

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
            on_remove: [type: {:or, [nil, {:fun, 2}]}],
            on_cleanup: [type: {:or, [nil, {:fun, 1}]}]
          )

  def name(opts_or_stack_id) do
    Electric.ProcessRegistry.name(opts_or_stack_id, __MODULE__)
  end

  def start_link(opts) do
    with {:ok, config} <- NimbleOptions.validate(Map.new(opts), @schema) do
      GenServer.start_link(__MODULE__, config, name: name(opts))
    end
  end

  @doc """
  Register the current process as a reader of the given shape.
  """
  def register_reader(stack_id, shape_handle, pid \\ self()) do
    GenServer.call(name(stack_id), {:register_reader, shape_handle, pid})
  end

  @doc """
  Unregister the current process as a reader of the given shape.
  """
  def unregister_reader(stack_id, shape_handle, pid \\ self()) do
    GenServer.call(name(stack_id), {:unregister_reader, shape_handle, pid})
  end

  @doc """
  Register the current process as a writer (consumer) of the given shape.
  """
  def register_writer(stack_id, shape_handle, pid \\ self()) do
    GenServer.call(name(stack_id), {:register_writer, shape_handle, pid})
  end

  @doc """
  The number of active readers of the given shape.
  """
  def reader_count(stack_id, shape_handle) do
    case :ets.lookup(table(stack_id), shape_handle) do
      [{_, count}] -> {:ok, count}
      [] -> {:ok, 0}
    end
  end

  @doc """
  The number of active readers of all shapes.
  """
  def reader_count(stack_id) do
    case :ets.lookup(table(stack_id), :all) do
      [{:all, count}] -> count
      [] -> 0
    end
  end

  @doc """
  Request a message when all readers of the given handle have finished or terminated.
  """
  def notify_reader_termination(stack_id, shape_handle, reason, pid \\ self()) do
    case reader_count(stack_id, shape_handle) do
      {:ok, 0} ->
        do_notify_reader_termination({pid, reason}, shape_handle)
        :ok

      {:ok, _} ->
        GenServer.call(name(stack_id), {:notify_reader_termination, shape_handle, pid, reason})
    end
  end

  # used in tests
  def termination_watchers(stack_id, shape_handle) do
    GenServer.call(name(stack_id), {:termination_watchers, shape_handle})
  end

  @doc """
  Request that the given shape is cleaned up by
  `Electric.Shapes.Monitor.CleanupTaskSupervisor` after `wait_pid` has
  terminated.
  """
  def cleanup_after_termination(stack_id, shape_handle, wait_pid, pid \\ self()) do
    GenServer.call(name(stack_id), {:cleanup_after_termination, shape_handle, wait_pid, pid})
  end

  defp do_notify_reader_termination(pids, handle) when is_list(pids) do
    Enum.each(pids, &do_notify_reader_termination(&1, handle))
  end

  defp do_notify_reader_termination({pid, reason}, handle) when is_pid(pid) do
    send(pid, {Monitor, :reader_termination, handle, reason})
  end

  defp table(stack_id) do
    :"#{__MODULE__}:#{stack_id}"
  end

  @impl GenServer
  def init(%{stack_id: stack_id} = opts) do
    Process.set_label({:shape_monitor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    storage = Map.fetch!(opts, :storage)
    on_remove = Map.get(opts, :on_remove) || fn _, _ -> :ok end
    on_cleanup = Map.get(opts, :on_cleanup) || fn _ -> :ok end

    reader_table =
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
      reader_table: reader_table,
      on_remove: on_remove,
      on_cleanup: on_cleanup,
      termination_watchers: %{},
      cleanup_pids: MapSet.new()
    }

    {:ok, state}
  end

  @impl GenServer
  # should be idempotent - same pid, same handle, no change
  #
  # if the pid hasn't registered before for the given shape then
  # - add it and increment the counter for the shape
  # - decrement counters for previous shapes
  # if the pid has registered for the given shape before
  # - do nothing
  def handle_call({:register_reader, handle, pid}, _from, state) do
    previous_registrations =
      :ets.select(state.monitor_table, [
        {{pid, :reader, :"$1", :"$2"}, [{:"=/=", :"$1", handle}], [[:"$1", :"$2"]]}
      ])

    existing_registrations =
      :ets.select(state.monitor_table, [
        {{pid, :reader, :"$1", :"$2"}, [{:==, :"$1", handle}], [[:"$1", :"$2"]]}
      ])

    case existing_registrations do
      [] ->
        ref = Process.monitor(pid)
        :ets.insert(state.monitor_table, {pid, :reader, handle, ref})

        count = update_counter(state.stack_id, handle, 1)

        Logger.debug(fn ->
          "register: #{inspect(pid)}, #{count} registered processes for shape #{inspect(handle)}"
        end)

      [_] ->
        :ok
    end

    state =
      Enum.reduce(previous_registrations, state, fn [handle, _ref], state ->
        {state, _count} = pid_handle_termination(pid, handle, state)
        state
      end)

    {:reply, :ok, state}
  end

  def handle_call({:unregister_reader, _handle, pid}, _from, state) do
    {state, _count} = delete_registered_process(pid, true, state)

    {:reply, :ok, state}
  end

  def handle_call({:register_writer, handle, pid}, _from, state) do
    ref = Process.monitor(pid)

    if :ets.insert_new(state.monitor_table, {pid, :consumer, handle, ref}) do
      {:reply, :ok, state}
    else
      {:reply, {:error, "pid is already registered"}, state}
    end
  end

  def handle_call({:notify_reader_termination, shape_handle, pid, reason}, _from, state) do
    %{stack_id: stack_id} = state

    state =
      case reader_count(stack_id, shape_handle) do
        {:ok, 0} ->
          do_notify_reader_termination({pid, reason}, shape_handle)
          state

        {:ok, _} ->
          add_reader_termination_watcher(shape_handle, pid, reason, state)
      end

    {:reply, :ok, state}
  end

  def handle_call({:cleanup_after_termination, shape_handle, wait_pid, pid}, _from, state) do
    # has the consumer registered itself?
    # if not that's an error
    case :ets.match(state.monitor_table, {pid, :consumer, :"$1", :_}) do
      [] ->
        {:reply, {:error, "process not registered as consumer"}, state}

      [[_handle]] ->
        # registration should be idempotent
        if :ets.insert_new(state.monitor_table, {wait_pid, :cleanup, shape_handle, nil}) do
          _ref = Process.monitor(wait_pid)
        end

        {:reply, :ok, state}
    end
  end

  def handle_call({:termination_watchers, shape_handle}, _from, state) do
    {:reply, {:ok, Map.get(state.termination_watchers, shape_handle, [])}, state}
  end

  @impl GenServer
  def handle_info({:DOWN, _ref, :process, pid, _reason}, state) do
    {state, _count} = delete_registered_process(pid, false, state)

    {:noreply, state}
  end

  defp add_reader_termination_watcher(shape_handle, pid, reason, state) do
    Map.update!(state, :termination_watchers, fn watchers ->
      Map.update(watchers, shape_handle, [{pid, reason}], &[{pid, reason} | &1])
    end)
  end

  defp remove_reader_termination_watcher(shape_handle, pid, state) do
    Map.update!(state, :termination_watchers, fn watchers ->
      {pids, watchers} = Map.pop(watchers, shape_handle, [])

      case Enum.reject(pids, &match?({^pid, _}, &1)) do
        [] -> watchers
        pids -> Map.put(watchers, shape_handle, pids)
      end
    end)
  end

  defp update_counter(stack_id, handle, incr) do
    :ets.update_counter(table(stack_id), :all, incr, {:all, 0})
    :ets.update_counter(table(stack_id), handle, incr, {handle, 0})
  end

  defp delete_registered_process(pid, demonitor?, state) do
    case :ets.lookup(state.monitor_table, pid) do
      [{_, :reader, handle, ref}] ->
        if demonitor?, do: Process.demonitor(ref, [:flush])
        {state, count} = pid_handle_termination(pid, handle, state)
        state.on_remove.(handle, pid)
        {state, count}

      [{_, :consumer, handle, _ref}] ->
        Logger.debug("Consumer #{inspect(handle)} terminated")

        state.on_remove.(handle, pid)

        {remove_reader_termination_watcher(handle, pid, state), 0}

      [{_, :cleanup, handle, _ref}] ->
        Electric.Shapes.Monitor.CleanupTaskSupervisor.cleanup(
          state.stack_id,
          state.storage,
          handle,
          state.on_cleanup
        )

        {state, 0}

      [] ->
        {state, 0}
    end
  after
    :ets.delete(state.monitor_table, pid)
  end

  defp pid_handle_termination(pid, handle, state) do
    %{stack_id: stack_id, termination_watchers: termination_watchers} = state

    count = update_counter(stack_id, handle, -1)

    Logger.debug(fn ->
      "deregister: #{inspect(pid)}, #{count} registered processes for shape #{inspect(handle)}"
    end)

    {
      if count == 0 do
        {pids, termination_watchers} = Map.pop(termination_watchers, handle, [])
        do_notify_reader_termination(pids, handle)
        %{state | termination_watchers: termination_watchers}
      else
        state
      end,
      count
    }
  end
end
