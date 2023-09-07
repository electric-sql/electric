defmodule Electric.Application do
  @moduledoc false

  alias Electric.Replication.Connectors
  alias Electric.Replication.PostgresConnector

  use Application

  def start(_type, _args) do
    children = [
      Electric.Telemetry,
      Electric.Postgres.OidDatabase,
      Electric.Replication.OffsetStorage,
      Electric.Satellite.SubscriptionManager,
      Electric.Satellite.ClientManager,
      Electric.Replication.Connectors,
      {ThousandIsland,
       port: pg_server_port(),
       handler_module: Electric.Replication.Postgres.TcpServer,
       num_acceptors: 5}
    ]

    children =
      children ++
        unless Application.get_env(:electric, :disable_listeners, false) do
          [
            # Satellite websocket connections are served from this router
            {Bandit,
             plug: Electric.Plug.Router,
             port: ws_server_port(),
             thousand_island_options: [num_acceptors: 5]}
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
        Keyword.put(config, :origin, to_string(name))
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

  defp ws_server_port,
    do:
      Application.fetch_env!(:electric, Electric.Satellite.WebsocketServer)
      |> Keyword.fetch!(:port)

  defp pg_server_port,
    do: Application.fetch_env!(:electric, Electric.PostgresServer) |> Keyword.fetch!(:port)
end
