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
              conn_config: nil,
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
            conn_config: Connectors.config(),
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

  @spec initial_state(Electric.Replication.Connectors.config(), options()) :: S.t()
  def initial_state(conn_config, proxy_opts) do
    {loader, loader_opts} = Keyword.get(proxy_opts, :loader, {SchemaCache, []})
    password = conn_config |> get_in([:proxy, :password]) |> validate_password()

    %S{
      conn_config: conn_config,
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
    :ok = downstream(downstream_msgs, socket, state)
    {:noreply, {socket, %{state | injector: injector}}}
  end

  def handle_info({UpstreamConnection, :authenticated}, {socket, state}) do
    Logger.info("Upstream connection is ready to accept queries")
    {:noreply, {socket, state}}
  end

  # defp handle_messages(msgs, socket, state) do
  #   Enum.reduce(msgs, {:continue, state}, fn msg, {return, state} ->
  #     handle_authentication_message(msg, return, socket, state)
  #   end)
  # end

  defp handle_messages([], _socket, state) do
    {:continue, state}
  end

  defp handle_messages([%M.SSLRequest{} | msgs], socket, state) do
    downstream("N", socket, state)
    handle_messages(msgs, socket, state)
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
      # nil ->
      #   Logger.warning("Not validating authentication response #{inspect(msg)}")
      #   state = authenticated(socket, state)
      #   handle_messages(msgs, socket, state)

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

    %{loader: {loader_module, loader_opts}, conn_config: conn_config} = state

    {:ok, loader_conn} = loader_module.connect(conn_config, loader_opts)

    {:ok, injector} =
      state.injector_opts
      |> Keyword.merge(loader: {loader_module, loader_conn})
      |> Injector.new(
        session_id: state.session_id,
        username: state.username,
        database: state.database
      )

    {:ok, pid} =
      UpstreamConnection.start_link(
        parent: self(),
        session_id: state.session_id,
        conn_config: state.conn_config
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
