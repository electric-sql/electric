defmodule Electric.Connection.Manager.Supervisor do
  @moduledoc """
  Intermediate supervisor that helps tie Connection.Manager's lifetime to that of Replication.Supervisor.
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
    # This is not the case for Electric.Replication.Supervisor which needs to be a temporary
    # child such that Electric.Connection.Manager decides when it starts. Because of this, when
    # Electric.Replication.Supervisor dies, even due to an error, it doesn't activate the
    # :one_for_all strategy.
    # We work around this by marking Electric.Replication.Supervisor as significant and
    # configuring this supervisor with [auto_shutdown: :any_significant].
    Supervisor.init(children, strategy: :one_for_all, auto_shutdown: :any_significant)
  end
end
