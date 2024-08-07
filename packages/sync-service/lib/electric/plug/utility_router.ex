defmodule Electric.Plug.UtilityRouter do
  use Plug.Router

  plug :match
  plug :dispatch

  get "/metrics", do: resp(conn, 200, TelemetryMetricsPrometheus.Core.scrape())
end
