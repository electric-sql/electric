defmodule Electric.Plug.Status do
  alias Electric.Replication.PostgresConnector
  alias Electric.Replication.PostgresConnectorMng

  use Plug.Router
  import Plug.Conn

  plug :match
  plug :dispatch

  get "/" do
    [origin] = PostgresConnector.connectors()

    msg =
      if :ready == PostgresConnectorMng.status(origin) do
        "Connection to Postgres is up!"
      else
        "Initializing connection to Postgres..."
      end

    send_resp(conn, 200, msg)
  end

  match _ do
    send_resp(conn, 404, "Not found")
  end
end
