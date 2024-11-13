defmodule Electric.Plug.Router do
  use Plug.Router, copy_opts_to_assign: :config
  alias Electric.TenantManager
  alias Electric.Plug.TenantUtils
  alias Electric.Plug.Utils.CORSHeaderPlug

  plug Plug.RequestId, assign_as: :plug_request_id
  plug :server_header, Electric.version()
  # converts HEAD requests to GET requests
  plug Plug.Head
  plug :match
  plug Electric.Plug.LabelProcessPlug
  plug Plug.Telemetry, event_prefix: [:electric, :routing]
  plug Plug.Logger
  plug :put_cors_headers
  plug :dispatch

  match "/", via: [:get, :head], do: send_resp(conn, 200, "")

  get "/v1/shape" do
    conn = Plug.Conn.fetch_query_params(conn)

    Map.get(conn.query_params, "database_id", :not_provided)
    |> maybe_get_tenant(conn.assigns.config)
    |> case do
      {:ok, tenant_config} ->
        Electric.Plug.ServeShapePlug.call(conn, tenant_config |> dbg)

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

  delete "/v1/shape", to: Electric.Plug.DeleteShapePlug
  match "/v1/shape", via: :options, to: Electric.Plug.OptionsShapePlug

  get "/v1/health", to: Electric.Plug.HealthCheckPlug

  post "/v1/admin/database", to: Electric.Plug.AddDatabasePlug
  delete "/v1/admin/database/:database_id", to: Electric.Plug.RemoveDatabasePlug

  match _, do: send_resp(conn, 404, "Not found")

  def server_header(conn, version),
    do: conn |> Plug.Conn.put_resp_header("server", "ElectricSQL/#{version}")

  def put_cors_headers(%Plug.Conn{path_info: ["v1", "shape" | _]} = conn, _opts),
    do: CORSHeaderPlug.call(conn, %{methods: ["GET", "HEAD", "DELETE", "OPTIONS"]})

  def put_cors_headers(%Plug.Conn{path_info: ["v1", "admin", _ | _]} = conn, _opts),
    do: CORSHeaderPlug.call(conn, %{methods: ["GET", "POST", "DELETE", "OPTIONS"]})

  def put_cors_headers(conn, _opts),
    do: CORSHeaderPlug.call(conn, %{methods: ["GET", "HEAD"]})

  defp maybe_get_tenant(:not_provided, config), do: TenantManager.get_only_tenant(config)
  defp maybe_get_tenant(id, config) when is_binary(id), do: TenantManager.get_tenant(id, config)
  defp maybe_get_tenant(_, _), do: {:error, :not_found}
end
