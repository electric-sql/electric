defmodule Electric.Application do
  @moduledoc false

  alias Electric.Replication.Connectors
  alias Electric.Replication.PostgresConnector

  use Application

  def start(_type, _args) do
    children = [
      Electric.Postgres.SchemaRegistry,
      Electric.Replication.VaxinePostgresOffsetStorage,
      {Registry, keys: :unique, name: Electric.PostgresSlotRegistry},
      {Registry, keys: :unique, name: Electric.StatusRegistry},
      {Plug.Cowboy, scheme: :http, plug: Electric.StatusPlug, options: [port: status_port()]},
      Electric.VaxRepo,
      Electric.PostgresServer.child_spec(port: postgres_server_port()),
      Electric.Satellite.ClientManager,
      Electric.Satellite.WsServer.child_spec([{:port, sqlite_server_port()}]),
      Electric.Replication.Connectors
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
