defmodule Electric.StatusPlug do
  use Plug.Router

  plug(:match)
  plug(:dispatch)

  defp vaxine_ready? do
    case Registry.lookup(Electric.StatusRegistry, {:connection, :vaxine_downstream}) do
      [{_pid, ready?}] -> ready?
      [] -> false
    end
  end

  get "/status" do
    connectors = Electric.Replication.Connectors.status()
    vaxine = vaxine_ready?()

    data = %{
      vaxine: vaxine,
      connectors:
        Map.new(connectors, fn
          {key, :ready} -> {key, true}
          {key, {:not_ready, reason}} -> {key, [false, inspect(reason)]}
        end)
    }

    if vaxine do
      send_resp(conn, 200, Jason.encode!(data))
    else
      send_resp(conn, 500, Jason.encode!(data))
    end
  end

  match _ do
    send_resp(conn, 404, "Not found")
  end
end
