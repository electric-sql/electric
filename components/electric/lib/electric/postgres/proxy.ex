defmodule Electric.Postgres.Proxy do
  @moduledoc """
  An intelligent proxy for capturing and validating migrations from the client.

  ## Responsibilities

  1. Capture any DDL commands affecting electrified tables and write them into
     the replication stream to electric,
  2. Translate the Electric DDLX commands to the associated procedure calls,
  3. Assign a version to migrations affecting electrified tables,
  4. Validate migrations on electrified tables, ensuring that they are compatible
     with the data type and schema-modification limitations of electric.

  ## Structure

  The proxy operates as a TCP listener on the configured `PG_PROXY_PORT` port
  based on `ThousandIsland` and using a handler module
  `Electric.Postgres.Proxy.Handler`.

  This handler speaks enough of the pg client-server protocol to authenticate
  the client connection using one of a set of pre-defined usernames and a
  single password configured via the `PG_PROXY_PASSWORD` environment variable.

  Once authenticated, the handler launches a TCP connection to the real PG
  server and authenticates itself using the real db credentials used by the
  rest of the application. This server/upstream connection process again just
  speaks enough of the PG client-server protocol to authenticate itself.

  Once the two connections are established and authenticated, the proxy is then
  able to handle normal client operations, as detailed below.

  ## Operation

  The proxy operation can be seen as reacting to messages from the client.
  These messages may trigger a set of secondary, internal operations, which are
  executed in sequence between the proxy and the server, with the results
  hidden from the client.

  In this diagram a message is signified by a letter, e.g. `A` and the response
  from the pg server to that message by e.g. `A*` (a message may mean multiple
  individual `PgProtocol` structs).

          client    proxy    server
            A   --->  A  --->  A
                      A* <---  A*
                      B  --->  B
                      B* <---  B*
                      C  --->  C
                      C* <---  C*
            A*  <---  A*

  So to the client it sent `A` and got back `A*` as expected, it just may have
  taken a bit more time as the proxy coordinated and managed the sequence of
  secondary cascading messages resulting from `A`, e.g. in the case of altering
  an electrified table, the messages `B`, `C` etc would be

  1. capturing the DDL statement altering the table,
  2. issuing the required procedure calls to modify the associated shadow
     tables, and
  3. assigning the migration a version, either captured from the framework or
     randomly generated.

  Because we cascade multiple messages off of a single query from the client,
  it's essential that all queries from the client are run within a transaction.
  If the client does not issue a `BEGIN` statement before running any query,
  the proxy will generate the requisite `BEGIN` and `COMMIT` statements
  bracketing the client's original query, so in the diagram above there may be
  some `a` and `a*` query coming from the proxy before it sends `A` to the
  server and an associated `z` and `z*` `COMMIT` message after the `C`
  message-response (before the client is sent the original `A*` response).

  For the details of the protocol managing this see
  `Electric.Postgres.Proxy.Injector.Operation`.

  This interaction is managed by the `Electric.Postgres.Proxy.Injector` module,
  which uses some top-level operation implementation to describe the high-level
  behaviour.

  Currently there are 3 defined behaviours:
  1. `Electric.Postgres.Proxy.Injector.Electric` which is the normal migration
     proxy as described above. To activate this behaviour you connect to the
     proxy using the `electric` username.

  2. `Electric.Postgres.Proxy.Injector.Prisma` which should be used when
     generating the client models. This returns introspection information based
     on the current electrified schema information. Activate this mode by using
     the username `prisma` in your db connection settings.

  3. `Electric.Postgres.Proxy.Injector.Transparent` which is a
     debug/development only mode which just allows for introspection of the
     messages being sent between the client and server. You can activate this
     using the `transparent` username.
  """

  alias Electric.Postgres.Proxy.{Injector, Handler}
  alias Electric.Replication.Connectors

  require Logger

  @type options() :: [
          handler_config: Handler.options(),
          conn_config: Electric.Replication.Connectors.config()
        ]

  @spec child_spec(options()) :: Supervisor.child_spec()
  def child_spec(args) do
    {:ok, conn_config} = Keyword.fetch(args, :conn_config)

    proxy_opts = Connectors.get_proxy_opts(conn_config)
    {:ok, listen_opts} = Map.fetch(proxy_opts, :listen)

    if !is_integer(listen_opts[:port]),
      do:
        raise(ArgumentError,
          message: "Proxy configuration should include `[listen: [port: 1..65535]]`"
        )

    # TODO: enabling logging of tcp connections to the proxy triggers failures in the e2e
    # tests because thousandisland reports broken connections with an "error" string
    # if log_level = proxy_opts[:log_level] do
    #   ThousandIsland.Logger.attach_logger(log_level)
    # end

    handler_config = Keyword.get(args, :handler_config, default_handler_config())
    handler_state = Handler.initial_state(conn_config, handler_config)

    Logger.info("Starting Proxy server listening on port #{listen_opts[:port]}")

    ThousandIsland.child_spec(
      Keyword.merge(listen_opts, handler_module: Handler, handler_options: handler_state)
    )
  end

  def session_id do
    System.unique_integer([:positive, :monotonic])
  end

  @doc """
  Configuration to enable the migration capturing proxy and the prisma
  introspection mode.
  """
  def default_handler_config do
    [
      injector: [
        capture_mode: [
          default: Injector.Electric,
          per_user: %{
            "prisma" => Injector.Prisma,
            "transparent" => Injector.Transparent
          }
        ]
      ]
    ]
  end
end
