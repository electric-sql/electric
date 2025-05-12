defmodule Electric.Shapes.Monitor.RefCounter do
  @moduledoc """
  Tracks active uses of shapes, the number of readers (and their pids) and the
  active writer.

  Allows for registering callback messages when all readers of a shape have
  terminated or when some other process has terminated.

  Uses `Electric.Shapes.Monitor.CleanupTaskSupervisor` to trigger an
  `unsafe_cleanup!` of shape storage once the shape supervisor has terminated.

  See `Electric.Shapes.Monitor` for usage.
  """
  use GenServer

  alias Electric.Shapes.Monitor
  alias Electric.Shapes.ConsumerSupervisor

  require Logger

  @type stack_id :: Electric.stack_id()
  @type shape_handle :: Electric.ShapeCache.shape_handle()

  defguardp is_consumer_shutdown_with_data_retention?(reason)
            when reason in [:normal, :killed, :shutdown] or
                   (is_tuple(reason) and elem(reason, 0) == :shutdown and
                      elem(reason, 1) != :cleanup)

  def name(opts_or_stack_id) do
    Electric.ProcessRegistry.name(opts_or_stack_id, __MODULE__)
  end

  # the opts are validated by Monitor
  def start_link(opts) do
    GenServer.start_link(__MODULE__, Map.new(opts), name: name(opts))
  end

  @doc false
  @spec register_reader(stack_id(), shape_handle(), pid()) :: :ok
  def register_reader(stack_id, shape_handle, pid \\ self()) do
    GenServer.call(name(stack_id), {:register_reader, shape_handle, pid})
  end

  @doc false
  @spec unregister_reader(stack_id(), shape_handle(), pid()) :: :ok
  def unregister_reader(stack_id, shape_handle, pid \\ self()) do
    GenServer.call(name(stack_id), {:unregister_reader, shape_handle, pid})
  end

  @doc false
  @spec register_writer(stack_id(), shape_handle(), pid()) :: :ok | {:error, term()}
  def register_writer(stack_id, shape_handle, shape, pid \\ self()) do
    GenServer.call(name(stack_id), {:register_writer, shape_handle, shape, pid})
  end

  @doc false
  @spec reader_count(stack_id(), shape_handle()) :: {:ok, non_neg_integer()}
  def reader_count(stack_id, shape_handle) do
    case :ets.lookup(table(stack_id), shape_handle) do
      [{_, count}] -> {:ok, count}
      [] -> {:ok, 0}
    end
  end

  @doc false
  @spec reader_count(stack_id()) :: {:ok, non_neg_integer()}
  def reader_count(stack_id) do
    case :ets.lookup(table(stack_id), :all) do
      [{:all, count}] -> {:ok, count}
      [] -> {:ok, 0}
    end
  end

  @doc false
  @spec reader_count!(stack_id()) :: non_neg_integer()
  def reader_count!(stack_id) do
    {:ok, count} = reader_count(stack_id)
    count
  end

  def notify_reader_termination(stack_id, shape_handle, reason, pid \\ self()) do
    case reader_count(stack_id, shape_handle) do
      {:ok, 0} ->
        do_notify_reader_termination({pid, reason}, shape_handle)
        :ok

      {:ok, _} ->
        GenServer.call(name(stack_id), {:notify_reader_termination, shape_handle, pid, reason})
    end
  end

  def purge_shape(stack_id, shape_handle, shape) do
    GenServer.call(name(stack_id), {:purge_shape, shape_handle, shape})
  end

  @doc false
  @spec termination_watchers(stack_id(), shape_handle()) :: {:ok, [{pid(), reason :: term()}]}
  def termination_watchers(stack_id, shape_handle) do
    GenServer.call(name(stack_id), {:termination_watchers, shape_handle})
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
    publication_manager = Map.fetch!(opts, :publication_manager)
    shape_status = Map.fetch!(opts, :shape_status)
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
      publication_manager: publication_manager,
      shape_status: shape_status,
      monitor_table: monitor_table,
      reader_table: reader_table,
      on_remove: on_remove,
      on_cleanup: on_cleanup,
      termination_watchers: %{},
      cleanup_handles: MapSet.new()
    }

    # log some debug stats
    # send(self(), :log_active)

    {:ok, state}
  end

  @impl GenServer
  def handle_call({:register_reader, handle, pid}, _from, state) do
    case :ets.lookup(state.monitor_table, pid) do
      [{^pid, :reader, ^handle, _ref}] ->
        {:reply, :ok, state}

      [{^pid, :reader, previous_handle, ref}] ->
        state =
          state
          |> register_reader_for_handle(handle, pid)
          |> handle_pid_termination(pid, previous_handle, ref)

        {:reply, :ok, state}

      [] ->
        {:reply, :ok, register_reader_for_handle(state, handle, pid)}
    end
  end

  def handle_call({:unregister_reader, handle, pid}, _from, state) do
    state = delete_reader_process(pid, handle, state)

    {:reply, :ok, state}
  end

  def handle_call({:register_writer, handle, shape, pid}, _from, state) do
    supervisor = ConsumerSupervisor.whereis(state.stack_id, handle)

    if supervisor do
      if :ets.insert_new(state.monitor_table, {pid, :writer, handle, nil}) do
        Process.monitor(pid, tag: {:down, :writer, handle})
        Process.monitor(supervisor, tag: {:down, :writer_supervisor, handle, shape})

        {:reply, :ok, state}
      else
        {:reply, {:error, "process is already registered"}, state}
      end
    else
      {:reply, {:error, "no supervisor registered for consumer"}, state}
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

  def handle_call({:termination_watchers, shape_handle}, _from, state) do
    {:reply, {:ok, Map.get(state.termination_watchers, shape_handle, [])}, state}
  end

  def handle_call({:purge_shape, shape_handle, shape}, _from, state) do
    :ok =
      Electric.Shapes.Monitor.CleanupTaskSupervisor.cleanup_async(
        state.stack_id,
        state.storage,
        state.publication_manager,
        state.shape_status,
        shape_handle,
        shape,
        state.on_cleanup
      )

    {:reply, :ok, state}
  end

  @impl GenServer
  def handle_info({{:down, :writer, handle}, _ref, :process, pid, reason}, state)
      when not is_consumer_shutdown_with_data_retention?(reason) do
    :ets.delete(state.monitor_table, pid)

    {:noreply,
     state
     |> notify_remove(handle, pid)
     |> Map.update!(:cleanup_handles, &MapSet.put(&1, handle))
     |> remove_reader_termination_watcher(handle, pid)}
  end

  def handle_info({{:down, :writer, handle}, _ref, :process, pid, _reason}, state) do
    :ets.delete(state.monitor_table, pid)

    {:noreply,
     state
     |> notify_remove(handle, pid)
     |> remove_reader_termination_watcher(handle, pid)}
  end

  def handle_info(
        {{:down, :writer_supervisor, handle, shape}, _ref, :process, _pid, _reason},
        state
      ) do
    if MapSet.member?(state.cleanup_handles, handle) do
      Electric.Shapes.Monitor.CleanupTaskSupervisor.cleanup_async(
        state.stack_id,
        state.storage,
        state.publication_manager,
        state.shape_status,
        handle,
        shape,
        state.on_cleanup
      )

      {:noreply, Map.update!(state, :cleanup_handles, &MapSet.delete(&1, handle))}
    else
      {:noreply, state}
    end
  end

  def handle_info({{:down, :reader, handle}, _ref, :process, pid, _reason}, state) do
    state = delete_reader_process(pid, handle, state)

    {:noreply, state}
  end

  def handle_info(:log_active, state) do
    Logger.debug(fn -> statistics(state) end)

    Process.send_after(self(), :log_active, 10_000)

    {:noreply, state}
  end

  defp statistics(state) do
    handles =
      state.monitor_table
      |> :ets.select([{{:_, :reader, :"$1", :_}, [], [[:"$1"]]}])
      |> MapSet.new(&hd/1)

    %{readers: reader_count!(state.stack_id), shapes: MapSet.size(handles)}
  end

  defp register_reader_for_handle(state, handle, pid) do
    ref = Process.monitor(pid, tag: {:down, :reader, handle})
    :ets.insert(state.monitor_table, {pid, :reader, handle, ref})

    count = update_counter(state.stack_id, handle, 1)

    Logger.debug(fn ->
      "register: #{inspect(pid)}, #{count} registered processes for shape #{inspect(handle)}"
    end)

    record_telemetry(state)
  end

  defp add_reader_termination_watcher(shape_handle, pid, reason, state) do
    Map.update!(state, :termination_watchers, fn watchers ->
      Map.update(watchers, shape_handle, [{pid, reason}], &[{pid, reason} | &1])
    end)
  end

  defp remove_reader_termination_watcher(state, shape_handle, pid) do
    Map.update!(state, :termination_watchers, fn watchers ->
      {pids, watchers} = Map.pop(watchers, shape_handle, [])

      case Enum.reject(pids, &match?({^pid, _}, &1)) do
        [] -> watchers
        pids -> Map.put(watchers, shape_handle, pids)
      end
    end)
  end

  defp update_counter(stack_id, handle, incr) do
    update_op =
      if incr < 0,
        do: {2, incr, 0, 0},
        else: incr

    :ets.update_counter(table(stack_id), :all, update_op, {:all, 0})
    :ets.update_counter(table(stack_id), handle, update_op, {handle, 0})
  end

  defp delete_reader_process(pid, handle, state) do
    case :ets.lookup(state.monitor_table, pid) do
      [{^pid, :reader, registered_handle, ref}] ->
        # we get occasional :down messages with stale handles, maybe from
        # a race condition between a de/re-register and the down message.
        # it's important that we only deregister the active one, rather than
        # the stale one, otherwise the count of active clients differs from the
        # number of registered pids and shapes get deleted with active readers
        if registered_handle != handle,
          do: Logger.debug("Stale de-registration of pid for handle #{handle}")

        state
        |> handle_pid_termination(pid, registered_handle, ref)
        |> notify_remove(handle, pid)

      [] ->
        state
    end
  after
    :ets.delete(state.monitor_table, pid)
  end

  defp handle_pid_termination(state, pid, handle, ref) do
    %{stack_id: stack_id, termination_watchers: termination_watchers} = state

    if is_reference(ref), do: Process.demonitor(ref, [:flush])

    stack_id
    |> update_counter(handle, -1)
    |> tap(fn count ->
      Logger.debug(fn ->
        "deregister: #{inspect(pid)}, #{count} registered processes for shape #{inspect(handle)}"
      end)
    end)
    |> case do
      0 ->
        {pids, termination_watchers} = Map.pop(termination_watchers, handle, [])

        :ets.delete(table(stack_id), handle)

        Logger.debug(fn ->
          "notifying #{length(pids)} of shape #{inspect(handle)} release"
        end)

        do_notify_reader_termination(pids, handle)

        %{state | termination_watchers: termination_watchers}

      n when n > 0 ->
        state
    end
    |> record_telemetry()
  end

  defp notify_remove(%{on_remove: on_remove} = state, handle, pid) do
    on_remove.(handle, pid)
    state
  end

  defp record_telemetry(state) do
    :telemetry.execute(
      [:electric, :shape_monitor],
      %{active_reader_count: reader_count!(state.stack_id)},
      %{stack_id: state.stack_id}
    )

    state
  end
end
