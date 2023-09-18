defmodule Electric.Plug.SatelliteWebsocketPlug do
  require Logger
  use Plug.Builder

  @protocol_prefix "electric."

  def init(handler_opts), do: handler_opts

  defp build_websocket_opts(base_opts, client_version),
    do:
      base_opts
      |> Keyword.put(:client_version, client_version)
      |> Keyword.put_new_lazy(:auth_provider, fn -> Electric.Satellite.Auth.provider() end)
      |> Keyword.put_new_lazy(:pg_connector_opts, fn ->
        Electric.Application.pg_connection_opts()
      end)
      |> Keyword.put_new_lazy(:subscription_data_fun, fn ->
        &Electric.Replication.InitialSync.query_subscription_data/2
      end)

  def call(conn, handler_opts) do
    with {:ok, conn} <- check_if_valid_upgrade(conn),
         {:ok, conn} <- check_if_subprotocol_present(conn),
         {:ok, conn} <- check_if_vsn_compatible(conn, with: "<= #{Electric.vsn()}") do
      Logger.metadata(
        remote_ip: conn.remote_ip |> :inet.ntoa() |> to_string(),
        instance_id: Electric.instance_id()
      )

      client_vsn = conn.assigns.satellite_vsn
      protocol_vsn = "#{client_vsn.major}.#{client_vsn.minor}"
      Logger.debug("Upgrading connection for client with protocol version #{protocol_vsn}")

      conn
      |> put_resp_header("sec-websocket-protocol", @protocol_prefix <> protocol_vsn)
      |> upgrade_adapter(
        :websocket,
        {Electric.Satellite.WebsocketServer, build_websocket_opts(handler_opts, client_vsn), []}
      )
    else
      {:error, code, body} ->
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

  defp check_if_subprotocol_present(%Plug.Conn{} = conn) do
    case get_satellite_subprotocol(conn) do
      {:ok, vsn} -> {:ok, assign(conn, :satellite_vsn, vsn)}
      :error -> {:error, 400, "Missing satellite websocket subprotocol"}
    end
  end

  defp check_if_vsn_compatible(%Plug.Conn{} = conn, with: requirements) do
    if Version.match?(conn.assigns.satellite_vsn, requirements) do
      {:ok, conn}
    else
      {:error, 400,
       "Cannot connect satellite version #{conn.assigns.satellite_vsn}: this server requires #{requirements}"}
    end
  end

  defp get_satellite_subprotocol(%Plug.Conn{} = conn) do
    get_req_header(conn, "sec-websocket-protocol")
    |> Enum.filter(&String.starts_with?(&1, @protocol_prefix))
    |> case do
      [@protocol_prefix <> version] when byte_size(version) < 20 ->
        Version.parse(version <> ".0")

      _ ->
        :error
    end
  end
end
