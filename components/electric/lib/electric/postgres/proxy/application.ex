defmodule Electric.Postgres.Proxy.Application do
  @moduledoc false

  use Application

  alias Electric.Postgres.Proxy

  @impl true
  def start(_type, _args) do
    pg_config =
      Application.fetch_env!(:electric_pg_proxy, Electric.Postgres.Proxy.UpstreamConnection)

    proxy_config =
      Application.fetch_env!(:electric_pg_proxy, Electric.Postgres.Proxy.Handler)

    children =
      [
        Proxy.SASL.SCRAMLockedCache,
        {Electric.Postgres.Proxy.VerifyUpstreamConnection, pg_config},
        {Proxy, proxy: proxy_config, postgres: pg_config}
      ]

    opts = [strategy: :one_for_one, name: Electric.Postgres.Proxy.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
