defmodule Electric.Plug.RemoveAllDatabasesPlug do
  use Plug.Builder

  alias Electric.TenantManager

  require Logger

  plug :put_resp_content_type, "application/json"
  plug :delete_tenant

  defp delete_tenant(conn, _) do
    case TenantManager.delete_all_tenants(conn.assigns.config) do
      :ok ->
        conn
        |> send_resp(200, Jason.encode_to_iodata!(%{}))
        |> halt()
    end
  end
end
