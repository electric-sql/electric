defmodule Electric.Connection.Restarter do
  @moduledoc """
  Gen server responsible for shutting down and restarting the connection subsystem.

  It makes sure to update StatusMonitor with the current subsystem state to maintain correct
  behaviour of other components of the system that depend on the database availability, such
  as:

    - HTTP API server processing shape requests
    - publication manager
    - schema reconciler

  Once the connection subsystem is scaled down, Restarter starts a timer to check the retained
  WAL size periodically. If the size exceeds the configured threshold, Restart will restart the
  connection subsystem. Both the period and the size threshold are passed to `start_link/1`.

  """

  use GenServer

  alias Electric.StatusMonitor

  def name(stack_id) when is_binary(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def name(opts), do: name(opts[:stack_id])

  @doc """
  Stop the connection subsystem, closing all database connections.

  This lets the database server scale its compute to zero if it supports this feature and has
  no other sessions.

  Inside Electric, the shape subsystem keeps running.

  ## Implementation notes

  Currently, this function stops only the Connection.Manager process which shuts down all types
  of database connections linked to it. When a new shape request arrives, it will immediately
  stop the Replication.Supervisor and restart the Connection.Manager, which then in turn starts
  a fresh Replication.Supervisor again.
  """
  def stop_connection_subsystem(stack_id) do
    GenServer.cast(name(stack_id), :stop_connection_subsystem)
  end

  @doc """
  Restore the connection subsystem after it had been stopped by `stop_connection_subsystem/1`.

  The "restart" in the name is related to the fact that the Replication.Supervisor is stopped
  first before getting restarted by the Connection.Manager later. The Connection.Manager itself
  is started via a `Supervisor.restart_child()` call.
  """
  def restart_connection_subsystem(stack_id) do
    with %{conn: :sleeping} <- StatusMonitor.status(stack_id) do
      GenServer.cast(name(stack_id), :restart_connection_subsystem)
    end

    :ok
  end

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: name(opts))
  end

  def init(opts) do
    # wait_until_conn_up_ref is used as an exclusion mechanism when the database connections are
    # sleeping: multiple concurrent shape requests will trigger the restart of the
    # connection subsystem once because they will all be serialized through this Restarter
    # process.
    {:ok,
     %{
       stack_id: Keyword.fetch!(opts, :stack_id),
       stack_events_registry: Keyword.fetch!(opts, :stack_events_registry),
       wal_size_check_period: Keyword.get(opts, :wal_size_check_period, 0),
       wal_size_threshold: Keyword.get(opts, :wal_size_threshold, 1),
       wait_until_conn_up_ref: nil,
       wal_size_check_timer: nil
     }}
  end

  def handle_cast(:stop_connection_subsystem, %{stack_id: stack_id} = state) do
    StatusMonitor.database_connections_going_to_sleep(stack_id)
    Electric.Connection.Manager.Supervisor.stop_connection_manager(stack_id: stack_id)

    Electric.StackSupervisor.dispatch_stack_event(
      state.stack_events_registry,
      stack_id,
      :scaled_down_database_connections
    )

    state = schedule_wal_size_check(state)

    {:noreply, state}
  end

  def handle_cast(:restart_connection_subsystem, %{wait_until_conn_up_ref: nil} = state) do
    %{stack_id: stack_id} = state

    StatusMonitor.database_connections_waking_up(stack_id)
    Electric.Connection.Manager.Supervisor.restart(stack_id: stack_id)

    ref = StatusMonitor.wait_until_conn_up_async(stack_id)

    if timer = state.wal_size_check_timer, do: Process.cancel_timer(timer)

    {:noreply, %{state | wait_until_conn_up_ref: ref, wal_size_check_timer: nil}}
  end

  def handle_cast(:restart_connection_subsystem, state) do
    # Ignore the restart request since we're already waiting on the connection subsystem to
    # start.
    {:noreply, state}
  end

  def handle_info({ref, :ok}, %{wait_until_conn_up_ref: ref} = state) do
    {:noreply, %{state | wait_until_conn_up_ref: nil}}
  end

  # The timer has already been cancelled and reset, ignore this message.
  def handle_info(:check_wal_size, %{wal_size_check_timer: nil} = state) do
    {:noreply, state}
  end

  def handle_info(:check_wal_size, state) do
    state = %{state | wal_size_check_timer: nil}

    wal_size = query_retained_wal_size(state)

    state =
      if wal_size >= state.wal_size_threshold do
        :ok = restart_connection_subsystem(state.stack_id)
        state
      else
        schedule_wal_size_check(state)
      end

    {:noreply, state}
  end

  defp schedule_wal_size_check(
         %{wal_size_check_timer: nil, wal_size_check_period: period} = state
       )
       when is_integer(period) and period > 0 do
    timer = Process.send_after(self(), :check_wal_size, period)
    %{state | wal_size_check_timer: timer}
  end

  defp schedule_wal_size_check(state), do: state

  defp query_retained_wal_size(_state) do
    # FIXME: placeholder
    0
  end
end
