defmodule Electric.Plug.Router do
  use Plug.Router
  import Plug.Conn
  require Logger

  plug(:match)
  plug(:dispatch)

  forward("/api/migrations", to: Electric.Plug.Migrations)
  forward("/api/status", to: Electric.Plug.Status)

  match _ do
    send_resp(conn, 404, "Not found")
  end
end
