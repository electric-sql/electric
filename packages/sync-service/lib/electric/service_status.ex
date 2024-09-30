defmodule Electric.ServiceStatus do
  @type status() :: :starting | :ready | :active | :stopping

  @type option ::
          {:get_connection_status, (-> Electric.ConnectionManager.status())}

  @type options :: [option]

  @spec check(options()) :: status()
  def check(opts) do
    with connection_status <- opts.get_connection_status.() do
      case connection_status do
        :waiting -> :waiting
        :starting -> :starting
        :active -> :active
      end
    end
  end
end
