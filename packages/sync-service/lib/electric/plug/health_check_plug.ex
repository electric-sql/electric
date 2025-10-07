defmodule Electric.Plug.HealthCheckPlug do
  alias Plug.Conn
  alias Electric.StatusMonitor
  require Logger
  use Plug.Builder

  plug :fetch_query_params
  plug :check_service_status
  plug :put_resp_content_type, "application/json"
  plug :put_cache_headers
  plug :send_response

  # Match service status to a status code and status message,
  # keeping the message name decoupled from the internal representation
  # of the status to ensure the API is stable
  defp check_service_status(%Conn{assigns: %{config: config}} = conn, _) do
    {status_code, status_text} =
      case StatusMonitor.status(config[:stack_id]) do
        :waiting -> {202, "waiting"}
        :starting -> {202, "starting"}
        active when active in [:active, :db_conn_sleeping] -> {200, "active"}
      end

    conn |> assign(:status_text, status_text) |> assign(:status_code, status_code)
  end

  defp put_cache_headers(conn, _) do
    put_resp_header(conn, "cache-control", "no-cache, no-store, must-revalidate")
  end

  defp send_response(%Conn{assigns: assigns} = conn, _) do
    send_resp(conn, assigns.status_code, Jason.encode!(%{status: assigns.status_text}))
  end
end
