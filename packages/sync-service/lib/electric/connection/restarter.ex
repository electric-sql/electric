defmodule Electric.Connection.Restarter do
  @moduledoc """
  Gen server responsible for shutting down and restarting the connection subsystem.

  It makes sure to update StatusMonitor with the current subsystem state to maintain correct
  behaviour of other components of the system that depend on the database availability, such
  as:

    - HTTP API server processing shape requests
    - publication manager
    - schema reconciler

  """

  use GenServer

  alias Electric.StatusMonitor

  def name(stack_id) when is_binary(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def name(opts), do: name(opts[:stack_id])

  def stop_connection_subsystem(stack_id) do
    GenServer.cast(name(stack_id), :stop_connection_subsystem)
  end

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
    stack_id = Keyword.fetch!(opts, :stack_id)

    # pending_db_state is used as an exclusion mechanism when the database connections are
    # sleeping: multiple concurrent shape requests will only trigger DB connection wakeup once
    # because they will all be serialized through this Restarter process.
    {:ok, %{stack_id: stack_id, pending_db_state: nil, status_monitor_ref: nil}}
  end

  def handle_cast(:stop_connection_subsystem, state) do
    StatusMonitor.database_connections_going_to_sleep(state.stack_id)
    Electric.Connection.Manager.Supervisor.stop_connection_manager(stack_id: state.stack_id)
    {:noreply, state}
  end

  def handle_cast(:restart_connection_subsystem, %{pending_db_state: nil} = state) do
    StatusMonitor.database_connections_waking_up(state.stack_id)
    Electric.Connection.Manager.Supervisor.restart(stack_id: state.stack_id)

    ref = StatusMonitor.wait_until_conn_up_async(state.stack_id)

    {:noreply, %{state | pending_db_state: :up, status_monitor_ref: ref}}
  end

  def handle_cast(:restart_connection_subsystem, %{pending_db_state: :up} = state) do
    # Ignore the restart request since we're already waiting on the connection manager to
    # start.
    {:noreply, state}
  end

  def handle_info({ref, :ok}, %{status_monitor_ref: ref} = state) do
    # Reset the pending DB state. Restarter is now ready for the next scale-down/wake-up cycle.
    {:noreply, %{state | pending_db_state: nil, status_monitor_ref: nil}}
  end
end
