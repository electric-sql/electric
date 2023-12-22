defmodule Electric.Application do
  @moduledoc false

  use Application

  alias Electric.Replication.Connectors
  alias Electric.Replication.PostgresConnector

  require Logger

  def start(_type, _args) do
    children = [
      Electric.Telemetry,
      Electric.Features,
      Electric.Postgres.OidDatabase,
      Electric.Postgres.Proxy.SASL.SCRAMLockedCache,
      Electric.Satellite.SubscriptionManager,
      Electric.Satellite.ClientManager,
      Electric.Replication.Connectors
    ]

    children =
      children ++
        if Electric.write_to_pg_mode() == :logical_replication do
          [
            {ThousandIsland,
             [port: pg_server_port(), handler_module: Electric.Replication.Postgres.TcpServer] ++
               listener_opts()}
          ]
        else
          []
        end

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

    app_vsn = Application.spec(:electric, :vsn)
    write_to_pg_mode = Electric.write_to_pg_mode()
    Logger.info("Starting ElectricSQL #{app_vsn} in #{write_to_pg_mode} mode.")

    opts = [strategy: :one_for_one, name: Electric.Supervisor]
    {:ok, supervisor} = Supervisor.start_link(children, opts)

    Application.get_env(:electric, Electric.Replication.Connectors, [])
    |> Enum.each(fn {name, config} ->
      Connectors.start_connector(
        PostgresConnector,
        config
        |> Keyword.put(:origin, to_string(name))
        |> Keyword.put(:write_to_pg_mode, write_to_pg_mode)
      )
    end)

    {:ok, supervisor}
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
