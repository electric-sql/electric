defmodule Electric.Plug.UtilityRouter do
  use Plug.Router
  use Electric.Telemetry

  plug :match
  plug :dispatch

  with_telemetry TelemetryMetricsPrometheus.Core do
    get "/metrics", do: text_resp(conn, 200, TelemetryMetricsPrometheus.Core.scrape())
  else
    get "/metrics", do: text_resp(conn, 200, "")
  end

  get _, do: text_resp(conn, 404, "Not found")

  defp text_resp(conn, status, body) do
    conn
    |> put_resp_content_type("text/plain")
    |> resp(status, body)
  end
end
