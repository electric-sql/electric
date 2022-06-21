defmodule Electric.ReplicationServer.PostgresTcpServer do
  use GenServer
  @behaviour :ranch_protocol
  require Logger

  alias Electric.Postgres.Messaging

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
    {:ok, {ip, port}} = :inet.peername(socket)
    client = "#{:inet.ntoa(ip)}:#{port}"
    Logger.metadata(client: client)
    Logger.debug("Connection initialized by #{client}")

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
        tcp_send(Messaging.deny_upgrade_request(), state)
        Logger.debug("SSL upgrade denied")
        {:noreply, state, {:continue, :establish_connection}}

      {:ok, <<3::16, 0::16, data::binary>>} ->
        initialize_connection(state, data)
    end
  end

  def handle_continue({:cancel, <<0::14, b::15, c::3>>, 0}, state) do
    pid = :c.pid(0, b, c)
    Logger.debug("Cancellation request issued for #{inspect(pid)}")
    send(pid, :cancel_operation)
    state.transport.close(state.socket)
    {:stop, :normal, state}
  end

  def handle_continue(:upgrade_connection_to_ssl, %{accept_ssl: false} = state) do
    # Deny the upgrade request and continue establishing the connection
    tcp_send(Messaging.deny_upgrade_request(), state)
    Logger.debug("SSL upgrade denied")
    {:noreply, state, {:continue, :establish_connection}}
  end

  @impl true
  def handle_info({:tcp, socket, <<?X, 4::32>>}, state) do
    Logger.debug("Session terminated by the client")
    state.transport.close(socket)
    {:stop, :normal, state}
  end

  @impl true
  def handle_info({:tcp, socket, <<?Q, _::32, data::binary>>}, state) do
    IO.inspect(Logger.metadata())

    query = String.trim_trailing(data, <<0>>)
    Logger.debug("Query received: #{inspect(query)}")

    case query do
      "SELECT pg_catalog.set_config('search_path', '', false);" ->
        Messaging.row_description(set_config: [type: :text])
        |> Messaging.data_row([""])
        |> Messaging.command_complete("SELECT 1")
        |> Messaging.ready()
        |> tcp_send(state)

      "IDENTIFY_SYSTEM" <> _ ->
        Messaging.row_description(
          systemid: [type: :text],
          timeline: [type: :int4],
          xlogpos: [type: :text],
          dbname: [type: :text]
        )
        |> Messaging.data_row([
          to_string(node(self())),
          "1",
          "0/10",
          state.settings["database"]
        ])
        |> Messaging.command_complete("IDENTIFY_SYSTEM")
        |> Messaging.ready()
        |> tcp_send(state)
    end

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
    Messaging.error(:fatal, code: "57014", message: "Query has been cancelled by the client")
    |> Messaging.ready()
    |> tcp_send(state)

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

    if settings["replication"] == "database" do
      Messaging.authentication_ok()
      |> Messaging.parameter_status("application_name", settings["application_name"])
      |> Messaging.parameter_status("client_encoding", settings["client_encoding"])
      |> Messaging.parameter_status("server_encoding", "UTF8")
      |> Messaging.parameter_status("server_version", "electric-0.0.1")
      |> Messaging.parameter_status("standard_conforming_strings", "on")
      |> Messaging.backend_key_data(serialize_pid(self()), 0)
      |> Messaging.ready()
      |> tcp_send(state)

      Logger.debug(
        "Connection established with #{inspect(state.client)}, config: #{inspect(settings, pretty: true)}"
      )

      :ok = state.transport.setopts(state.socket, active: :once)
      {:noreply, %__MODULE__{state | settings: settings}}
    else
      Messaging.error(:fatal,
        code: "08004",
        message: "Electric mesh allows connection only in `replication=database` mode"
      )
      |> tcp_send(state)

      state.transport.close(state.socket)
      {:stop, :normal, state}
    end
  end

  defp tcp_send(data, %__MODULE__{transport: transport, socket: socket}) when is_binary(data) do
    Logger.debug("Sending #{inspect(data)} to client")
    transport.send(socket, data)
  end

  def serialize_pid(pid) do
    [_, b, c] =
      pid
      |> :erlang.pid_to_list()
      |> to_string
      |> String.split([">", "<", "."], trim: true)
      |> Enum.map(&String.to_integer/1)

    <<0::14, b::15, c::3>>
  end
end
