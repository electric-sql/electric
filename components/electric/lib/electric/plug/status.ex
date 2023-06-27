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

    data = %{
      connectors: Map.new(origins)
    }

    send_resp(conn, 200, Jason.encode!(data))
  end

  match _ do
    send_resp(conn, 404, "Not found")
  end
end
