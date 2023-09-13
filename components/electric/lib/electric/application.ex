defmodule Electric.Application do
  @moduledoc false

  use Application

  alias Electric.Replication.PostgresConnector

  def start(_type, _args) do
    children = [
      Electric.Telemetry,
      Electric.Postgres.OidDatabase,
      Electric.Satellite.SubscriptionManager,
      Electric.Satellite.ClientManager,
      {Electric.Replication.Connectors, pg_connectors()},
      {ThousandIsland,
       port: pg_server_port(), handler_module: Electric.Replication.Postgres.TcpServer}
    ]

    children =
      children ++
        unless Application.get_env(:electric, :disable_listeners, false) do
          [
            # Satellite websocket connections are served from this router
            {Bandit, plug: Electric.Plug.Router, port: http_port()}
          ]
        else
          []
        end

    Supervisor.start_link(children, strategy: :one_for_one, name: Electric.Supervisor)
  end

  defp http_port, do: Application.fetch_env!(:electric, :http_port)
  defp pg_server_port, do: Application.fetch_env!(:electric, :pg_server_port)

  defp pg_connectors do
    for {name, config} <- Application.get_env(:electric, Electric.Replication.Connectors, []) do
      {PostgresConnector, Keyword.put(config, :origin, to_string(name))}
    end
  end
end
