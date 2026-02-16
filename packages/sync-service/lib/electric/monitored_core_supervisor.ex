defmodule Electric.MonitoredCoreSupervisor do
  @moduledoc """
  A supervisor that starts and monitors the core components of the Electric system.
  It needs to be a separate supervisor from the CoreSupervisor because of the way
  the StatusMonitor works (see the rest_for_one comments below).
  """

  use Supervisor, restart: :transient, significant: true

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts)
  end

  @impl true
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    tweaks = get_in(opts, [:connection_manager_opts, :tweaks]) || []

    Process.set_label({:monitored_core_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    children = [
      {Electric.StatusMonitor, stack_id: stack_id},
      {Electric.ShapeCache.ShapeCleaner.CleanupTaskSupervisor,
       [stack_id: stack_id] ++ Keyword.get(tweaks, :shape_cleaner_opts, [])},
      {Electric.ShapeCache.ShapeStatus.ShapeDb.Supervisor,
       Keyword.take(opts, [:stack_id, :shape_db_opts])},
      {Electric.ShapeCache.ShapeStatusOwner, [stack_id: stack_id]},
      {Electric.CoreSupervisor, opts}
    ]

    # The :rest_for_one strategy is used here to ensure that if the StatusMonitor unexpectedly dies,
    # all the processes it is monitoring are also restarted. Since the StatusMonitor keeps track of the
    # statuses of the other processes, losing it means losing that state. Restarting the other children
    # ensures they re-notify the StatusMonitor, allowing it to rebuild its internal state correctly.
    Supervisor.init(children, strategy: :rest_for_one, auto_shutdown: :any_significant)
  end
end
