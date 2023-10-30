defmodule Electric.Plug.SatelliteWebsocketPlug do
  @behaviour Plug

  import Plug.Conn

  require Logger

  @protocol_prefix "electric."

  def init(handler_opts), do: handler_opts

  defp build_websocket_opts(base_opts, client_version),
    do:
      base_opts
      |> Keyword.put(:client_version, client_version)
      |> Keyword.put_new_lazy(:auth_provider, fn -> Electric.Satellite.Auth.provider() end)
      |> Keyword.put_new_lazy(:connector_config, fn ->
        Electric.Replication.PostgresConnector.connector_config()
      end)
      |> Keyword.put_new(
        :subscription_data_fun,
        &Electric.Replication.InitialSync.query_subscription_data/2
      )
      |> Keyword.put_new(
        :move_in_data_fun,
        &Electric.Replication.InitialSync.query_after_move_in/4
      )

  @currently_supported_versions ">= 0.6.0 and <= #{%{Electric.vsn() | pre: []}}"

  def call(conn, handler_opts) do
    with :ok <- check_if_valid_upgrade(conn),
         {:ok, conn} <- check_if_subprotocol_present(conn),
         {:ok, conn} <- check_if_vsn_compatible(conn, with: @currently_supported_versions) do
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
    with {:error, reason} <- Bandit.WebSocket.UpgradeValidation.validate_upgrade(conn) do
      Logger.debug("Client WebSocket connection failed with reason: #{reason}")
      {:error, 400, "Bad request"}
    end
  end

  defp check_if_subprotocol_present(%Plug.Conn{} = conn) do
    case get_satellite_subprotocol(conn) do
      {:ok, vsn} ->
        {:ok, assign(conn, :satellite_vsn, vsn)}

      :error ->
        reason = "Missing satellite websocket subprotocol"
        Logger.debug("Client WebSocket connection failed with reason: #{reason}")
        {:error, 400, reason}
    end
  end

  defp check_if_vsn_compatible(%Plug.Conn{assigns: assigns} = conn, with: requirements) do
    if Version.match?(assigns.satellite_vsn, requirements) do
      {:ok, conn}
    else
      reason =
        "Cannot connect satellite version #{assigns.satellite_vsn}: this server requires #{requirements}"

      Logger.debug("Client WebSocket connection failed with reason: #{reason}")
      {:error, 400, reason}
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
