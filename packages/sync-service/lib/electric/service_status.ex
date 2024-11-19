defmodule Electric.ServiceStatus do
  @type status() :: :waiting | :starting | :active | :stopping

  @spec check(atom | String.t()) :: status()
  def check(stack_id) do
    # Match the connection status ot a service status - currently
    # they are one and the same but keeping this decoupled for future
    # additions to conditions that determine service status
    conn_mgr = Electric.Connection.Manager.name(stack_id)

    case Electric.Connection.Manager.get_status(conn_mgr) do
      :waiting -> :waiting
      :starting -> :starting
      :active -> :active
    end
  end
end
