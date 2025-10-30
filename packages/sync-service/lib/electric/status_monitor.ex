defmodule Electric.StatusMonitor do
  @moduledoc false
  use GenServer

  @type status() :: %{
          conn: :waiting_on_lock | :starting | :up | :sleeping,
          shape: :starting | :up
        }

  @conditions [
    :pg_lock_acquired,
    :replication_client_ready,
    :admin_connection_pool_ready,
    :snapshot_connection_pool_ready,
    :shape_log_collector_ready,
    :supervisor_processes_ready
  ]

  @default_results for condition <- @conditions, into: %{}, do: {condition, {false, %{}}}

  @db_state_key :db_state

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    GenServer.start_link(__MODULE__, stack_id, name: name(stack_id))
  end

  def init(stack_id) do
    Process.set_label({:status_monitor, stack_id})
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    :ets.new(ets_table(stack_id), [:named_table, :protected])

    {:ok, %{stack_id: stack_id, waiters: MapSet.new(), conn_waiters: []}}
  end

  @spec status(String.t()) :: status()
  def status(stack_id) do
    table = ets_table(stack_id)

    results = results(table)

    conn_status =
      case db_state(table) do
        :up -> conn_status_from_results(results)
        :sleeping -> :sleeping
      end

    shape_status = shape_status_from_results(results)

    %{conn: conn_status, shape: shape_status}
  end

  defp conn_status_from_results(%{pg_lock_acquired: {false, _}}), do: :waiting_on_lock

  defp conn_status_from_results(%{
         replication_client_ready: {true, _},
         admin_connection_pool_ready: {true, _},
         snapshot_connection_pool_ready: {true, _}
       }),
       do: :up

  defp conn_status_from_results(_), do: :starting

  defp shape_status_from_results(%{
         shape_log_collector_ready: {true, _},
         supervisor_processes_ready: {true, _}
       }),
       do: :up

  defp shape_status_from_results(_), do: :starting

  def database_connections_going_to_sleep(stack_id) do
    GenServer.cast(name(stack_id), :database_connections_going_to_sleep)
  end

  def database_connections_waking_up(stack_id) do
    GenServer.cast(name(stack_id), :database_connections_waking_up)
  end

  def mark_pg_lock_acquired(stack_id, lock_pid) do
    mark_condition_met(stack_id, :pg_lock_acquired, lock_pid)
  end

  def mark_replication_client_ready(stack_id, client_pid) do
    mark_condition_met(stack_id, :replication_client_ready, client_pid)
  end

  def mark_connection_pool_ready(stack_id, :admin, pool_pid) do
    mark_condition_met(stack_id, :admin_connection_pool_ready, pool_pid)
  end

  def mark_connection_pool_ready(stack_id, :snapshot, pool_pid) do
    mark_condition_met(stack_id, :snapshot_connection_pool_ready, pool_pid)
  end

  def mark_shape_log_collector_ready(stack_id, collector_pid) do
    mark_condition_met(stack_id, :shape_log_collector_ready, collector_pid)
  end

  def mark_supervisor_processes_ready(stack_id, canary_pid) do
    mark_condition_met(stack_id, :supervisor_processes_ready, canary_pid)
  end

  def mark_pg_lock_as_errored(stack_id, message) when is_binary(message) do
    mark_condition_as_errored(stack_id, :pg_lock_acquired, message)
  end

  def mark_replication_client_as_errored(stack_id, message) when is_binary(message) do
    mark_condition_as_errored(stack_id, :replication_client_ready, message)
  end

  def mark_connection_pool_as_errored(stack_id, :admin, message) when is_binary(message) do
    mark_condition_as_errored(stack_id, :admin_connection_pool_ready, message)
  end

  def mark_connection_pool_as_errored(stack_id, :snapshot, message) when is_binary(message) do
    mark_condition_as_errored(stack_id, :snapshot_connection_pool_ready, message)
  end

  defp mark_condition_as_errored(stack_id, condition, error) do
    GenServer.cast(name(stack_id), {:condition_errored, condition, error})
  end

  defp mark_condition_met(stack_id, condition, process) do
    GenServer.cast(name(stack_id), {:condition_met, condition, process})
  end

  def wait_until_active(stack_id, opts \\ []) do
    case status(stack_id) do
      %{conn: :up, shape: :up} ->
        :ok

      %{conn: :sleeping} ->
        if Keyword.get(opts, :block_on_conn_sleeping, false) do
          do_wait_until_active(stack_id, opts)
        else
          :conn_sleeping
        end

      _ ->
        do_wait_until_active(stack_id, opts)
    end
  end

  defp do_wait_until_active(stack_id, opts) do
    timeout = Keyword.fetch!(opts, :timeout)

    try do
      status_monitor_pid = stack_id |> name() |> GenServer.whereis()

      case status_monitor_pid do
        nil ->
          # Either the status monitor has not started yet, or the stack has
          # been terminated in some permanent way
          maybe_retry_wait_until_active(
            stack_id,
            opts,
            timeout,
            %{
              message: "Status monitor not found for stack ID: #{stack_id}",
              error_code: :stack_not_found
            }
          )

        pid when is_pid(pid) ->
          GenServer.call(pid, {:wait_until_active, timeout}, :infinity)
      end
    rescue
      ArgumentError ->
        # This happens when the Process Registry has not been created yet
        maybe_retry_wait_until_active(
          stack_id,
          opts,
          timeout,
          %{
            message: "Stack ID not recognised: #{stack_id}",
            error_code: :stack_not_found
          }
        )
    catch
      :exit, _reason ->
        maybe_retry_wait_until_active(
          stack_id,
          opts,
          timeout,
          %{
            message: "Stack #{inspect(stack_id)} has terminated",
            error_code: :stack_terminated
          }
        )
    end
  end

  @retry_time 10
  defp maybe_retry_wait_until_active(_stack_id, _opts, timeout, last_error)
       when timeout <= @retry_time do
    {:error, last_error}
  end

  defp maybe_retry_wait_until_active(stack_id, opts, timeout, _) do
    Process.sleep(@retry_time)
    wait_until_active(stack_id, Keyword.put(opts, :timeout, timeout - @retry_time))
  end

  @doc """
  Just like `wait_until_active/2` but non-blocking.

  This function basically subscribes to status updates to get notified by StatusMonitor when
  the status transitions to `%{conn: :up, shape: :up}`.

  Returns a ref that will then be passed in the notification message as `{<ref>, <reply from StatusMonitor>}`.
  """
  @spec wait_until_conn_up_async(String.t()) :: reference()
  def wait_until_conn_up_async(stack_id) do
    pid = stack_id |> name() |> GenServer.whereis()
    call_ref = make_ref()

    send(pid, {:"$gen_call", {self(), call_ref}, :wait_until_conn_up})

    call_ref
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

  def handle_cast(:database_connections_going_to_sleep, state) do
    :ets.insert(ets_table(state.stack_id), {@db_state_key, :sleeping})
    {:noreply, state}
  end

  def handle_cast(:database_connections_waking_up, state) do
    # Only update the ETS table on the first request. Subsequent requests will just wait for the stack to become active.
    case :ets.lookup_element(ets_table(state.stack_id), @db_state_key, 2) do
      :sleeping -> :ets.insert(ets_table(state.stack_id), {@db_state_key, :up})
      :up -> :noop
    end

    {:noreply, state}
  end

  def handle_call({:wait_until_active, timeout}, from, %{waiters: waiters} = state) do
    case status(state.stack_id) do
      %{conn: :up, shape: :up} ->
        {:reply, :ok, state}

      _ ->
        Process.send_after(self(), {:timeout_waiter, from}, timeout)
        {:noreply, %{state | waiters: MapSet.put(waiters, from)}}
    end
  end

  def handle_call(:wait_until_conn_up, from, %{conn_waiters: conn_waiters} = state) do
    case status(state.stack_id) do
      %{conn: :up} -> {:reply, :ok, state}
      _ -> {:noreply, %{state | conn_waiters: [from | conn_waiters]}}
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
      GenServer.reply(waiter, {:error, timeout_error(state.stack_id)})
      {:noreply, %{state | waiters: MapSet.delete(state.waiters, waiter)}}
    else
      {:noreply, state}
    end
  end

  defp maybe_reply_to_waiters(%{waiters: waiters, conn_waiters: conn_waiters} = state)
       when map_size(waiters) == 0 and conn_waiters == [],
       do: state

  defp maybe_reply_to_waiters(state) do
    status = status(state.stack_id)

    waiters =
      if status.conn == :up and status.shape == :up do
        Enum.each(state.waiters, &GenServer.reply(&1, :ok))
        MapSet.new()
      end

    conn_waiters =
      if status.conn == :up do
        Enum.each(state.conn_waiters, &GenServer.reply(&1, :ok))
        []
      end

    state
    |> Map.update!(:waiters, &(waiters || &1))
    |> Map.update!(:conn_waiters, &(conn_waiters || &1))
  end

  defp db_state(table) do
    :ets.lookup_element(table, @db_state_key, 2, :up)
  rescue
    ArgumentError ->
      # This happens when the table is not found, which means the
      # process has not been started yet
      :up
  end

  defp results(table) do
    results = table |> :ets.tab2list() |> Map.new()
    Map.merge(@default_results, results)
  rescue
    ArgumentError ->
      # This happens when the table is not found, which means the
      # process has not been started yet
      @default_results
  end

  @doc """
  Get timeout error information including both message and error code.

  Returns a map with:
  - `:message` - Human-readable error message
  - `:error_code` - Machine-readable error code atom
  """
  def timeout_error(stack_id) do
    results = stack_id |> ets_table() |> results()
    error_code = Electric.Shapes.Api.ErrorCode.from_timeout_results(results)

    %{
      message: build_timeout_message(results),
      error_code: error_code
    }
  end

  @doc """
  Get the human-readable timeout message for the stack.

  For backwards compatibility. New code should use timeout_error/1 instead.
  """
  def timeout_message(stack_id) do
    timeout_error(stack_id).message
  end

  defp build_timeout_message(results) do
    case results do
      %{timeout_message: message} when is_binary(message) ->
        message

      %{pg_lock_acquired: {false, details}} ->
        "Timeout waiting for Postgres lock acquisition" <> format_details(details)

      %{replication_client_ready: {false, details}} when details == %{} ->
        "Timeout waiting for replication client to be ready. " <>
          "Check that you don't have pending transactions in the database. " <>
          "Electric has to wait for all pending transactions to commit or rollback " <>
          "before it can create the replication slot."

      %{replication_client_ready: {false, details}} ->
        "Timeout waiting for replication client to be ready" <> format_details(details)

      %{admin_connection_pool_ready: {false, details}} ->
        "Timeout waiting for database connection pool (metadata) to be ready" <>
          format_details(details)

      %{snapshot_connection_pool_ready: {false, details}} ->
        "Timeout waiting for database connection pool (snapshot) to be ready" <>
          format_details(details)

      %{shape_log_collector_ready: {false, details}} ->
        "Timeout waiting for shape data to be loaded" <> format_details(details)

      %{supervisor_processes_ready: {false, details}} ->
        "Timeout waiting for stack restart" <> format_details(details)
    end
  end

  defp format_details(%{error: error}), do: ": #{error}"
  defp format_details(_), do: ""

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  defp ets_table(stack_id), do: :"#{stack_id}:status_monitor"
end
