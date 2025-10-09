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
    children = [
      {Electric.StatusMonitor, opts.stack_id},
      {Electric.CoreSupervisor, opts}
    ]

    # The :rest_for_one strategy is used here to ensure that if the StatusMonitor unexpectedly dies,
    # all the processes it is monitoring are also restarted. Since the StatusMonitor keeps track of the
    # statuses of the other processes, losing it means losing that state. Restarting the other children
    # ensures they re-notify the StatusMonitor, allowing it to rebuild its internal state correctly.
    Supervisor.init(children, strategy: :rest_for_one, auto_shutdown: :any_significant)
  end
end
