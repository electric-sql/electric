defmodule Electric.Replication.ShapeLogCollector.Supervisor do
  @moduledoc """
  Supervisor for the ShapeLogCollector components.

  Using one_for_all to ensure no de/registration messages are lost
  in case of a Registrator crash.

  """
  use Supervisor

  alias Electric.Replication.ShapeLogCollector.Processor
  alias Electric.Replication.ShapeLogCollector.Registrator

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: name(opts[:stack_id]))
  end

  def init(opts) do
    stack_id = Access.fetch!(opts, :stack_id)
    Process.set_label({:shape_log_collector_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    children = [
      {Processor, opts},
      {Registrator, stack_id: stack_id}
    ]

    Supervisor.init(children, strategy: :one_for_all)
  end
end
