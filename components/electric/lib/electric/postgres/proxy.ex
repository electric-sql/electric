defmodule Electric.Postgres.Proxy do
  alias Electric.Postgres.Proxy.Handler
  alias Electric.Replication.Connectors

  require Logger

  @type options() :: [
          handler_config: Handler.options(),
          conn_config: Electric.Replication.Connectors.config()
        ]

  @spec child_spec(options()) :: Supervisor.child_spec()
  def child_spec(args) do
    {:ok, conn_config} = Keyword.fetch(args, :conn_config)
    handler_config = Keyword.get(args, :handler_config, [])

    proxy_opts = Connectors.get_proxy_opts(conn_config)

    {:ok, listen_opts} = Map.fetch(proxy_opts, :listen)

    if !is_integer(listen_opts[:port]),
      do:
        raise(ArgumentError,
          message: "Proxy configuration should include `[listen: [port: 1..65535]]`"
        )

    if log_level = proxy_opts[:log_level] do
      ThousandIsland.Logger.attach_logger(log_level)
    end

    handler_state =
      Handler.initial_state(conn_config, handler_config)

    Logger.info("Starting Proxy server listening at port #{listen_opts[:port]}")

    ThousandIsland.child_spec(
      Keyword.merge(listen_opts, handler_module: Handler, handler_options: handler_state)
    )
  end

  def session_id do
    System.unique_integer([:positive, :monotonic])
  end
end
