defmodule Electric.Postgres.Proxy.Handler do
  use ThousandIsland.Handler

  alias ThousandIsland.Socket
  alias Electric.Postgres.Extension.{SchemaCache, SchemaLoader}
  alias Electric.Replication.Connectors
  alias PgProtocol.Message, as: M

  alias Electric.Postgres.Proxy.{
    Injector,
    UpstreamConnection
  }

  import __MODULE__.Tracing

  require Logger

  @type option() :: {:loader, {module(), Keyword.t()}}
  @type options() :: [option()]

  defmodule S do
    defstruct upstream: [],
              injector_opts: [],
              injector: nil,
              loader: nil,
              connector_config: nil,
              connection: nil,
              decoder: nil,
              session_id: nil,
              authenticated?: false,
              username: nil,
              database: nil,
              password: nil,
              authentication: nil

    @type username() :: String.t()
    @type salt() :: binary()
    @type auth_type() :: {:md5, username(), salt()}

    @type t() :: %__MODULE__{
            authenticated?: boolean(),
            authentication: nil | auth_type(),
            connector_config: Connectors.config(),
            connection: nil | pid(),
            database: nil | String.t(),
            decoder: PgProtocol.Decoder.t(),
            injector: nil | Injector.t(),
            injector_opts: Keyword.t(),
            loader: SchemaLoader.t(),
            password: String.t(),
            session_id: nil | integer(),
            upstream: [PgProtocol.Message.t()],
            username: nil | username()
          }
  end

  @spec initial_state(Connectors.config(), options()) :: S.t()
  def initial_state(connector_config, proxy_opts) do
    {loader, loader_opts} = Keyword.get(proxy_opts, :loader, {SchemaCache, []})
    password = connector_config |> get_in([:proxy, :password]) |> validate_password()

    %S{
      connector_config: connector_config,
      loader: {loader, loader_opts},
      decoder: PgProtocol.Decoder.frontend(),
      injector_opts: Keyword.get(proxy_opts, :injector, []),
      password: password,
      username: nil,
      database: nil
    }
  end

  defp validate_password(empty) when empty in [nil, ""] do
    raise ArgumentError,
      message: "Proxy password (PG_PROXY_PASSWORD) is not set or set to an empty value"
  end

  defp validate_password(password) do
    password
  end

  @impl ThousandIsland.Handler
  def handle_connection(_socket, state) do
    session_id = Electric.Postgres.Proxy.session_id()
    Logger.metadata(proxy_session_id: session_id)

    {:continue, %{state | session_id: session_id}}
  end

  @impl ThousandIsland.Handler
  def handle_data(data, socket, state) do
    {:ok, decoder, msgs} = PgProtocol.decode(state.decoder, data)

    trace_recv(:client, state.session_id, msgs)

    handle_messages(msgs, socket, %{state | decoder: decoder})
  end

  @impl GenServer
  def handle_info({:downstream, :msgs, msgs}, {socket, state}) do
    trace_recv(:server, state.session_id, msgs)

    {:ok, injector, upstream_msgs, downstream_msgs} =
      Injector.recv_server(state.injector, msgs)

    :ok = upstream(upstream_msgs, state)

    case downstream(downstream_msgs, socket, state) do
      {:error, _error} ->
        Logger.debug("Client connection already closed")
        {:stop, {:shutdown, :closed}, {socket, %{state | injector: injector}}}

      :ok ->
        {:noreply, {socket, %{state | injector: injector}}}
    end
  end

  def handle_info({UpstreamConnection, :authenticated}, {socket, state}) do
    Logger.info("Upstream connection is ready to accept queries")
    {:noreply, {socket, state}}
  end

  def handle_info({:EXIT, conn, reason}, {socket, state}) do
    if reason != :normal do
      Logger.warning(
        "Upstream connection #{inspect(conn)} shut down with reason #{inspect(reason)}"
      )
    end

    {:stop, {:shutdown, :closed}, {socket, state}}
  end

  defp handle_messages([], _socket, state) do
    {:continue, state}
  end

  # > To initiate an SSL-encrypted connection, the frontend initially sends an SSLRequest message
  # > rather than a StartupMessage. The server then responds with a single byte containing S or N,
  # > indicating that it is willing or unwilling to perform SSL, respectively.
  defp handle_messages([%M.SSLRequest{} | msgs], socket, state) do
    downstream("N", socket, state)
    handle_messages(msgs, socket, state)
  end

  # > To initiate a GSSAPI-encrypted connection, the frontend initially sends a GSSENCRequest
  # > message rather than a StartupMessage. The server then responds with a single byte containing G
  # > or N, indicating that it is willing or unwilling to perform GSSAPI encryption, respectively
  defp handle_messages([%M.GSSENCRequest{} | msgs], socket, state) do
    downstream("N", socket, state)
    handle_messages(msgs, socket, state)
  end

  # https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-CANCELING-REQUESTS
  # > To issue a cancel request, the frontend opens a new connection to the server and sends a
  # > CancelRequest message, rather than the StartupMessage message that would ordinarily be sent
  # > across a new connection. The server will process this request and then close the connection.
  # > For security reasons, no direct reply is made to the cancel request message.
  defp handle_messages([%M.CancelRequest{} | _msgs], _socket, state) do
    Logger.warning("Recieved unhandled CancelRequest message from client")
    {:close, state}
  end

  defp handle_messages([%M.StartupMessage{} = msg | msgs], socket, state) do
    case msg.params do
      %{"user" => username, "database" => database, "password" => password} ->
        if password == state.password do
          state = authenticated(socket, %{state | username: username, database: database})
          handle_messages(msgs, socket, state)
        else
          authentication_failed(username, socket, state)
        end

      %{"user" => username, "database" => database} ->
        Logger.warning("Not validating user #{inspect(username)}")
        salt = M.AuthenticationMD5Password.salt()
        msg = M.AuthenticationMD5Password.new(salt: salt)
        downstream([msg], socket, state)

        handle_messages(msgs, socket, %{
          state
          | username: username,
            database: database,
            authentication: {:md5, username, salt}
        })
    end
  end

  defp handle_messages([%M.GSSResponse{} = msg | msgs], socket, state) do
    case state.authentication do
      {:md5, username, salt} ->
        <<"md5", hash::binary-32, 0>> = msg.data

        if md5_auth_valid?(state.password, username, salt, hash) do
          handle_messages(msgs, socket, authenticated(socket, state))
        else
          authentication_failed(username, socket, state)
        end
    end
  end

  defp handle_messages([%M.Terminate{} | _msgs], _socket, state) do
    {:close, state}
  end

  defp handle_messages(msgs, socket, %{authenticated?: true} = state) do
    {:ok, injector, upstream_msgs, downstream_msgs} =
      Injector.recv_client(state.injector, msgs)

    :ok = upstream(upstream_msgs, state)
    :ok = downstream(downstream_msgs, socket, state)

    {:continue, %{state | injector: injector}}
  end

  defp md5_auth_valid?(password, username, salt, hash) do
    expected =
      password
      |> md5(username)
      |> md5(salt)

    expected == hash
  end

  defp md5(binary1, binary2) do
    Base.encode16(:crypto.hash(:md5, binary1 <> binary2), case: :lower)
  end

  defp authenticated(socket, state) do
    Logger.debug("Starting upstream connection: #{inspect(state.upstream)}")

    %{loader: {loader_module, loader_opts}, connector_config: connector_config} = state

    {:ok, loader_conn} = loader_module.connect(connector_config, loader_opts)

    {:ok, {stack, _state} = injector} =
      state.injector_opts
      |> Keyword.merge(loader: {loader_module, loader_conn})
      |> Injector.new(
        session_id: state.session_id,
        username: state.username,
        database: state.database
      )

    # allow the injector to configure the upstream connection.  required in order for prisma's
    # connections to the shadow db to ignore the default upstream database and actually connect
    # to this ephemeral db
    proxy_connector_config = Injector.Operation.upstream_connection(stack, connector_config)

    {:ok, pid} =
      UpstreamConnection.start_link(
        parent: self(),
        session_id: state.session_id,
        connector_config: proxy_connector_config
      )

    :ok = downstream([%M.AuthenticationOk{}], socket, state)

    %{state | connection: pid, authenticated?: true, injector: injector}
  end

  defp authentication_failed(username, socket, state) do
    # This response is wrong somehow -- psql doesn't respond in the way
    # it does when you enter the wrong password against a real db
    # Docs say that options are the various auth messages or an ErrorResponse
    # so maybe it's something about my ErrorResponse that's wrong?
    # https://www.postgresql.org/docs/current/errcodes-appendix.html

    Logger.warning("Password authentication for user '#{username}' failed")

    :ok =
      downstream(
        [
          %M.ErrorResponse{
            severity: "FATAL",
            message: "Password authentication failed for user \"#{username}\"",
            code: "28P01"
          }
        ],
        socket,
        state
      )

    {:close, state}
  end

  defp downstream(msgs, socket, state) do
    trace_send(:client, state.session_id, msgs)
    Socket.send(socket, PgProtocol.encode(msgs))
  end

  defp upstream(msgs, state) do
    trace_send(:server, state.session_id, msgs)
    GenServer.cast(state.connection, {:upstream, msgs})
  end
end
