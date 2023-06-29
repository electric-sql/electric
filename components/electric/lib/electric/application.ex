defmodule Electric.Application do
  @moduledoc false

  alias Electric.Replication.Connectors
  alias Electric.Replication.PostgresConnector

  use Application

  def start(_type, _args) do
    auth_provider = Electric.Satellite.Auth.provider()

    # NOTE(alco): Intentionally making the assumption here that there's only a single connector configured.
    # With Vaxine and multi-master PG replication going away, this is going to become the new reality soon.
    postgres_connector_opts =
      case Application.get_env(:electric, Electric.Replication.Connectors, []) do
        [{name, config}] -> Keyword.put(config, :origin, to_string(name))
        [] -> []
      end

    children = [
      Electric.Telemetry,
      Electric.Postgres.OidDatabase,
      Electric.Postgres.SchemaRegistry,
      Electric.Replication.OffsetStorage,
      {Plug.Cowboy, scheme: :http, plug: Electric.Plug.Router, options: [port: status_port()]},
      Electric.Satellite.ClientManager,
      Electric.Replication.Connectors,
      Electric.Satellite.WsServer.child_spec(
        port: sqlite_server_port(),
        auth_provider: auth_provider,
        pg_connector_opts: postgres_connector_opts
      ),
      Electric.PostgresServer.child_spec(port: postgres_server_port())
    ]

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

  defp status_port(),
    do: Application.fetch_env!(:electric, Electric.StatusPlug) |> Keyword.fetch!(:port)

  defp sqlite_server_port(),
    do:
      Application.get_env(:electric, Electric.Satellite.WsServer, [])
      |> Keyword.get(:port, 5133)

  defp postgres_server_port(),
    do:
      Application.get_env(:electric, Electric.PostgresServer, [])
      |> Keyword.get(:port, 5433)
end
