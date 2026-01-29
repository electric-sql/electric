defmodule Electric.Replication.ShapeLogCollector.Supervisor do
  @moduledoc """
  Supervisor for the ShapeLogCollector components.

  Setting `max_restarts` to 0 as the supervisor only acts as
  a coordinator for starting and normal shutdowns, to preserve
  the ShapeLogCollector's death side effects in its supervision
  tree as before.
  """
  use Supervisor

  alias Electric.Replication.ShapeLogCollector

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
      {ShapeLogCollector, opts},
      {ShapeLogCollector.RequestBatcher, stack_id: stack_id}
    ]

    # TEMPORARY DEBUG: Insert sentinels between each child
    children = Electric.Debug.ShutdownTimer.insert_sentinels(children, "ShapeLogCollector.Supervisor")

    # Prevent any restarts until the whole system is capable of sustaining
    # the SLC dying without any other shape machinery being restarted
    Supervisor.init(children, strategy: :one_for_all, max_restarts: 0)
  end
end
