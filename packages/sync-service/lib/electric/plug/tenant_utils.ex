defmodule Electric.Plug.TenantUtils do
  @moduledoc """
  Shared tenant-related plug functions used across Electric plugs.
  """

  use Plug.Builder

  alias Plug.Conn
  alias Electric.TenantManager

  @doc """
  Load an appropriate tenant configuration into assigns based on the `database_id` query parameter.
  """
  def load_tenant(%Conn{} = conn, _) do
    # This is a no-op if they are already fetched.
    conn = Conn.fetch_query_params(conn)

    Map.get(conn.query_params, "database_id", :not_provided)
    |> maybe_get_tenant(conn.assigns.config)
    |> case do
      {:ok, tenant_config} ->
        conn
        |> assign(:config, tenant_config)
        |> assign(:tenant_id, tenant_config[:tenant_id])

      {:error, :not_found} ->
        conn
        |> send_resp(404, Jason.encode_to_iodata!(~s|Database not found|))
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

  defp maybe_get_tenant(:not_provided, config), do: TenantManager.get_only_tenant(config)
  defp maybe_get_tenant(id, config) when is_binary(id), do: TenantManager.get_tenant(id, config)
  defp maybe_get_tenant(_, _), do: {:error, :not_found}
end
