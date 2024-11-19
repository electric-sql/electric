defmodule Electric.Plug.HealthCheckPlug do
  alias Plug.Conn
  require Logger
  use Plug.Builder

  plug :fetch_query_params
  plug :check_service_status
  plug :put_relevant_headers
  plug :send_response

  # Match service status to a status code and status message,
  # keeping the message name decoupled from the internal representation
  # of the status to ensure the API is stable
  defp check_service_status(%Conn{assigns: %{config: config}} = conn, _) do
    get_service_status = Access.fetch!(config, :get_service_status)

    {status_code, status_text} =
      case get_service_status.() do
        :waiting -> {503, "waiting"}
        :starting -> {503, "starting"}
        :active -> {200, "active"}
        :stopping -> {503, "stopping"}
      end

    conn |> assign(:status_text, status_text) |> assign(:status_code, status_code)
  end

  defp put_relevant_headers(conn, _),
    do:
      conn
      |> put_resp_header("content-type", "application/json")
      |> put_resp_header("cache-control", "no-cache, no-store, must-revalidate")

  defp send_response(
         %Conn{assigns: %{status_text: status_text, status_code: status_code}} = conn,
         _
       ),
       do: send_resp(conn, status_code, Jason.encode!(%{status: status_text}))
end
