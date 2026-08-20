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

  match _, do: send_resp(conn, 404, "Not found")

  def server_header(conn, version),
    do: conn |> Plug.Conn.put_resp_header("electric-server", "ElectricSQL/#{version}")

  # OPTIONS requests should not be authenticated
  def authenticate(%Plug.Conn{method: "OPTIONS"} = conn, _opts), do: conn

  # Gate on the route the router already resolved (`conn.private.plug_route`,
  # set by `plug :match` before this plug runs) rather than on the raw
  # `request_path`. `match/2` dispatches on the percent-decoded,
  # empty-segment-stripped path, so any request whose decoded path routes to
  # "/v1/shape" — e.g. "/v1/shape/", "/v1//shape", "/v1/%73hape" — must be
  # authenticated here, even though its raw request target is not exactly
  # "/v1/shape". Matching `request_path` or `path_info` (which is never decoded)
  # would leave those variants as an authentication bypass.
  def authenticate(%Plug.Conn{private: %{plug_route: {"/v1/shape", _}}} = conn, _opts) do
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

  # Match the resolved route rather than the never-decoded `path_info`, for the
  # same reason as `authenticate/2` above: `path_info` still holds the raw,
  # percent-encoded segments at this point, so a request like "/v1/%73hape"
  # would route to the shape handler yet miss this clause and get the default
  # CORS method list.
  def put_cors_headers(%Plug.Conn{private: %{plug_route: {"/v1/shape", _}}} = conn, _opts),
    do: CORSHeaderPlug.call(conn, %{methods: ["GET", "POST", "HEAD", "DELETE", "OPTIONS"]})

  def put_cors_headers(conn, _opts),
    do: CORSHeaderPlug.call(conn, %{methods: ["GET", "HEAD"]})

  def add_stack_id_to_metadata(conn, _) do
    Logger.metadata(stack_id: conn.assigns.config[:stack_id])
    Electric.Telemetry.Sentry.set_tags_context(stack_id: conn.assigns.config[:stack_id])
    conn
  end
end
