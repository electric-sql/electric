defmodule TodoPhoenixWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :todo_phoenix

  # The session will be stored in the cookie and signed,
  # this means its contents can be read but not tampered with.
  # Set :encryption_salt if you would also like to encrypt it.
  @session_options [
    store: :cookie,
    key: "_todo_phoenix_key",
    signing_salt: "qX2SzBMG",
    same_site: "Lax"
  ]

  # Serve at "/" the static files from "priv/static" directory.
  #
  # You should set gzip to true if you are running phx.digest
  # when deploying your static files in production.
  plug Plug.Static,
    at: "/",
    from: :todo_phoenix,
    gzip: false,
    only: TodoPhoenixWeb.static_paths()

  # Code reloading can be explicitly enabled under the
  # :code_reloader configuration of your endpoint.
  if code_reloading? do
    plug Phoenix.CodeReloader
    plug Phoenix.Ecto.CheckRepoStatus, otp_app: :todo_phoenix
  end

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]

  plug Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Jason

  plug Plug.MethodOverride
  plug Plug.Head
  plug Plug.Session, @session_options

  # CORS configuration for development mode (frontend on :5173, backend on :4000)
  plug :add_cors_headers

  plug TodoPhoenixWeb.Router

  # Add CORS headers to support both development and production modes
  defp add_cors_headers(conn, _opts) do
    conn
    |> put_resp_header("access-control-allow-origin", "*")
    |> put_resp_header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
    |> put_resp_header("access-control-allow-headers", "content-type, authorization, x-requested-with")
    |> put_resp_header("access-control-expose-headers", "electric-offset, electric-handle, electric-schema, electric-cursor")
    |> put_resp_header("access-control-max-age", "3600")
  end
end
