defmodule Electric.Plug.ProxyWebsocketPlug do
  @moduledoc """
  This plug handles requests to establish a WebSocket connection to the migrations proxy.

  On hosting providers that only allow inbound HTTP traffic on port 80 (and HTTPS traffic on port 443), Electric's proxy
  cannot open its own dedicated port to listen on incoming TCP connections. This plug, together with the server
  implementation in `Electric.Postgres.Proxy.WebsocketSerevr`, enables Electric to tunnel TCP traffic over the WebSocket
  protocol provided that a matching tunnel is set up on the client side.

  Note that unless the migrations proxy's port is configured with the special value "http", this plug will reject any
  incoming requests with a 404 status code.
  """

  @behaviour Plug

  import Plug.Conn

  alias Electric.Replication.Connectors

  require Logger

  def init(handler_opts), do: handler_opts

  def call(conn, handler_opts) do
    connector_config = Electric.Replication.PostgresConnector.connector_config()
    proxy_config = Connectors.get_proxy_opts(connector_config)

    if proxy_config.use_http_tunnel? do
      upgrade_to_websocket(conn, Keyword.put_new(handler_opts, :proxy_config, proxy_config))
    else
      Logger.warning(
        "Attempted WebSocket connection to the migrations proxy but it wasn't enabled."
      )

      send_resp(conn, 404, "Migrations proxy is not configured to accept WebSocket connections")
    end
  end

  defp upgrade_to_websocket(conn, websocket_opts) do
    with {:ok, conn} <- check_if_valid_upgrade(conn) do
      conn
      |> upgrade_adapter(
        :websocket,
        {Electric.Postgres.Proxy.WebsocketServer, websocket_opts, []}
      )
    else
      {:error, code, body} ->
        Logger.debug("Clients WebSocket connection failed with reason: #{body}")
        send_resp(conn, code, body)
    end
  end

  defp check_if_valid_upgrade(%Plug.Conn{} = conn) do
    if Bandit.WebSocket.Handshake.valid_upgrade?(conn) do
      {:ok, conn}
    else
      {:error, 400, "Bad request"}
    end
  end
end
