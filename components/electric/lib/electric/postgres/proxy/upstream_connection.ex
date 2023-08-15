defmodule Electric.Postgres.Proxy.UpstreamConnection do
  use GenServer, restart: :transient

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.SASL
  alias Electric.Replication.Connectors

  require Logger

  def start_link(args) do
    GenServer.start_link(__MODULE__, args)
  end

  def send_msg(pid, msgs) do
    GenServer.cast(pid, {:upstream, msgs})
  end

  def disconnect(pid) do
    GenServer.call(pid, :disconnect)
  end

  @impl GenServer
  def init(args) do
    {:ok, parent} = Keyword.fetch(args, :parent)
    {:ok, conn_config} = Keyword.fetch(args, :conn_config)
    {:ok, session_id} = Keyword.fetch(args, :session_id)

    connection = Connectors.get_connection_opts(conn_config, replication: false)

    Logger.metadata(session_id: session_id)

    decoder = PgProtocol.Decoder.backend()

    {:ok,
     %{
       authenticated: false,
       sasl: nil,
       parent: parent,
       conn: nil,
       pending: [],
       decoder: decoder,
       session_id: session_id,
       conn_config: conn_config,
       connection: connection
     }, {:continue, {:connect, connection}}}
  end

  @impl GenServer
  def handle_continue({:connect, params}, state) do
    host = Map.get(params, :host, "localhost")
    port = Map.get(params, :port, 5432)
    {:ok, conn} = :gen_tcp.connect(host, port, [active: true], 1000)
    {:noreply, %{state | conn: conn}, {:continue, {:authenticate, params}}}
  end

  def handle_continue({:authenticate, params}, state) do
    msg = %M.StartupMessage{
      params: %{
        "user" => Map.fetch!(params, :username),
        "database" => Map.fetch!(params, :database),
        "client_encoding" => "UTF-8",
        "application_name" => "electric"
      }
    }

    {:noreply, upstream(msg, state)}
  end

  @impl GenServer
  def handle_info({:tcp, _conn, data}, state) do
    {:ok, decoder, msgs} = PgProtocol.decode(state.decoder, data)

    Logger.debug("Backend msgs: #{M.inspect(msgs)}")

    state = handle_backend_msgs(msgs, %{state | decoder: decoder})

    {pending, state} =
      Map.get_and_update!(state, :pending, fn pending -> {Enum.reverse(pending), []} end)

    state = downstream(pending, state)

    {:noreply, state}
  end

  @impl GenServer
  def handle_cast({:upstream, msgs}, state) do
    {:noreply, upstream(msgs, state)}
  end

  @impl GenServer
  def handle_call(:disconnect, _from, state) do
    state = upstream(%M.Terminate{}, state)
    :ok = :gen_tcp.close(state.conn)
    {:stop, :normal, :ok, %{state | conn: nil}}
  end

  defp handle_backend_msgs(msgs, state) do
    Enum.reduce(msgs, state, &handle_backend_msg/2)
  end

  defp handle_backend_msg(%M.AuthenticationOk{}, %{authenticated: false} = state) do
    notify_parent(%{state | authenticated: true}, :authenticated)
  end

  defp handle_backend_msg(%M.AuthenticationSASL{} = msg, %{authenticated: false} = state) do
    {sasl_mechanism, response} = SASL.initial_response(msg)

    upstream(response, %{state | sasl: sasl_mechanism})
  end

  defp handle_backend_msg(%M.AuthenticationSASLContinue{} = msg, %{authenticated: false} = state) do
    {sasl_mechanism, response} = SASL.client_final_response(state.sasl, msg, state.connection)

    upstream(response, %{state | sasl: sasl_mechanism})
  end

  defp handle_backend_msg(%M.AuthenticationSASLFinal{} = msg, %{authenticated: false} = state) do
    :ok = SASL.verify_server(state.sasl, msg, state.connection)

    # upstream(response, %{state | sasl: nil})
    %{state | sasl: nil}
  end

  defp handle_backend_msg(msg, state) do
    %{state | pending: [msg | state.pending]}
  end

  defp downstream(msgs, %{parent: parent} = state) do
    send(parent, {:downstream, :msgs, msgs})
    state
  end

  defp upstream(msg, state) do
    :ok = :gen_tcp.send(state.conn, PgProtocol.encode(msg))
    state
  end

  defp notify_parent(state, tag) do
    send(state.parent, {__MODULE__, tag})
    state
  end
end
