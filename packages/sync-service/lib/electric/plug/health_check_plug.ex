defmodule Electric.Plug.HealthCheckPlug do
  alias Plug.Conn
  require Logger
  use Plug.Builder

  plug :check_service_status
  plug :put_relevant_headers
  plug :send_response

  defp check_service_status(conn, _) do
    get_service_status = Access.fetch!(conn.assigns.config, :get_service_status)

    {status_code, status_text} =
      case get_service_status.() do
        :waiting -> {200, "waiting"}
        :starting -> {200, "starting"}
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
