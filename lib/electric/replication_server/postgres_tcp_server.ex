defmodule Electric.ReplicationServer.PostgresTcpServer do
  use GenServer
  @behaviour :ranch_protocol
  require Logger

  defstruct socket: nil,
            transport: nil,
            client: nil,
            settings: %{},
            accept_ssl: false

  @impl :ranch_protocol
  def start_link(ref, transport, protocol_options) do
    GenServer.start_link(__MODULE__, {ref, transport, protocol_options})
  end

  @impl GenServer
  def init({ref, transport, _}) do
    {:ok, %__MODULE__{transport: transport}, {:continue, {:handshake, ref}}}
  end

  @impl GenServer
  def handle_continue({:handshake, ref}, state) do
    {:ok, socket} = :ranch.handshake(ref)
    {:ok, client} = :inet.peername(socket)
    Logger.debug("Connection initialized by #{inspect(client)}")
    Logger.metadata(client: client)

    {:noreply, %__MODULE__{state | socket: socket, client: client},
     {:continue, :establish_connection}}
  end

  def handle_continue(:establish_connection, state) do
    {:ok, <<length::32>>} = state.transport.recv(state.socket, 4, 100)

    case state.transport.recv(state.socket, length - 4, 100) do
      {:ok, <<1234::16, 5679::16>>} ->
        # SSL connection request
        Logger.debug("SSL upgrade requested by the client")
        {:noreply, state, {:continue, :upgrade_connection_to_ssl}}

      {:ok, <<1234::16, 5678::16, pid::binary-4, secret::32>>} ->
        # Cancellation request
        {:noreply, state, {:continue, {:cancel, pid, secret}}}

      {:ok, <<1234::16, 5680::16>>} ->
        # GSSAPI encrypted connection request
        # Deny the request and continue establishing the connection
        :ok = state.transport.send(state.socket, "N")
        Logger.debug("SSL upgrade denied")
        {:noreply, state, {:continue, :establish_connection}}

      {:ok, <<3::16, 0::16, data::binary>>} ->
        initialize_connection(state, data)
    end
  end

  def handle_continue({:cancel, <<0::14, b::15, c::3>>, 0}, state) do
    pid = :c.pid(0, b, c)
    Logger.debug("Cancellation request issued for #{inspect pid}")
    send(pid, :cancel_operation)
    state.transport.close(state.socket)
    {:stop, :normal, state}
  end

  def handle_continue(:upgrade_connection_to_ssl, %{accept_ssl: false} = state) do
    # Deny the upgrade request and continue establishing the connection
    :ok = state.transport.send(state.socket, "N")
    Logger.debug("SSL upgrade denied")
    {:noreply, state, {:continue, :establish_connection}}
  end

  @impl true
  def handle_info({:tcp, socket, <<?Q, _::32, data::binary>>}, state) do
    IO.inspect(data |> String.trim_trailing(<<0>>), label: "Query")

    :ok = state.transport.setopts(socket, active: :once)
    {:noreply, state}
  end

  @impl true
  def handle_info({:tcp, socket, data}, state) do
    IO.inspect(data)
    :ok = state.transport.setopts(socket, active: :once)
    {:noreply, state}
  end

  @impl true
  def handle_info(:cancel_operation, state) do
    send_error(state, "57014", "Query has been cancelled by the client")
    send(state, ?Z, <<?I>>)

    {:noreply, state}
  end

  @impl true
  def handle_info(_, state) do
    state.transport.close(state.socket)
    Logger.debug("Socket closed by client #{inspect(state.client)}")
    {:stop, :shutdown, state}
  end

  defp initialize_connection(%__MODULE__{} = state, client_connection_params) do
    settings =
      client_connection_params
      |> String.split(<<0>>, trim: true)
      |> Enum.chunk_every(2)
      |> Map.new(&List.to_tuple/1)

    send(state, ?R, <<0::integer-32>>)
    send(state, ?K, <<pid_as_int(self())::binary, 0::integer-32>>)
    send(state, ?Z, <<?I>>)

    Logger.debug("Connection established with #{inspect(state.client)}")

    :ok = state.transport.setopts(state.socket, active: :once)
    {:noreply, %__MODULE__{state | settings: settings}}
  end

  defp send(%__MODULE__{transport: transport, socket: socket}, tag, data) do
    <<tag, byte_size(data) + 4::integer-32, data::binary>>
    |> tap(&Logger.debug("Sending #{inspect(&1)} to client"))
    |> then(&transport.send(socket, &1))
  end

  defp send_error(state, severity \\ :fatal, code, message) do
    %{
      ?S => String.upcase(to_string(severity)),
      ?V => String.upcase(to_string(severity)),
      ?C => code,
      ?M => message
    }
    |> Enum.map_join(fn {k, v} -> <<k, v::binary, 0>> end)
    |> then(&send(state, ?E, <<&1::binary, 0>>))
  end

  def pid_as_int(pid) do
    [_, b, c] =
      pid
      |> :erlang.pid_to_list()
      |> to_string
      |> String.split([">", "<", "."], trim: true)
      |> Enum.map(&String.to_integer/1)

    <<0::14, b::15,c::3>>
  end
end
