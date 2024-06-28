defmodule Electric.Postgres.Proxy.WebsocketServer do
  @moduledoc """
  This is a dumb WebSocket handler for `Electric.Postgres.Proxy`.

  It opens a local TCP connection to the proxy and shuttles data between it and the client's WebSocket connection.
  """

  @behaviour WebSock

  @impl WebSock
  def init(opts) do
    {:ok, connect(%{proxy_port: get_in(opts, [:proxy_config, :listen, :port])})}
  end

  @impl WebSock
  def handle_in({data, opcode: :binary}, state) do
    case :gen_tcp.send(state.tcp_socket, data) do
      :ok -> {:ok, state}
      {:error, reason} -> {:stop, reason, state}
    end
  end

  @impl WebSock
  def handle_info({:tcp, _socket, data}, state) do
    {:push, [{:binary, data}], state}
  end

  def handle_info({:tcp_closed, _socket}, state) do
    {:stop, :normal, state}
  end

  defp connect(state) do
    {:ok, socket} = :gen_tcp.connect(~c"localhost", state.proxy_port, keepalive: true)
    Map.put(state, :tcp_socket, socket)
  end
end
