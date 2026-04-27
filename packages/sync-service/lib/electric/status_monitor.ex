defmodule Electric.StatusMonitor do
  @moduledoc false
  use GenServer

  require Logger

  @type status() :: %{
          conn: :waiting_on_lock | :starting | :up | :sleeping,
          shape: :starting | :read_only | :up
        }

  @conditions [
    :pg_lock_acquired,
    :replication_client_ready,
    :admin_connection_pool_ready,
    :snapshot_connection_pool_ready,
    :shape_log_collector_ready,
    :supervisor_processes_ready,
    :integrety_checks_passed,
    :shape_metadata_ready
  ]

  @default_results for condition <- @conditions, into: %{}, do: {condition, {false, %{}}}

  @db_state_key :db_state
  @spin_prevention_delay 10

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    GenServer.start_link(__MODULE__, stack_id, name: name(stack_id))
  end

  def init(stack_id) do
    Process.set_label({:status_monitor, stack_id})
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    :ets.new(ets_table(stack_id), [:named_table, :protected])

    {:ok, %{stack_id: stack_id, waiters: MapSet.new()}}
  end

  @doc """
  Returns the high-level service status as a single atom.

  - `:active` — fully operational
  - `:waiting` — waiting on advisory lock, shape metadata loaded (can serve existing shapes read-only)
  - `:starting` — system is initializing (metadata not yet loaded or connection progressing)
  - `:sleeping` — connections scaled down
  """
  @spec service_status(String.t()) :: :active | :waiting | :starting | :sleeping
  def service_status(stack_id) do
    case status(stack_id) do
      %{conn: :up, shape: :up} -> :active
      %{conn: :waiting_on_lock, shape: :read_only} -> :waiting
      %{conn: :sleeping} -> :sleeping
      _ -> :starting
    end
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
         snapshot_connection_pool_ready: {true, _},
         integrety_checks_passed: {true, _}
       }),
       do: :up

  defp conn_status_from_results(_), do: :starting

  defp shape_status_from_results(%{
         shape_metadata_ready: {true, _},
         shape_log_collector_ready: {true, _},
         supervisor_processes_ready: {true, _}
       }),
       do: :up

  defp shape_status_from_results(%{shape_metadata_ready: {true, _}}), do: :read_only

  defp shape_status_from_results(_), do: :starting

  def database_connections_going_to_sleep(stack_id) do
    GenServer.cast(name(stack_id), :database_connections_going_to_sleep)
  end

  def database_connections_waking_up(stack_id) do
    GenServer.cast(name(stack_id), :database_connections_waking_up)
  end

  def mark_shape_metadata_ready(stack_id, pid) do
    mark_condition_met(stack_id, :shape_metadata_ready, pid)
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

  def mark_integrety_checks_passed(stack_id, connection_manager_pid) do
    mark_condition_met(stack_id, :integrety_checks_passed, connection_manager_pid)
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

  @doc """
  Wait until the system reaches at least the required level.

  Levels (ordered):
  - `:read_only` — can serve existing shapes (waiting on lock, metadata loaded)
  - `:active` — fully operational, can create shapes and stream changes

  Returns:
  - `{:ok, :active}` when fully operational
  - `{:ok, :read_only}` when existing shapes can be served (only for `:read_only` level)
  - `:conn_sleeping` when connections are sleeping
  - `{:error, message}` on timeout
  """
  def wait_until(stack_id, level, opts \\ [])
      when level in [:read_only, :active] do
    case service_status(stack_id) do
      :active ->
        {:ok, :active}

      :waiting when level == :read_only ->
        {:ok, :read_only}

      :sleeping ->
        if Keyword.get(opts, :block_on_conn_sleeping, false) do
          do_wait_until(stack_id, level, opts)
        else
          :conn_sleeping
        end

      _ ->
        do_wait_until(stack_id, level, opts)
    end
  end

  defp do_wait_until(stack_id, level, opts) do
    timeout = Keyword.fetch!(opts, :timeout)

    try do
      case stack_id |> name() |> GenServer.whereis() do
        nil ->
          maybe_retry_wait_until(
            stack_id,
            level,
            opts,
            timeout,
            "Status monitor not found for stack ID: #{stack_id}"
          )

        pid when is_pid(pid) ->
          GenServer.call(pid, {:wait_until, level, timeout}, :infinity)
      end
    rescue
      ArgumentError ->
        maybe_retry_wait_until(
          stack_id,
          level,
          opts,
          timeout,
          "Stack ID not recognised: #{stack_id}"
        )
    catch
      :exit, _reason ->
        maybe_retry_wait_until(
          stack_id,
          level,
          opts,
          timeout,
          "Stack #{inspect(stack_id)} has terminated"
        )
    end
  end

  defp maybe_retry_wait_until(_stack_id, _level, _opts, timeout, last_error)
       when timeout <= @spin_prevention_delay do
    {:error, last_error}
  end

  defp maybe_retry_wait_until(stack_id, level, opts, timeout, _) do
    Process.sleep(@spin_prevention_delay)

    remaining_timeout =
      case timeout do
        :infinity -> :infinity
        _ -> timeout - @spin_prevention_delay
      end

    wait_until(stack_id, level, Keyword.put(opts, :timeout, remaining_timeout))
  end

  @doc "Convenience wrapper: wait until fully active. Returns `:ok` on success."
  def wait_until_active(stack_id, opts \\ []) do
    case wait_until(stack_id, :active, opts) do
      {:ok, :active} -> :ok
      other -> other
    end
  end

  @doc """
  Non-blocking version of `wait_until/3`.

  Subscribes to status updates from StatusMonitor. Returns a reference.
  The caller will receive `{ref, {:ok, level}}` when the status reaches
  the requested level (`:active` or `:read_only`).

  Uses the existing `{:wait_until, level, :infinity}` handler internally,
  so no timeout is applied — the caller manages its own lifecycle.
  """
  @spec wait_until_async(String.t(), :read_only | :active) :: reference()
  def wait_until_async(stack_id, level) when level in [:read_only, :active] do
    pid = stack_id |> name() |> GenServer.whereis()
    ref = make_ref()

    # Use {__MODULE__, ref} as the reply tag so the notification message is
    # {{Electric.StatusMonitor, ref}, {:ok, level}} — easily distinguishable
    # from other GenServer replies in the caller's mailbox.
    send(pid, {:"$gen_call", {self(), {__MODULE__, ref}}, {:wait_until, level, :infinity}})

    ref
  end

  # Only used in tests
  def wait_for_messages_to_be_processed(stack_id) do
    GenServer.call(name(stack_id), :wait_for_messages_to_be_processed)
  end

  def handle_cast({:condition_met, condition, process}, state)
      when condition in @conditions do
    Process.monitor(process, tag: {:down, condition})
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

  def handle_call({:wait_until, level, timeout}, from, %{waiters: waiters} = state) do
    case check_level(level, state.stack_id) do
      {:ok, _} = reply ->
        {:reply, reply, state}

      :not_ready ->
        if timeout != :infinity do
          Process.send_after(self(), {:timeout_waiter, {from, level}}, timeout)
        end

        {:noreply, %{state | waiters: MapSet.put(waiters, {from, level})}}
    end
  end

  def handle_call(:wait_for_messages_to_be_processed, _from, state) do
    {:reply, :ok, state}
  end

  defp check_level(level, stack_id) do
    case service_status(stack_id) do
      :active -> {:ok, :active}
      :waiting when level == :read_only -> {:ok, :read_only}
      _ -> :not_ready
    end
  end

  def handle_info({{:down, condition}, _ref, :process, pid, _reason}, state) do
    :ets.match_delete(ets_table(state.stack_id), {:_, {true, %{process: pid}}})

    Logger.warning(
      "#{inspect(__MODULE__)} condition failed: #{inspect(condition)}. Status #{inspect(status(state.stack_id))}"
    )

    {:noreply, state}
  end

  def handle_info({:timeout_waiter, {from, _level} = waiter}, state) do
    if MapSet.member?(state.waiters, waiter) do
      GenServer.reply(from, {:error, timeout_message(state.stack_id)})
      {:noreply, %{state | waiters: MapSet.delete(state.waiters, waiter)}}
    else
      {:noreply, state}
    end
  end

  defp maybe_reply_to_waiters(%{waiters: waiters} = state)
       when map_size(waiters) == 0,
       do: state

  defp maybe_reply_to_waiters(state) do
    waiters =
      Enum.reduce(state.waiters, state.waiters, fn {from, level} = waiter, acc ->
        case check_level(level, state.stack_id) do
          {:ok, _} = reply ->
            GenServer.reply(from, reply)
            MapSet.delete(acc, waiter)

          :not_ready ->
            acc
        end
      end)

    %{state | waiters: waiters}
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

  def timeout_message(stack_id) do
    case stack_id |> ets_table() |> results() do
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

      %{shape_metadata_ready: {false, details}} ->
        "Timeout waiting for shape metadata to be loaded" <> format_details(details)

      %{shape_log_collector_ready: {false, details}} ->
        "Timeout waiting for shape data to be loaded" <> format_details(details)

      %{supervisor_processes_ready: {false, details}} ->
        "Timeout waiting for stack restart" <> format_details(details)

      %{integrety_checks_passed: {false, details}} ->
        "Timeout waiting for integrety checks" <> format_details(details)
    end
  end

  defp format_details(%{error: error}), do: ": #{error}"
  defp format_details(_), do: ""

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  defp ets_table(stack_id), do: :"#{inspect(__MODULE__)}:#{stack_id}"
end
