defmodule Electric.Connection.Supervisor do
  @moduledoc """
  The main connection supervisor that looks after Connection.Manager and Replication.Supervisor.

  It actually starts Connection.Manager.Supervisor and this latter then directly supervises
  Connection.Manager and Replication.Supervisor processes. This is done with the goal of tying
  the lifetimes of those two together (by configuring Connection.Manager.Supervisor
  appropriately) while still being able to configure this Connection.Supervisor with the
  rest_for_all strategy as explained further down in the code.

  Connection.Manager acts a bit like a supervisor for database connection processes:

    - it opens database connections in the right order
    - restarts them during initialization of they fail for recoverable reasons
    - restarts the replication client at any point if it crashes due to a non-fatal error
    - starts the Replication.Supervisor at the right point in time, passing it the right set of
      options that have been informed by connection manager's own initialization sequence up to
      that point

  If a database connection shuts down due to a non-recoverable error, the connection manager
  process will ask this supervisor to shut down, which in the single-tenant mode results in the
  whole OTP application shutting down.
  """

  # This supervisor is meant to be a child of Electric.StackSupervisor.
  #
  # The `restart: :transient, significant: true` combo allows for shutting the supervisor down
  # and signalling the parent supervisor to shut itself down as well if that one has
  # `:auto_shutdown` set to `:any_significant` or `:all_significant`.
  use Supervisor, restart: :transient, significant: true

  require Logger

  def name(opts) do
    Electric.ProcessRegistry.name(opts[:stack_id], __MODULE__)
  end

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: name(opts))
  end

  def shutdown(stack_id, %Electric.DbConnectionError{} = reason) do
    if Application.get_env(:electric, :start_in_library_mode, true) do
      # Log a warning as these errors are to be expected if the stack has been
      # misconfigured or if the database is not available.
      Logger.warning(
        "Stopping connection supervisor with stack_id=#{inspect(stack_id)} " <>
          "due to an unrecoverable error: #{reason.message}"
      )
    else
      # Log an emergency error in the standalone mode, as the application cannot procede and will be shut down.
      Logger.emergency(reason.message)
    end

    Supervisor.stop(name(stack_id: stack_id), {:shutdown, reason}, 1_000)
  end

  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    Process.set_label({:connection_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    children = [
      {Electric.StatusMonitor, stack_id: stack_id},
      {Electric.Connection.Restarter,
       stack_id: stack_id, stack_events_registry: Keyword.fetch!(opts, :stack_events_registry)},
      {Electric.Connection.Manager.Supervisor, opts}
    ]

    # The :rest_for_one strategy is used here to ensure that if the StatusMonitor unexpectedly dies,
    # all subsequent child processes are also restarted. Since the StatusMonitor keeps track of the
    # statuses of the other children, losing it means losing that state. Restarting the other children
    # ensures they re-notify the StatusMonitor, allowing it to rebuild its internal state correctly.
    Supervisor.init(children, strategy: :rest_for_one)
  end
end
