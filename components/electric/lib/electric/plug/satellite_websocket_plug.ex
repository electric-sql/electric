defmodule Electric.Plug.SatelliteWebsocketPlug do
  use Plug.Builder, init_mode: :runtime

  def init(handler_opts),
    do:
      handler_opts
      |> Keyword.put_new_lazy(:auth_provider, fn -> Electric.Satellite.Auth.provider() end)
      |> Keyword.put_new_lazy(:pg_connector_opts, fn ->
        Electric.Application.pg_connection_opts()
      end)
      |> Keyword.put_new_lazy(:subscription_data_fun, fn ->
        &Electric.Replication.InitialSync.query_subscription_data/2
      end)

  def call(conn, handler_opts) do
    if Bandit.WebSocket.Handshake.valid_upgrade?(conn) do
      ws_opts = if List.first(conn.path_info) == "compress", do: [compress: true], else: []

      Logger.metadata(
        remote_ip: conn.remote_ip |> :inet.ntoa() |> to_string(),
        instance_id: Electric.instance_id()
      )

      upgrade_adapter(
        conn,
        :websocket,
        {Electric.Satellite.WebsocketServer, handler_opts, ws_opts}
      )
    else
      send_resp(conn, 401, "Bad request")
    end
  end
end
