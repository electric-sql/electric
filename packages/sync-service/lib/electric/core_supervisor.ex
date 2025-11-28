defmodule Electric.CoreSupervisor do
  @moduledoc """
  A supervisor that starts the core components of the Electric system.
  This is divided into two subsystems:
  1. The connection subsystem (processes that may exit on a connection failure), started with Connection.Supervisor
  2. The shape subsystem (processes that are resilient to connection failures), started with Shapes.Supervisor
  """

  use Supervisor, restart: :transient, significant: true

  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
  end

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: name(opts))
  end

  @impl true
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    Process.set_label({:core_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    connection_manager_opts = Keyword.fetch!(opts, :connection_manager_opts)

    children = [
      {Electric.Connection.Supervisor, connection_manager_opts},
      {Electric.Shapes.Supervisor, opts} |> Supervisor.child_spec(restart: :transient)
    ]

    Supervisor.init(children, strategy: :one_for_one, auto_shutdown: :any_significant)
  end

  @doc """
  This function is supposed to be called from Connection.Manager at the right point in its
  initialization sequence.
  """
  def start_shapes_supervisor(opts) do
    Supervisor.restart_child(name(opts), Electric.Shapes.Supervisor)
  end

  @doc """
  Stops the Shapes.Supervisor if it's currently running.

  This is useful when you need to reset storage before starting a new supervisor.
  Returns :ok if the supervisor was stopped or wasn't running.
  """
  def stop_shapes_supervisor(opts) do
    Supervisor.terminate_child(name(opts), Electric.Shapes.Supervisor)
  end
end
