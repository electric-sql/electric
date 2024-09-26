defmodule Electric.Plug.HealthCheckPlug do
  alias Plug.Conn
  require Logger
  use Plug.Builder

  plug :check_service_status
  plug :send_response

  defp check_service_status(conn, _) do
    get_service_status = Access.fetch!(conn.assigns.config, :get_service_status)

    status_text =
      case get_service_status.() do
        :starting -> "starting"
        :ready -> "ready"
        :active -> "active"
        :stopping -> "stopping"
      end

    conn |> assign(:status_text, status_text)
  end

  defp send_response(%Conn{assigns: %{status_text: status_text}} = conn, _),
    do: send_resp(conn, 200, Jason.encode!(%{status: status_text}))
end
