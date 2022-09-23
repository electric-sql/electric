defmodule Electric.Plug.Status do
  alias Electric.Replication.PostgresConnector
  alias Electric.Replication.PostgresConnectorMng

  use Plug.Router
  import Plug.Conn

  plug(:match)
  plug(:dispatch)

  get "/" do
    origins =
      PostgresConnector.connectors()
      |> Enum.map(fn origin ->
        case PostgresConnectorMng.status(origin) do
          :ready -> {origin, true}
          :migration -> {origin, :migration}
          _ -> {origin, false}
        end
      end)

    vaxine = vaxine_ready?()

    data = %{
      vaxine: vaxine,
      connectors: Map.new(origins)
    }

    send_resp(conn, 200, Jason.encode!(data))
  end

  match _ do
    send_resp(conn, 404, "Not found")
  end

  defp vaxine_ready?() do
    try do
      Electric.VaxRepo.checkout(fn -> true end, timeout: 100)
    rescue
      _ -> false
    end
  end
end
