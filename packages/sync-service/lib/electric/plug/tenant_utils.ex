defmodule Electric.Plug.TenantUtils do
  @moduledoc """
  Shared tenant-related plug functions used across Electric plugs.
  """

  use Plug.Builder

  alias Plug.Conn
  alias Electric.TenantManager

  def validate_tenant_id(%Conn{} = conn, _) do
    case Map.get(conn.query_params, "database_id", :not_found) do
      :not_found ->
        conn

      id when is_binary(id) ->
        assign(conn, :database_id, id)

      _ ->
        conn
        |> send_resp(400, Jason.encode_to_iodata!("database_id should be a string"))
        |> halt()
    end
  end

  def load_tenant(%Conn{assigns: %{database_id: tenant_id}} = conn, _) do
    {:ok, tenant_config} = TenantManager.get_tenant(tenant_id, conn.assigns.config)
    assign_tenant(conn, tenant_config)
  end

  def load_tenant(%Conn{} = conn, _) do
    # Tenant ID is not specified
    # ask the tenant manager for the only tenant
    # if there's more than one tenant we reply with an error
    case TenantManager.get_only_tenant(conn.assigns.config) do
      {:ok, tenant_config} ->
        assign_tenant(conn, tenant_config)

      {:error, :not_found} ->
        conn
        |> send_resp(400, Jason.encode_to_iodata!("No database found"))
        |> halt()

      {:error, :several_tenants} ->
        conn
        |> send_resp(
          400,
          Jason.encode_to_iodata!(
            "Database ID was not provided and there are multiple databases. Please specify a database ID using the `database_id` query parameter."
          )
        )
        |> halt()
    end
  end

  defp assign_tenant(%Conn{} = conn, tenant_config) do
    id = tenant_config[:tenant_id]

    conn
    |> assign(:config, tenant_config)
    |> assign(:tenant_id, id)
  end
end
