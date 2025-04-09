defmodule Electric.StatusMonitor do
  use GenServer

  @type status() :: :waiting | :starting | :active

  @conditions [
    :pg_lock_acquired,
    :replication_client_ready,
    :connection_pool_ready,
    :shape_log_collector_ready
  ]

  @default_results for condition <- @conditions, into: %{}, do: {condition, false}

  def start_link(stack_id) do
    GenServer.start_link(__MODULE__, stack_id, name: name(stack_id))
  end

  def init(stack_id) do
    Process.set_label({:status_monitor, stack_id})
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    :ets.new(ets_table(stack_id), [:named_table, :protected])

    {:ok, %{stack_id: stack_id, waiters: []}}
  end

  @spec status(String.t()) :: status()
  def status(stack_id) do
    case results(stack_id) do
      %{pg_lock_acquired: false} ->
        :waiting

      %{
        replication_client_ready: true,
        connection_pool_ready: true,
        shape_log_collector_ready: true
      } ->
        :active

      _ ->
        :starting
    end
  end

  def pg_lock_acquired(stack_id) do
    condition_met(stack_id, :pg_lock_acquired, self())
  end

  def replication_client_ready(stack_id) do
    condition_met(stack_id, :replication_client_ready, self())
  end

  def connection_pool_ready(stack_id, pool_pid) do
    condition_met(stack_id, :connection_pool_ready, pool_pid)
  end

  def shape_log_collector_ready(stack_id) do
    condition_met(stack_id, :shape_log_collector_ready, self())
  end

  defp condition_met(stack_id, condition, process) do
    GenServer.cast(name(stack_id), {:condition_met, condition, process})
  end

  def wait_until_active(stack_id, timeout \\ 60_000) do
    if status(stack_id) == :active do
      :ok
    else
      try do
        GenServer.call(name(stack_id), :wait_until_active, timeout)
      catch
        :exit, {:timeout, _} ->
          {:error, :timeout}
      end
    end
  end

  # Only used in tests
  def wait_for_messages_to_be_processed(stack_id) do
    GenServer.call(name(stack_id), :wait_for_messages_to_be_processed)
  end

  def handle_cast({:condition_met, condition, process}, state)
      when condition in @conditions do
    Process.monitor(process)
    :ets.insert(ets_table(state.stack_id), {condition, process})
    {:noreply, maybe_reply_to_waiters(state)}
  end

  def handle_call(:wait_until_active, from, %{waiters: waiters} = state) do
    if status(state.stack_id) == :active do
      {:reply, :ok, state}
    else
      {:noreply, %{state | waiters: [from | waiters]}}
    end
  end

  def handle_call(:wait_for_messages_to_be_processed, _from, state) do
    {:reply, :ok, state}
  end

  def handle_info({:DOWN, _ref, :process, pid, _reason}, state) do
    for {condition, ^pid} <- :ets.tab2list(ets_table(state.stack_id)) do
      true = :ets.delete(ets_table(state.stack_id), condition)
    end

    {:noreply, state}
  end

  defp maybe_reply_to_waiters(%{waiters: []} = state), do: state

  defp maybe_reply_to_waiters(%{waiters: waiters} = state) do
    case status(state.stack_id) do
      :active ->
        Enum.each(waiters, fn waiter ->
          GenServer.reply(waiter, :ok)
        end)

        %{state | waiters: []}

      _ ->
        state
    end
  end

  defp results(stack_id) do
    results =
      stack_id
      |> ets_table()
      |> :ets.tab2list()
      |> Map.new(fn {condition, _pid} -> {condition, true} end)

    Map.merge(@default_results, results)
  rescue
    ArgumentError ->
      # This happens when the table is not found, which means the
      # process has not been started yet
      @default_results
  end

  defp name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  defp ets_table(stack_id) do
    :"#{stack_id}:status_monitor"
  end
end
