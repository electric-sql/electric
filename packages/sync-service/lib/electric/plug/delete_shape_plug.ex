defmodule Electric.Plug.DeleteShapePlug do
  require Logger
  use Plug.Builder

  alias Electric.Shapes
  alias Electric.Plug.ServeShapePlug.Params
  alias Electric.TenantManager

  plug :fetch_query_params
  plug :put_resp_content_type, "application/json"

  plug :allow_shape_deletion
  plug :validate_tenant_id
  plug :load_tenant
  plug :validate_query_params

  plug :truncate_or_delete_shape

  defp allow_shape_deletion(%Plug.Conn{} = conn, _) do
    if conn.assigns.config[:allow_shape_deletion] do
      conn
    else
      conn
      |> send_resp(404, Jason.encode_to_iodata!(%{status: "Not found"}))
      |> halt()
    end
  end

  defp validate_tenant_id(%Plug.Conn{} = conn, _) do
    case Map.get(conn.query_params, "database_id", :not_found) do
      :not_found ->
        conn

      id when is_binary(id) ->
        assign(conn, :database_id, id)

      _ ->
        conn
        |> send_resp(400, Jason.encode_to_iodata!("database_id should be a connection string"))
        |> halt()
    end
  end

  defp load_tenant(%Plug.Conn{assigns: %{database_id: tenant_id}} = conn, _) do
    {:ok, tenant_config} = TenantManager.get_tenant(tenant_id, conn.assigns.config)
    assign_tenant(conn, tenant_config)
  end

  defp load_tenant(%Plug.Conn{} = conn, _) do
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

  defp assign_tenant(%Plug.Conn{} = conn, tenant_config) do
    id = tenant_config[:tenant_id]

    conn
    |> assign(:config, tenant_config)
    |> assign(:tenant_id, id)
  end

  defp validate_query_params(%Plug.Conn{} = conn, _) do
    all_params =
      Map.merge(conn.query_params, conn.path_params)
      |> Map.take(["root_table", "shape_id"])
      |> Map.put("offset", "-1")

    case Params.validate(all_params, inspector: conn.assigns.config[:inspector]) do
      {:ok, params} ->
        %{conn | assigns: Map.merge(conn.assigns, params)}

      {:error, error_map} ->
        conn
        |> send_resp(400, Jason.encode_to_iodata!(error_map))
        |> halt()
    end
  end

  defp truncate_or_delete_shape(%Plug.Conn{} = conn, _) do
    if conn.assigns.shape_id !== nil do
      with :ok <- Shapes.clean_shape(conn.assigns.shape_id, conn.assigns.config) do
        send_resp(conn, 202, "")
      end
    else
      # FIXME: This has a race condition where we accidentally create a snapshot & shape id, but clean
      #        it before snapshot is actually made.
      with {shape_id, _} <-
             Shapes.get_or_create_shape_id(conn.assigns.config, conn.assigns.shape_definition),
           :ok <- Shapes.clean_shape(shape_id, conn.assigns.config) do
        send_resp(conn, 202, "")
      end
    end
  end
end
