defmodule Electric.Plug.Router do
  use Plug.Router, copy_opts_to_assign: :config
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

  get "/v1/shape", to: Electric.Plug.ServeShapePlug
  delete "/v1/shape", to: Electric.Plug.DeleteShapePlug
  match "/v1/shape", via: :options, to: Electric.Plug.OptionsShapePlug

  get "/v1/health", to: Electric.Plug.HealthCheckPlug

  match _,
    do: send_resp(conn, 404, "Not found")

  def server_header(conn, version),
    do: conn |> Plug.Conn.put_resp_header("server", "ElectricSQL/#{version}")

  def put_cors_headers(%Plug.Conn{path_info: ["v1", "shape", _ | _]} = conn, _opts),
    do: CORSHeaderPlug.call(conn, %{methods: ["GET", "HEAD", "DELETE", "OPTIONS"]})

  def put_cors_headers(conn, _opts),
    do: CORSHeaderPlug.call(conn, %{methods: ["GET", "HEAD"]})
end
