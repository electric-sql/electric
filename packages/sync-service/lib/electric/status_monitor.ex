defmodule Electric.StatusMonitor do
  @moduledoc false
  use GenServer

  @type status() :: :waiting | :starting | :active

  @conditions [
    :pg_lock_acquired,
    :replication_client_ready,
    :connection_pool_ready,
    :shape_log_collector_ready
  ]

  @default_results for condition <- @conditions, into: %{}, do: {condition, {false, %{}}}

  def start_link(stack_id) do
    GenServer.start_link(__MODULE__, stack_id, name: name(stack_id))
  end

  def init(stack_id) do
    Process.set_label({:status_monitor, stack_id})
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    :ets.new(ets_table(stack_id), [:named_table, :protected])

    {:ok, %{stack_id: stack_id, waiters: MapSet.new()}}
  end

  @spec status(String.t()) :: status()
  def status(stack_id) do
    case results(stack_id) do
      %{pg_lock_acquired: {false, _}} ->
        :waiting

      %{
        replication_client_ready: {true, _},
        connection_pool_ready: {true, _},
        shape_log_collector_ready: {true, _}
      } ->
        :active

      _ ->
        :starting
    end
  end

  def mark_pg_lock_acquired(stack_id, lock_pid) do
    mark_condition_met(stack_id, :pg_lock_acquired, lock_pid)
  end

  def mark_replication_client_ready(stack_id, client_pid) do
    mark_condition_met(stack_id, :replication_client_ready, client_pid)
  end

  def mark_connection_pool_ready(stack_id, pool_pid) do
    mark_condition_met(stack_id, :connection_pool_ready, pool_pid)
  end

  def mark_shape_log_collector_ready(stack_id, collector_pid) do
    mark_condition_met(stack_id, :shape_log_collector_ready, collector_pid)
  end

  defp mark_condition_met(stack_id, condition, process) do
    GenServer.cast(name(stack_id), {:condition_met, condition, process})
  end

  def mark_pg_lock_as_errored(stack_id, message) when is_binary(message) do
    mark_condition_as_errored(stack_id, :pg_lock_acquired, message)
  end

  def mark_replication_client_as_errored(stack_id, message) when is_binary(message) do
    mark_condition_as_errored(stack_id, :replication_client_ready, message)
  end

  def mark_connection_pool_as_errored(stack_id, message) when is_binary(message) do
    mark_condition_as_errored(stack_id, :connection_pool_ready, message)
  end

  def mark_shape_log_collector_as_errored(stack_id, message) when is_binary(message) do
    mark_condition_as_errored(stack_id, :shape_log_collector_ready, message)
  end

  defp mark_condition_as_errored(stack_id, condition, error) do
    GenServer.cast(name(stack_id), {:condition_errored, condition, error})
  end

  def wait_until_active(stack_id, timeout) do
    if status(stack_id) == :active do
      :ok
    else
      try do
        GenServer.call(name(stack_id), {:wait_until_active, timeout}, :infinity)
      rescue
        ArgumentError ->
          # This happens when the Process Registry has not been created yet
          maybe_retry_wait_until_active(
            stack_id,
            timeout,
            "Stack ID not recognised: #{stack_id}"
          )
      catch
        :exit, {:noproc, _} ->
          # This happens when the StatusMonitor process has not been started yet
          maybe_retry_wait_until_active(
            stack_id,
            timeout,
            "Status monitor not found for stack ID: #{stack_id}"
          )
      end
    end
  end

  @retry_time 10
  defp maybe_retry_wait_until_active(_stack_id, timeout, last_error)
       when timeout <= @retry_time do
    {:error, last_error}
  end

  defp maybe_retry_wait_until_active(stack_id, timeout, _) do
    Process.sleep(@retry_time)
    wait_until_active(stack_id, timeout - @retry_time)
  end

  # Only used in tests
  def wait_for_messages_to_be_processed(stack_id) do
    GenServer.call(name(stack_id), :wait_for_messages_to_be_processed)
  end

  def handle_cast({:condition_met, condition, process}, state)
      when condition in @conditions do
    Process.monitor(process)
    :ets.insert(ets_table(state.stack_id), {condition, {true, %{process: process}}})
    {:noreply, maybe_reply_to_waiters(state)}
  end

  def handle_cast({:condition_errored, condition, error}, state) do
    :ets.insert(ets_table(state.stack_id), {condition, {false, %{error: error}}})
    {:noreply, state}
  end

  def handle_call({:wait_until_active, timeout}, from, %{waiters: waiters} = state) do
    if status(state.stack_id) == :active do
      {:reply, :ok, state}
    else
      Process.send_after(self(), {:timeout_waiter, from}, timeout)
      {:noreply, %{state | waiters: MapSet.put(waiters, from)}}
    end
  end

  def handle_call(:wait_for_messages_to_be_processed, _from, state) do
    {:reply, :ok, state}
  end

  def handle_info({:DOWN, _ref, :process, pid, _reason}, state) do
    :ets.match_delete(ets_table(state.stack_id), {:_, {true, %{process: pid}}})

    {:noreply, state}
  end

  def handle_info({:timeout_waiter, waiter}, state) do
    if MapSet.member?(state.waiters, waiter) do
      GenServer.reply(waiter, {:error, timeout_message(state.stack_id)})
      {:noreply, %{state | waiters: MapSet.delete(state.waiters, waiter)}}
    else
      {:noreply, state}
    end
  end

  defp maybe_reply_to_waiters(%{waiters: waiters} = state) when map_size(waiters) == 0, do: state

  defp maybe_reply_to_waiters(%{waiters: waiters} = state) do
    case status(state.stack_id) do
      :active ->
        Enum.each(waiters, fn waiter ->
          GenServer.reply(waiter, :ok)
        end)

        %{state | waiters: MapSet.new()}

      _ ->
        state
    end
  end

  defp results(stack_id) do
    results =
      stack_id
      |> ets_table()
      |> :ets.tab2list()
      |> Map.new()

    Map.merge(@default_results, results)
  rescue
    ArgumentError ->
      # This happens when the table is not found, which means the
      # process has not been started yet
      @default_results
  end

  def timeout_message(stack_id) do
    case results(stack_id) do
      %{timeout_message: message} when is_binary(message) ->
        message

      %{pg_lock_acquired: {false, details}} ->
        "Timeout waiting for Postgres lock acquisition" <> format_details(details)

      %{replication_client_ready: {false, details}} ->
        "Timeout waiting for replication client to be ready" <> format_details(details)

      %{connection_pool_ready: {false, details}} ->
        "Timeout waiting for database connection pool to be ready" <> format_details(details)

      %{shape_log_collector_ready: {false, details}} ->
        "Timeout waiting for shape data to be loaded" <> format_details(details)
    end
  end

  defp format_details(%{error: error}), do: ": #{error}"
  defp format_details(_), do: ""

  defp name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  defp ets_table(stack_id) do
    :"#{stack_id}:status_monitor"
  end
end
