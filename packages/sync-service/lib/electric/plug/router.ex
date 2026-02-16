defmodule Electric.Plug.Router do
  use Plug.Router, copy_opts_to_assign: :config
  use Electric.Telemetry

  with_telemetry Sentry.PlugCapture do
    use Sentry.PlugCapture
  end

  alias Electric.Plug.Utils.CORSHeaderPlug
  alias Electric.Plug.Utils.PassAssignToOptsPlug

  plug Plug.RequestId, assign_as: :plug_request_id
  plug :server_header, Electric.version()
  plug :add_stack_id_to_metadata
  # converts HEAD requests to GET requests
  plug Plug.Head
  plug RemoteIp
  plug :match
  plug Electric.Plug.LabelProcessPlug
  plug Electric.Plug.TraceContextPlug
  plug Plug.Telemetry, event_prefix: [:electric, :routing]
  plug Plug.Logger, log: :debug

  with_telemetry Sentry.PlugCapture do
    plug Sentry.PlugContext
  end

  plug :authenticate
  plug :put_cors_headers
  plug :dispatch

  match "/", via: [:get, :head], do: send_resp(conn, 200, "")

  get "/v1/shape",
    to: PassAssignToOptsPlug,
    init_opts: [plug: Electric.Plug.ServeShapePlug, assign_key: :config]

  post "/v1/shape",
    to: PassAssignToOptsPlug,
    init_opts: [plug: Electric.Plug.ServeShapePlug, assign_key: :config]

  delete "/v1/shape",
    to: PassAssignToOptsPlug,
    init_opts: [plug: Electric.Plug.DeleteShapePlug, assign_key: :config]

  options "/v1/shape", to: Electric.Plug.OptionsShapePlug

  get "/v1/health", to: Electric.Plug.HealthCheckPlug

  get "/v1/metadata-snapshot", to: Electric.Plug.MetadataSnapshotPlug

  match _, do: send_resp(conn, 404, "Not found")

  def server_header(conn, version),
    do: conn |> Plug.Conn.put_resp_header("electric-server", "ElectricSQL/#{version}")

  # OPTIONS requests should not be authenticated
  def authenticate(%Plug.Conn{method: "OPTIONS"} = conn, _opts), do: conn

  def authenticate(%Plug.Conn{request_path: path} = conn, _opts)
      when path in ["/v1/shape", "/v1/metadata-snapshot"] do
    api_secret = conn.assigns.config[:secret]

    if is_nil(api_secret) do
      # We're in insecure mode, so we don't need to authenticate
      conn
    else
      conn = conn |> fetch_query_params()

      # Keep `api_secret` for backwards compatibility
      # We'll remove it when we release v2
      case conn.query_params["secret"] || conn.query_params["api_secret"] do
        ^api_secret ->
          conn

        _ ->
          conn
          |> send_resp(401, Jason.encode!(%{message: "Unauthorized - Invalid API secret"}))
          |> halt()
      end
    end
  end

  # For unmatched routes, just pass through
  def authenticate(conn, _opts), do: conn

  def put_cors_headers(%Plug.Conn{path_info: ["v1", "shape" | _]} = conn, _opts),
    do: CORSHeaderPlug.call(conn, %{methods: ["GET", "POST", "HEAD", "DELETE", "OPTIONS"]})

  def put_cors_headers(conn, _opts),
    do: CORSHeaderPlug.call(conn, %{methods: ["GET", "HEAD"]})

  def add_stack_id_to_metadata(conn, _) do
    Logger.metadata(stack_id: conn.assigns.config[:stack_id])
    Electric.Telemetry.Sentry.set_tags_context(stack_id: conn.assigns.config[:stack_id])
    conn
  end
end
