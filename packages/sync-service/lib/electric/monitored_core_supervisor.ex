defmodule Electric.MonitoredCoreSupervisor do
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

    Supervisor.init(children, strategy: :rest_for_one, auto_shutdown: :any_significant)
  end
end
