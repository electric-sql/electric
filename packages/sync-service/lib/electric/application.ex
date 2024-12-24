defmodule Electric.Application do
  use Application

  require Logger

  @doc """
  This callback starts the entire application, but is configured to run only when
  this app is started on it's own, not as a library. As such, this should be the only
  place that actually reads from `Application.get_env/2`, because it's the only context
  where the `config/runtime.exs` is executed.
  """
  @impl true
  def start(_type, _args) do
    :erlang.system_flag(:backtrace_depth, 50)

    Electric.Config.ensure_instance_id()
    Electric.Telemetry.Sentry.add_logger_handler()

    # We have "instance id" identifier as the node ID, however that's generated every runtime,
    # so isn't stable across restarts. Our storages however scope themselves based on this stack ID
    # so we're just hardcoding it here.
    stack_id = Electric.Config.get_env(:provided_database_id)

    storage = Electric.Config.get_env(:storage)

    router_opts =
      [
        long_poll_timeout: 20_000,
        max_age: Electric.Config.get_env(:cache_max_age),
        stale_age: Electric.Config.get_env(:cache_stale_age),
        allow_shape_deletion: Electric.Config.get_env(:allow_shape_deletion?)
      ] ++
        Electric.StackSupervisor.build_shared_opts(
          stack_id: stack_id,
          stack_events_registry: Registry.StackEvents,
          storage: storage
        )

    {kv_module, kv_fun, kv_params} =
      Electric.Config.get_env(:persistent_kv)

    persistent_kv = apply(kv_module, kv_fun, [kv_params])
    replication_stream_id = Electric.Config.get_env(:replication_stream_id)
    publication_name = "electric_publication_#{replication_stream_id}"
    slot_name = "electric_slot_#{replication_stream_id}"

    # The root application supervisor starts the core global processes, including the HTTP
    # server and the database connection manager. The latter is responsible for establishing
    # all needed connections to the database (acquiring the exclusive access lock, opening a
    # replication connection, starting a connection pool).
    #
    # Once there is a DB connection pool running, Connection.Manager will start the singleton
    # `Electric.Replication.Supervisor` which is responsible for starting the shape log collector
    # and individual shape consumer process trees.
    #
    # See the moduledoc in `Electric.Connection.Supervisor` for more info.
    children =
      Enum.concat([
        [
          {Registry, name: Registry.StackEvents, keys: :duplicate},
          {
            Electric.StackSupervisor,
            stack_id: stack_id,
            stack_events_registry: Registry.StackEvents,
            connection_opts: Electric.Config.fetch_env!(:connection_opts),
            persistent_kv: persistent_kv,
            replication_opts: [
              publication_name: publication_name,
              slot_name: slot_name,
              slot_temporary?: Electric.Config.get_env(:replication_slot_temporary?)
            ],
            pool_opts: [pool_size: Electric.Config.get_env(:db_pool_size)],
            storage: storage,
            chunk_bytes_threshold: Electric.Config.get_env(:chunk_bytes_threshold)
          },
          {Electric.Telemetry, stack_id: stack_id, storage: storage},
          {Bandit,
           plug: {Electric.Plug.Router, router_opts},
           port: Electric.Config.get_env(:service_port),
           thousand_island_options: http_listener_options()}
        ],
        prometheus_endpoint(Electric.Config.get_env(:prometheus_port))
      ])

    app_vsn = Application.spec(:electric, :vsn)
    Logger.info("Starting ElectricSQL #{app_vsn}")

    Supervisor.start_link(children, strategy: :one_for_one, name: Electric.Supervisor)
  end

  defp prometheus_endpoint(nil), do: []

  defp prometheus_endpoint(port) do
    [
      {
        Bandit,
        plug: {Electric.Plug.UtilityRouter, []},
        port: port,
        thousand_island_options: http_listener_options()
      }
    ]
  end

  defp http_listener_options do
    if Electric.Config.get_env(:listen_on_ipv6?) do
      [transport_options: [:inet6]]
    else
      []
    end
  end
end
