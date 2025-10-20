defmodule Electric.CoreSupervisor do
  @moduledoc """
  A supervisor that starts the core components of the Electric system.
  This is divided into two subsystems:
  1. The connection subsystem (processes that may exit on a connection failure), started with Connection.Manager.Supervisor
  2. The shape subsystem (processes that are resilient to connection failures), started with Electric.Replication.Supervisor

  NOTE: Currently the ShapeSubsystem is not directly supervised here, but this change with happen in an upcoming PR.
  """

  use Supervisor, restart: :transient, significant: true

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts)
  end

  @impl true
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    Process.set_label({:core_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    connection_manager_opts = Keyword.fetch!(opts, :connection_manager_opts)

    children = [
      {Electric.Connection.Supervisor, connection_manager_opts}
    ]

    Supervisor.init(children, strategy: :one_for_one, auto_shutdown: :any_significant)
  end
end
