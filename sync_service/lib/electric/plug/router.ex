defmodule Electric.Plug.Router do
  use Plug.Router

  plug :match
  plug Plug.Logger
  plug Plug.RequestId
  plug :dispatch

  forward "/shape", to: Electric.Plug.Shapes

  match _ do
    send_resp(conn, 404, "Not found")
  end
end
