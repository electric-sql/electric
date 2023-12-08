defmodule Electric.Plug.Router do
  use Plug.Router

  plug :match
  plug Plug.Logger
  plug :dispatch

  forward "/api/migrations", to: Electric.Plug.Migrations
  forward "/api/status", to: Electric.Plug.Status
  forward "/ws", to: Electric.Plug.SatelliteWebsocketPlug

  match _ do
    send_resp(conn, 404, "Not found")
  end
end
