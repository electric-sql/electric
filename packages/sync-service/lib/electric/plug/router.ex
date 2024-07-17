defmodule Electric.Plug.Router do
  use Plug.Router, copy_opts_to_assign: :config

  plug Plug.RequestId
  plug :match
  plug Plug.Telemetry, event_prefix: [:electric, :routing]
  plug Plug.Logger
  plug Plug.RequestId
  plug :dispatch

  match "/", via: [:get, :head], do: send_resp(conn, 200, "")

  get "/shape/:root_table", to: Electric.Plug.ServeShapePlug
  delete "/shape/:root_table", to: Electric.Plug.DeleteShapePlug

  match _ do
    send_resp(conn, 404, "Not found")
  end
end
