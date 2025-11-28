defmodule Electric.Plug.HealthCheckPlug do
  use Plug.Builder

  alias Plug.Conn
  alias Electric.StatusMonitor

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
        %{conn: :waiting_on_lock, shape: _} -> {202, "waiting"}
        %{conn: :waiting_on_integrity_checks, shape: _} -> {202, "starting"}
        %{conn: :starting, shape: _} -> {202, "starting"}
        %{conn: _, shape: :starting} -> {202, "starting"}
        %{conn: :up, shape: :up} -> {200, "active"}
        # when Electric is in the scaled-down mode (all database connections are closed),
        # report its status as active because for any incoming shape request it will
        # transparently restore the connection subsystem before processing the request
        %{conn: :sleeping, shape: _} -> {200, "active"}
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
