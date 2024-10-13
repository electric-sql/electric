defmodule Electric.ServiceStatus do
  @type status() :: :waiting | :starting | :active | :stopping

  @spec check() :: status()
  def check() do
    # Match the connection status ot a service status - currently
    # they are one and the same but keeping this decoupled for future
    # additions to conditions that determine service status
    case Electric.ConnectionManager.get_status(Electric.ConnectionManager) do
      :waiting -> :waiting
      :starting -> :starting
      :active -> :active
    end
  end
end
