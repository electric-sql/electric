defmodule Electric.Application do
  @moduledoc false

  alias Electric.Replication.Connectors
  alias Electric.Replication.PostgresConnector

  use Application

  def start(_type, _args) do
    children = [
      Electric.Telemetry,
      Electric.Features,
      Electric.Postgres.OidDatabase,
      Electric.Postgres.Proxy.SASL.SCRAMLockedCache,
      Electric.Satellite.SubscriptionManager,
      Electric.Satellite.ClientManager,
      Electric.Replication.Connectors,
      {ThousandIsland,
       [port: pg_server_port(), handler_module: Electric.Replication.Postgres.TcpServer] ++
         listener_opts()}
    ]

    children =
      children ++
        unless Application.get_env(:electric, :disable_listeners, false) do
          [
            # Satellite websocket connections are served from this router
            {Bandit,
             plug: Electric.Plug.Router,
             port: http_port(),
             thousand_island_options: listener_opts()}
          ]
        else
          []
        end

    opts = [strategy: :one_for_one, name: Electric.Supervisor]
    {:ok, supervisor} = Supervisor.start_link(children, opts)

    Application.get_env(:electric, Electric.Replication.Connectors, [])
    |> Enum.each(fn {name, config} ->
      Connectors.start_connector(
        PostgresConnector,
        config
        |> Keyword.put(:origin, to_string(name))
        |> Keyword.put(:write_to_pg_mode, Electric.write_to_pg_mode())
      )
    end)

    {:ok, supervisor}
  end

  def pg_connection_opts() do
    # NOTE(alco): Intentionally making the assumption here that there's only a single connector configured.
    # With Vaxine and multi-master PG replication going away, this is going to become the new reality soon.

    case Application.get_env(:electric, Electric.Replication.Connectors, []) do
      [{name, config}] -> Keyword.put(config, :origin, to_string(name))
      [] -> raise "Electric isn't meant to be ran without a connection to PostgreSQL"
    end
  end

  defp http_port, do: Application.fetch_env!(:electric, :http_port)
  defp pg_server_port, do: Application.fetch_env!(:electric, :pg_server_port)

  defp listener_opts do
    use_ipv6? = Application.get_env(:electric, :listen_on_ipv6?, false)

    if use_ipv6? do
      [transport_options: [:inet6]]
    else
      []
    end
  end
end
