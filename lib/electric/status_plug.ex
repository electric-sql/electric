defmodule Electric.StatusPlug do
  use Plug.Router
  require Logger

  plug(:match)
  plug(:dispatch)

  defp vaxine_ready?() do
    try do
      Electric.VaxRepo.checkout(fn -> true end, timeout: 100)
    rescue
      _ -> false
    end
  end

  get "/status" do
    connectors = Electric.Replication.Connectors.status()
    vaxine = vaxine_ready?()

    Logger.debug("get /status #{inspect(connectors)}")

    data = %{
      vaxine: vaxine,
      connectors:
        Map.new(connectors, fn
          {key, :ready} -> {key, true}
          {key, {:not_ready, reason}} -> {key, [false, inspect(reason)]}
        end)
    }

    send_resp(conn, 200, Jason.encode!(data))
  end

  match _ do
    send_resp(conn, 404, "Not found")
  end
end
