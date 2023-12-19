defmodule Electric.Application do
  @moduledoc false

  use Application

  alias Electric.Replication.Connectors
  alias Electric.Replication.PostgresConnector

  require Logger

  def start(_type, _args) do
    children =
      [
        Electric.Telemetry,
        Electric.Features,
        Electric.Postgres.OidDatabase,
        Electric.Postgres.Proxy.SASL.SCRAMLockedCache,
        Electric.Satellite.SubscriptionManager,
        Electric.Satellite.ClientManager,
        Electric.Replication.Connectors
      ]
      |> maybe_add_child(
        if Electric.write_to_pg_mode() == :logical_replication do
          child_id = :replication_tcp_server_listener

          opts =
            [
              supervisor_options: [name: child_id],
              port: pg_server_port(),
              handler_module: Electric.Replication.Postgres.TcpServer
            ] ++ listener_opts()

          sup_spec(ThousandIsland, child_id, opts)
        end
      )
      |> maybe_add_child(
        unless Application.get_env(:electric, :disable_listeners, false) do
          child_id = :root_http_router_listener

          opts = [
            # Satellite websocket connections are served from this router
            plug: Electric.Plug.Router,
            port: http_port(),
            thousand_island_options: [supervisor_options: [name: child_id]] ++ listener_opts()
          ]

          sup_spec(Bandit, child_id, opts)
        end
      )

    app_vsn = Application.spec(:electric, :vsn)
    write_to_pg_mode = Electric.write_to_pg_mode()
    Logger.info("Starting ElectricSQL #{app_vsn} in #{write_to_pg_mode} mode.")

    opts = [strategy: :one_for_one, name: Electric.Supervisor]

    with {:ok, supervisor} <- Supervisor.start_link(children, opts) do
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
    |> log_supervisor_startup_error()
  end

  defp maybe_add_child(children, nil), do: children
  defp maybe_add_child(children, child_spec), do: children ++ [child_spec]

  defp sup_spec(module, id, opts) do
    %{
      id: {module, id},
      start: {module, :start_link, [opts]},
      type: :supervisor,
      restart: :permanent
    }
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

  defp log_supervisor_startup_error({:ok, _sup_pid} = ok), do: ok

  defp log_supervisor_startup_error(
         {:error, {:shutdown, {:failed_to_start_child, child_id, reason}}} = error
       ) do
    _ = log_child_error(child_id, reason)
    error
  end

  @spec log_child_error({atom, atom}, term) :: no_return
  defp log_child_error(
         {ThousandIsland, :replication_tcp_server_listener},
         {:shutdown, {:failed_to_start_child, :listener, :eaddrinuse}}
       ) do
    Electric.Errors.print_fatal_error(
      :init,
      "Failed to open a socket to listen for PG connection on port #{pg_server_port()}.",
      "Another instance of Electric or a different application is already listening on the same port."
    )
  end

  defp log_child_error(
         {Bandit, :root_http_router_listener},
         {:shutdown, {:failed_to_start_child, :listener, :eaddrinuse}}
       ) do
    Electric.Errors.print_fatal_error(
      :init,
      "Failed to open a socket to listen for HTTP/WebSocket connections on port #{http_port()}.",
      "Another instance of Electric or a different application is already listening on the same port."
    )
  end
end
