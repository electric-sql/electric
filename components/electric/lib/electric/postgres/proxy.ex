defmodule Electric.Postgres.Proxy do
  alias Electric.Postgres.Proxy.Handler

  @type options() :: [
          handler_config: Handler.options(),
          conn_config: Electric.Replication.Connectors.config()
        ]

  @spec child_spec(options()) :: Supervisor.child_spec()
  def child_spec(args) do
    default_proxy_config =
      Application.fetch_env!(:electric, Electric.Postgres.Proxy)

    proxy_config = Keyword.merge(default_proxy_config, Keyword.get(args, :proxy, []))

    handler_defaults =
      Application.get_env(:electric, Electric.Postgres.Proxy.Handler, [])

    # config for the handler
    handler_config = Keyword.get(args, :handler_config, [])

    {:ok, conn_config} = Keyword.fetch(args, :conn_config)

    handler_state =
      Handler.initial_state(conn_config, Keyword.merge(handler_defaults, handler_config))

    ThousandIsland.child_spec(
      Keyword.merge(proxy_config, handler_module: Handler, handler_options: handler_state)
    )
  end

  def session_id do
    System.unique_integer([:positive, :monotonic])
  end
end
