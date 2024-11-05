defmodule Electric.Plug.RemoveDatabasePlug do
  use Plug.Builder

  alias Plug.Conn
  alias Electric.TenantManager

  require Logger

  plug :put_resp_content_type, "application/json"
  plug :delete_tenant

  defp delete_tenant(%Conn{path_params: %{"database_id" => tenant_id}} = conn, _) do
    case TenantManager.delete_tenant(tenant_id, conn.assigns.config) do
      :ok ->
        conn
        |> send_resp(200, Jason.encode_to_iodata!(tenant_id))
        |> halt()

      :not_found ->
        conn
        |> send_resp(404, Jason.encode_to_iodata!("Database #{tenant_id} not found."))
        |> halt()
    end
  end
end
