defmodule Electric.LiveDashboard.Endpoint do
  @moduledoc """
  Phoenix Endpoint for serving LiveDashboard on a separate port.
  This runs independently from the main Plug-based HTTP server.

  **WARNING: This endpoint is completely unauthenticated.** It exposes internal
  system state (VM metrics, process info, etc.). In production, ensure the
  dashboard port is not publicly accessible — use firewall rules or network
  policies to restrict access.
  """

  use Phoenix.Endpoint, otp_app: :electric

  # LiveView socket for dashboard interactions
  socket "/live", Phoenix.LiveView.Socket,
    websocket: true,
    longpoll: true

  # Serve static assets for LiveDashboard
  plug Plug.Static,
    at: "/",
    from: :phoenix_live_dashboard,
    gzip: false,
    only: ~w(assets fonts images priv)

  # Session configuration for LiveView
  plug Plug.Session,
    store: :cookie,
    key: "_live_dashboard_key",
    signing_salt: "abc43s8Z",
    same_site: "Lax"

  # Parse request body for LiveView
  plug Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Jason

  plug Plug.MethodOverride
  plug Plug.Head

  # Route all requests to the LiveDashboard router
  plug Electric.LiveDashboard.Router
end
