defmodule Electric.Plug.UtilityRouter do
  use Plug.Router
  use Electric.Telemetry

  plug :match
  plug :dispatch

  with_telemetry TelemetryMetricsPrometheus.Core do
    get "/metrics", do: resp(conn, 200, TelemetryMetricsPrometheus.Core.scrape())
  else
    get "/metrics", do: resp(conn, 200, "[]")
  end

  get _, do: resp(conn, 404, "Not found")
end
