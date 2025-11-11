defmodule Electric.Plug.StatusPlug do
  @moduledoc """
  Plug that exposes the current status of the Electric server.

  Returns JSON with information about:
  - Whether replication is available (live data)
  - Connection status
  - Shape subsystem status

  Responses are cached for 5 seconds to allow CDN caching and reduce
  load when clients poll for status updates.
  """
  use Plug.Builder
  require Logger

  plug :serve_status

  def serve_status(conn, _opts) do
    stack_id = conn.assigns.config[:stack_id]
    status = Electric.StatusMonitor.status(stack_id)

    response = %{
      status: status_summary(status),
      replication_available: status.replication_available,
      connection: status.conn,
      shape: status.shape
    }

    conn
    |> Plug.Conn.put_resp_content_type("application/json")
    |> Plug.Conn.put_resp_header("cache-control", "public, max-age=5")
    |> Plug.Conn.send_resp(200, Jason.encode!(response))
  end

  defp status_summary(%{replication_available: true, conn: :up, shape: :up}), do: "live"
  defp status_summary(%{replication_available: false, conn: :up, shape: :up}), do: "fallback"
  defp status_summary(_), do: "starting"
end
