defmodule Electric.ServiceStatus do
  @type status() :: :waiting | :starting | :active | :stopping

  @spec check() :: status()
  def check() do
    # Match the connection status ot a service status - currently
    # they are one and the same but keeping this decoupled for future
    # additions to conditions that determine service status
    case Electric.Connection.Manager.get_status(Electric.Connection.Manager) do
      :waiting -> :waiting
      :starting -> :starting
      :active -> :active
    end
  end
end
