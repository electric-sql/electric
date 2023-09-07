defmodule Electric.Plug.SatelliteWebsocketPlug do
  require Logger
  use Plug.Builder

  def init(handler_opts), do: handler_opts

  defp build_websocket_opts(base_opts),
    do:
      base_opts
      |> Keyword.put_new_lazy(:auth_provider, fn -> Electric.Satellite.Auth.provider() end)
      |> Keyword.put_new_lazy(:pg_connector_opts, fn ->
        Electric.Application.pg_connection_opts()
      end)
      |> Keyword.put_new_lazy(:subscription_data_fun, fn ->
        &Electric.Replication.InitialSync.query_subscription_data/2
      end)

  def call(conn, handler_opts) do
    conn
    |> check_if_valid_upgrade()
    |> check_if_subprotocol_present()
    |> check_if_vsn_compatible(with: "<= #{Electric.vsn()}")
    |> case do
      %Plug.Conn{state: :sent} = conn ->
        conn

      conn ->
        Logger.metadata(
          remote_ip: conn.remote_ip |> :inet.ntoa() |> to_string(),
          instance_id: Electric.instance_id()
        )

        protocol_vsn = "#{conn.assigns.satellite_vsn.major}.#{conn.assigns.satellite_vsn.minor}"
        Logger.debug("Upgrading connection for client with version #{protocol_vsn}")

        conn
        |> put_resp_header("sec-websocket-protocol", "satellite.#{protocol_vsn}")
        |> upgrade_adapter(
          :websocket,
          {Electric.Satellite.WebsocketServer, build_websocket_opts(handler_opts), []}
        )
    end
  end

  defp check_if_valid_upgrade(%Plug.Conn{state: :sent} = conn), do: conn

  defp check_if_valid_upgrade(%Plug.Conn{} = conn) do
    if Bandit.WebSocket.Handshake.valid_upgrade?(conn) do
      conn
    else
      send_resp(conn, 400, "Bad request")
    end
  end

  defp check_if_subprotocol_present(%Plug.Conn{state: :sent} = conn), do: conn

  defp check_if_subprotocol_present(%Plug.Conn{} = conn) do
    case get_satellite_subprotocol(conn) do
      {:ok, vsn} -> assign(conn, :satellite_vsn, vsn)
      :error -> send_resp(conn, 400, "Missing satellite websocket subprotocol")
    end
  end

  defp check_if_vsn_compatible(%Plug.Conn{state: :sent} = conn, _), do: conn

  defp check_if_vsn_compatible(%Plug.Conn{} = conn, with: requirements) do
    if Version.match?(conn.assigns.satellite_vsn, requirements) do
      conn
    else
      send_resp(
        conn,
        400,
        "Cannot connect satellite version #{conn.assigns.satellite_vsn}: this server requires #{requirements}"
      )
    end
  end

  defp get_satellite_subprotocol(%Plug.Conn{} = conn) do
    get_req_header(conn, "sec-websocket-protocol")
    |> Enum.filter(&String.starts_with?(&1, "satellite."))
    |> case do
      ["satellite." <> version] when byte_size(version) < 20 ->
        Version.parse(version <> ".0")

      _ ->
        :error
    end
  end
end
