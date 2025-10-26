defmodule Electric.Connection.Manager.Supervisor do
  @moduledoc """
  Intermediate supervisor that supervises the Connection.Manager and ConnectionResolver processes.
  """

  use Supervisor

  def name(opts) do
    Electric.ProcessRegistry.name(opts[:stack_id], __MODULE__)
  end

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: name(opts))
  end

  def init(opts) do
    Process.set_label({:connection_manager_supervisor, opts[:stack_id]})
    Logger.metadata(stack_id: opts[:stack_id])
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts[:stack_id])

    children = [
      {Electric.Connection.Manager, opts},
      {Electric.Connection.Manager.ConnectionResolver, stack_id: opts[:stack_id]}
    ]

    # Electric.Connection.Manager is a permanent child of the supervisor, so when it dies, the
    # :one_for_all strategy will kick in and restart the other children.
    Supervisor.init(children, strategy: :one_for_all)
  end

  # Stopping the Connection.Manager causes all database connections to close, letting the
  # database server scale itself down to zero if it supports that.
  #
  # The replication supervisor keeps running.
  def stop_connection_manager(opts) do
    Supervisor.terminate_child(name(opts), Electric.Connection.Manager)
  end

  # Stopping the Connection.Manager.Supervisor causes the Connection.Supervisor to restart it
  # from a clean state. The end result is the Connection.Manager is back up and the
  # Replication.Supervisor has the opportunity to purge shapes if the need for this is
  # communicated by Connection.Manager.
  def restart(opts) do
    Supervisor.stop(name(opts))
  end
end
