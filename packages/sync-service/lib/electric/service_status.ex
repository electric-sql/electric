defmodule Electric.ServiceStatus do
  @type status() :: :waiting | :starting | :active | :stopping

  @type option ::
          {:get_connection_status, (-> Electric.ConnectionManager.status())}

  @type options :: [option]

  @spec check(options()) :: status()
  def check(opts) do
    with connection_status <- opts.get_connection_status.() do
      # Match the connection status ot a service status - currently
      # they are one and the same but keeping this decoupled for future
      # additions to conditions that determine service status
      case connection_status do
        :waiting -> :waiting
        :starting -> :starting
        :active -> :active
      end
    end
  end
end
