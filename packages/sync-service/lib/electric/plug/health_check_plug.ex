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
    {http_status, status_text} =
      case StatusMonitor.status(config[:stack_id]) do
        %{conn: :waiting_on_lock, shape: _} -> {:accepted, "waiting"}
        %{conn: :starting, shape: _} -> {:accepted, "starting"}
        %{conn: _, shape: :starting} -> {:accepted, "starting"}
        %{conn: :up, shape: :up} -> {:ok, "active"}
        # when Electric is in the scaled-down mode (all database connections are closed),
        # report its status as active because for any incoming shape request it will
        # transparently restore the connection subsystem before processing the request
        %{conn: :sleeping, shape: _} -> {:ok, "active"}
      end

    merge_assigns(conn, http_status: http_status, status_text: status_text)
  end

  defp put_cache_headers(conn, _) do
    put_resp_header(conn, "cache-control", "no-cache, no-store, must-revalidate")
  end

  defp send_response(%Conn{assigns: assigns} = conn, _) do
    Electric.Plug.Utils.json_resp(conn, assigns.http_status, %{status: assigns.status_text})
  end
end
