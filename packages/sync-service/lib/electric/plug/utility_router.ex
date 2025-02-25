defmodule Electric.Plug.UtilityRouter do
  use Plug.Router

  plug :match
  plug :dispatch

  if Electric.telemetry_enabled?() do
    get "/metrics", do: resp(conn, 200, TelemetryMetricsPrometheus.Core.scrape())
  else
    get "/metrics", do: resp(conn, 200, "[]")
  end
end
