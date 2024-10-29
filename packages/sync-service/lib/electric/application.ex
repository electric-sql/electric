defmodule Electric.Application do
  use Application

  @process_registry_name Electric.Registry.Processes
  def process_registry, do: @process_registry_name

  @spec process_name(atom(), atom()) :: {:via, atom(), atom()}
  def process_name(electric_instance_id, module) when is_atom(module) do
    {:via, Registry, {@process_registry_name, {module, electric_instance_id}}}
  end

  @spec process_name(atom(), atom(), term()) :: {:via, atom(), {atom(), term()}}
  def process_name(electric_instance_id, module, id) when is_atom(module) do
    {:via, Registry, {@process_registry_name, {module, electric_instance_id, id}}}
  end

  @impl true
  def start(_type, _args) do
    :erlang.system_flag(:backtrace_depth, 50)

    config = configure()

    shape_log_collector = Electric.Replication.ShapeLogCollector.name(config.electric_instance_id)

    connection_manager_opts = [
      electric_instance_id: config.electric_instance_id,
      connection_opts: config.connection_opts,
      replication_opts: [
        publication_name: config.replication_opts.publication_name,
        try_creating_publication?: true,
        slot_name: config.replication_opts.slot_name,
        slot_temporary?: config.replication_opts.slot_temporary?,
        transaction_received:
          {Electric.Replication.ShapeLogCollector, :store_transaction, [shape_log_collector]},
        relation_received:
          {Electric.Replication.ShapeLogCollector, :handle_relation_msg, [shape_log_collector]}
      ],
      pool_opts: [
        name: Electric.DbPool,
        pool_size: config.pool_opts.size,
        types: PgInterop.Postgrex.Types
      ],
      persistent_kv: config.persistent_kv
    ]

    # The root application supervisor starts the core global processes, including the HTTP
    # server and the database connection manager. The latter is responsible for establishing
    # all needed connections to the database (acquiring the exclusive access lock, opening a
    # replication connection, starting a connection pool).
    #
    # Once there is a DB connection pool running, Connection.Manager will start the singleton
    # `Electric.Shapes.Supervisor` which is responsible for starting the shape log collector
    # and individual shape consumer process trees.
    #
    # See the moduledoc in `Electric.Connection.Supervisor` for more info.
    children =
      Enum.concat([
        [
          Electric.Telemetry,
          {Registry,
           name: @process_registry_name, keys: :unique, partitions: System.schedulers_online()},
          {Registry,
           name: Registry.ShapeChanges, keys: :duplicate, partitions: System.schedulers_online()},
          {Electric.Postgres.Inspector.EtsInspector, pool: Electric.DbPool},
          {Bandit,
           plug:
             {Electric.Plug.Router,
              storage: config.storage,
              registry: Registry.ShapeChanges,
              shape_cache: {Electric.ShapeCache, config.shape_cache_opts},
              get_service_status: &Electric.ServiceStatus.check/0,
              inspector: config.inspector,
              long_poll_timeout: 20_000,
              max_age: Application.fetch_env!(:electric, :cache_max_age),
              stale_age: Application.fetch_env!(:electric, :cache_stale_age),
              allow_shape_deletion: Application.get_env(:electric, :allow_shape_deletion, false)},
           port: Application.fetch_env!(:electric, :service_port),
           thousand_island_options: http_listener_options()}
        ],
        prometheus_endpoint(Application.fetch_env!(:electric, :prometheus_port)),
        [{Electric.Connection.Supervisor, connection_manager_opts}]
      ])

    Supervisor.start_link(children,
      strategy: :one_for_one,
      name: Electric.Supervisor
    )
  end

  # This function is called once in the application's start() callback. It reads configuration
  # from the OTP application env, runs some pre-processing functions and stores the processed
  # configuration as a single map using `:persistent_term`.
  defp configure do
    electric_instance_id = Application.fetch_env!(:electric, :electric_instance_id)

    {storage_module, storage_in_opts} = Application.fetch_env!(:electric, :storage)
    storage_opts = storage_module.shared_opts(storage_in_opts)
    storage = {storage_module, storage_opts}

    {kv_module, kv_fun, kv_params} = Application.fetch_env!(:electric, :persistent_kv)
    persistent_kv = apply(kv_module, kv_fun, [kv_params])

    replication_stream_id = Application.fetch_env!(:electric, :replication_stream_id)
    publication_name = "electric_publication_#{replication_stream_id}"
    slot_name = "electric_slot_#{replication_stream_id}"
    slot_temporary? = Application.get_env(:electric, :replication_slot_temporary?, false)

    get_pg_version_fn = fn ->
      Electric.Connection.Manager.get_pg_version(Electric.Connection.Manager)
    end

    prepare_tables_mfa =
      {Electric.Postgres.Configuration, :configure_tables_for_replication!,
       [get_pg_version_fn, publication_name]}

    inspector =
      {Electric.Postgres.Inspector.EtsInspector, server: Electric.Postgres.Inspector.EtsInspector}

    shape_cache_opts = [
      electric_instance_id: electric_instance_id,
      storage: storage,
      inspector: inspector,
      prepare_tables_fn: prepare_tables_mfa,
      chunk_bytes_threshold: Application.fetch_env!(:electric, :chunk_bytes_threshold),
      log_producer: Electric.Replication.ShapeLogCollector.name(electric_instance_id),
      consumer_supervisor: Electric.Shapes.ConsumerSupervisor.name(electric_instance_id),
      registry: Registry.ShapeChanges
    ]

    config = %Electric.Application.Configuration{
      electric_instance_id: electric_instance_id,
      storage: storage,
      persistent_kv: persistent_kv,
      connection_opts: Application.fetch_env!(:electric, :connection_opts),
      replication_opts: %{
        stream_id: replication_stream_id,
        publication_name: publication_name,
        slot_name: slot_name,
        slot_temporary?: slot_temporary?
      },
      pool_opts: %{
        size: Application.fetch_env!(:electric, :db_pool_size)
      },
      inspector: inspector,
      shape_cache_opts: shape_cache_opts
    }

    Electric.Application.Configuration.save(config)
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
    if Application.get_env(:electric, :listen_on_ipv6?, false) do
      [transport_options: [:inet6]]
    else
      []
    end
  end
end
