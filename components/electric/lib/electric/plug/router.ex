defmodule Electric.Plug.Router do
  use Plug.Router, init_mode: :runtime
  import Plug.Conn
  require Logger

  plug(:match)
  plug(:dispatch)

  forward("/api/migrations", to: Electric.Plug.Migrations)
  forward("/api/status", to: Electric.Plug.Status)

  match "/ws" do
    Electric.Plug.SatelliteWebsocketPlug.call(conn, Electric.Plug.SatelliteWebsocketPlug.init([]))
  end

  match _ do
    send_resp(conn, 404, "Not found")
  end
end
