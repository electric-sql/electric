defmodule Satellite.TestWsClient do
  use Mint.WebSocketClient
  alias Electric.Satellite.Auth

  use Electric.Satellite.Protobuf

  # Public API

  @protocol_prefix "electric."
  @satellite_vsn @protocol_prefix <> "#{Electric.vsn().major}.#{Electric.vsn().minor}"

  def connect(opts) do
    connection_opts =
      [
        host: "127.0.0.1",
        port: 5133,
        protocol: :ws,
        path: "/ws",
        subprotocol: @satellite_vsn,
        init_arg: Keyword.drop(opts, [:host, :port]) ++ [parent: self()]
      ]
      |> Keyword.merge(Keyword.take(opts, [:host, :port]))

    GenServer.start(__MODULE__, connection_opts, Keyword.take(opts, [:name]))
  end

  def with_connect(opts, fun) when is_function(fun, 1) do
    {:ok, pid} = connect(opts)

    try do
      fun.(pid)
    after
      disconnect(pid)
    end
  end

  def disconnect(pid) do
    GenServer.stop(pid, :shutdown)
  catch
    :exit, _ -> :ok
  end

  @doc """
  Send given WebSocket frames to the server.
  """
  @spec send_frames(GenServer.server(), Mint.WebSocket.frame() | [Mint.WebSocket.frame()]) ::
          :ok | {:error, term()}
  def send_frames(pid, data), do: GenServer.call(pid, {:send_frames, List.wrap(data)})

  @doc """
  Send Satellite protocol messages to the server.
  """
  @spec send_data(GenServer.server(), PB.sq_pb_msg() | [PB.sq_pb_msg()]) :: :ok | {:error, term()}
  def send_data(pid, messages), do: GenServer.call(pid, {:send_data, List.wrap(messages)})

  # Implementation

  @impl WebSocketClient
  def handle_connection(@protocol_prefix <> vsn, conn, opts) do
    Logger.info("Connection established with protocol vsn #{vsn}")

    opts = Map.new(opts)

    with {:ok, conn, unprocessed} <- maybe_auth(conn, opts),
         {:ok, _conn} <- maybe_subscribe(conn, opts) do
      table = :ets.new(:ws_client_received_messages, [:ordered_set])
      {:ok, %{opts: opts, count: 0, table: table}, unprocessed}
    end
  end

  def handle_connection(_, _, _) do
    {:error, :wrong_subprotocol}
  end

  defp maybe_auth(conn, opts) do
    case auth_token!(opts[:auth]) do
      {:ok, token} ->
        id = Map.get(opts, :id, "id")

        headers = [%SatAuthHeaderPair{key: :PROTO_VERSION, value: PB.get_long_proto_vsn()}]
        auth_req = serialize(%SatAuthReq{id: id, token: token, headers: headers})

        {:ok, conn} = WebSocketClient.send_frames(conn, [auth_req])
        {:ok, conn, frames} = WebSocketClient.receive_next_frames!(conn)

        decoded =
          Enum.map(frames, fn {:binary, <<type::8, data::binary>>} -> PB.decode!(type, data) end)

        {[%SatAuthResp{}], rest} = Enum.split_with(decoded, &is_struct(&1, SatAuthResp))

        Logger.debug("Auth passed")
        {:ok, conn, Enum.map(rest, &serialize/1)}

      :no_auth ->
        {:ok, conn, []}
    end
  end

  defp maybe_subscribe(conn, opts) do
    case opts[:sub] do
      nil ->
        {:ok, conn}

      "" ->
        sub_req = serialize(%SatInStartReplicationReq{})
        {:ok, conn} = WebSocketClient.send_frames(conn, [sub_req])
        Logger.debug("Subscribed at LSN=0")
        {:ok, conn}

      lsn ->
        sub_req =
          serialize(%SatInStartReplicationReq{
            lsn: lsn,
            subscription_ids: Map.get(opts, :subscription_ids, [])
          })

        {:ok, conn} = WebSocketClient.send_frames(conn, [sub_req])
        Logger.debug("Subscribed at LSN=#{inspect(lsn)}")
        {:ok, conn}
    end
  end

  @impl WebSocketClient
  def handle_frame({:text, _}, state) do
    Logger.error("Text frames are not supported for Electric protocol")
    {:stop, :normal, {:close, 1003, ""}, state}
  end

  def handle_frame({:binary, <<type::8, data::binary>>}, state) do
    Logger.debug("Received type #{type} and binary: #{inspect(data, limit: :infinity)}")

    case PB.decode(type, data) do
      {:ok, msg} ->
        state
        |> tap(&log(&1, msg))
        |> store(msg)
        |> tap(&send(&1.opts.parent, {self(), msg}))
        |> maybe_autorespond(msg)

      {:error, reason} ->
        Logger.error("Couldn't decode message from the server: #{inspect(reason)}")
        {:stop, {:error, reason}, {:close, 1007, ""}, state}
    end
  end

  @impl GenServer
  def terminate(:shutdown, {conn, _}) do
    WebSocketClient.send_frames(conn, [{:close, 1001, ""}])
  end

  def terminate(_, _), do: nil

  @impl GenServer
  def handle_call({:send_frames, frames}, _from, {conn, state}) do
    case WebSocketClient.send_frames(conn, frames) do
      {:ok, conn} ->
        {:reply, :ok, {conn, state}}

      {:error, %Mint.TransportError{reason: :closed}} = error ->
        {:stop, :normal, error, {conn, state}}

      error ->
        {:reply, error, {conn, state}}
    end
  end

  def handle_call({:send_data, messages}, _from, {conn, state}) do
    frames = Enum.map(messages, &serialize/1)

    case WebSocketClient.send_frames(conn, frames) do
      {:ok, conn} ->
        {:reply, :ok, {conn, state}}

      {:error, %Mint.TransportError{reason: :closed}} = error ->
        {:stop, :normal, error, {conn, state}}

      error ->
        {:reply, error, {conn, state}}
    end
  end

  defp store(state, %SatPingReq{}), do: state

  defp store(%{count: count} = state, msg) do
    :ets.insert(state.table, {count, msg})
    %{state | count: count + 1}
  end

  defp log(_, %SatPingReq{} = msg), do: Logger.info("rec: #{inspect(msg)}")
  defp log(state, msg), do: Logger.info("rec [#{state.count}]: #{inspect(msg)}")

  defp maybe_autorespond(%{opts: %{auto_ping: true}} = state, %SatPingReq{}) do
    {:reply, serialize(%SatPingResp{lsn: nil}), state}
  end

  defp maybe_autorespond(%{opts: %{auto_in_sub: true}} = state, %SatInStartReplicationReq{}) do
    {:reply, serialize(%SatInStartReplicationResp{}), state}
  end

  defp maybe_autorespond(state, _), do: {:noreply, state}

  defp auth_token!(nil), do: :no_auth
  defp auth_token!(%{token: token}), do: {:ok, token}

  defp auth_token!(%{auth_config: config, user_id: user_id}),
    do: {:ok, Auth.Secure.create_token(user_id, config: config)}

  defp auth_token!(%{user_id: user_id}), do: {:ok, Auth.Secure.create_token(user_id)}

  defp auth_token!(invalid),
    do:
      raise(ArgumentError,
        message:
          ~s'expected %{auth_provider: "...", user_id: "..."} | %{token: "..."}, got: #{inspect(invalid)}'
      )

  @spec serialize(struct) :: {:binary, binary()}
  def serialize(data) do
    {:ok, type, iodata} = PB.encode(data)
    {:binary, IO.iodata_to_binary([<<type::8>>, iodata])}
  end
end
