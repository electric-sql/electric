defmodule Electric.Plug.Status do
  alias Electric.Replication.PostgresConnector
  alias Electric.Replication.PostgresConnectorMng

  use Plug.Router
  import Plug.Conn

  plug :match
  plug :dispatch

  get "/" do
    [origin] = PostgresConnector.connectors()

    if :ready == PostgresConnectorMng.status(origin) do
      send_resp(conn, 200, "Connection to Postgres is up!")
    else
      send_resp(conn, 503, "Initializing connection to Postgres...")
    end
  end

  match _ do
    send_resp(conn, 404, "Not found")
  end
end
