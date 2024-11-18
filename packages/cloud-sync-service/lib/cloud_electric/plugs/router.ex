defmodule CloudElectric.Plugs.Router do
  alias Electric.Plug.Utils.CORSHeaderPlug
  use Plug.Router, copy_opts_to_assign: :config

  plug Plug.RequestId, assign_as: :plug_request_id
  plug :server_header, Electric.version() <> "-cloud"
  plug Plug.Head

  plug :match
  plug Electric.Plug.LabelProcessPlug
  plug Plug.Telemetry, event_prefix: [:electric, :routing]
  plug Plug.Logger
  plug :put_cors_headers
  plug :dispatch

  match "/", via: [:get, :head], do: send_resp(conn, 200, "")

  post "/v1/admin/databases", to: CloudElectric.Plugs.AddDatabasePlug
  delete "/v1/admin/databases/:database_id", to: CloudElectric.Plugs.DeleteDatabasePlug

  match _, do: send_resp(conn, 404, "Not found")

  def server_header(conn, version),
    do: conn |> Plug.Conn.put_resp_header("server", "ElectricSQL/#{version}")

  def put_cors_headers(%Plug.Conn{path_info: ["v1", "shape" | _]} = conn, _opts),
    do: CORSHeaderPlug.call(conn, %{methods: ["GET", "HEAD", "DELETE", "OPTIONS"]})

  def put_cors_headers(conn, _opts),
    do: CORSHeaderPlug.call(conn, %{methods: ["GET", "HEAD"]})
end
