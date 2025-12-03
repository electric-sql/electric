defmodule Electric.Replication.ShapeLogCollector.Supervisor do
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

    Supervisor.init(children, strategy: :rest_for_one)
  end

  defdelegate subscribe(server_ref, shape_handle, shape, operation), to: Registrator
  defdelegate remove_shape(server_ref, shape_handle), to: Registrator
end
