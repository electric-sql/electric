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
      connection_opts: config.connection_opts,
      replication_opts: [
        publication_name: config.replication_opts.publication_name,
        try_creating_publication?: true,
        slot_name: config.replication_opts.slot_name,
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
      timeline_opts: [
        shape_cache: {Electric.ShapeCache, []},
        persistent_kv: config.persistent_kv
      ]
    ]

    children =
      [
        Electric.Telemetry,
        {Registry,
         name: @process_registry_name, keys: :unique, partitions: System.schedulers_online()},
        {Registry,
         name: Registry.ShapeChanges, keys: :duplicate, partitions: System.schedulers_online()},
        {Electric.Connection.Supervisor, connection_manager_opts},
        {Electric.Postgres.Inspector.EtsInspector, pool: Electric.DbPool},
        {Bandit,
         plug:
           {Electric.Plug.Router,
            storage: config.storage,
            registry: Registry.ShapeChanges,
            shape_cache: config.child_specs.shape_cache,
            get_service_status: &Electric.ServiceStatus.check/0,
            inspector: config.inspector,
            long_poll_timeout: 20_000,
            max_age: Application.fetch_env!(:electric, :cache_max_age),
            stale_age: Application.fetch_env!(:electric, :cache_stale_age),
            allow_shape_deletion: Application.get_env(:electric, :allow_shape_deletion, false)},
         port: Application.fetch_env!(:electric, :service_port),
         thousand_island_options: http_listener_options()}
      ]
      |> add_prometheus_router(Application.fetch_env!(:electric, :prometheus_port))

    Supervisor.start_link(children,
      strategy: :one_for_one,
      name: Electric.Supervisor
    )
  end

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

    get_pg_version_fn = fn ->
      Electric.ConnectionManager.get_pg_version(Electric.ConnectionManager)
    end

    prepare_tables_mfa =
      {Electric.Postgres.Configuration, :configure_tables_for_replication!,
       [get_pg_version_fn, publication_name]}

    inspector =
      {Electric.Postgres.Inspector.EtsInspector, server: Electric.Postgres.Inspector.EtsInspector}

    shape_cache_spec =
      {Electric.ShapeCache,
       electric_instance_id: electric_instance_id,
       storage: storage,
       inspector: inspector,
       prepare_tables_fn: prepare_tables_mfa,
       chunk_bytes_threshold: Application.fetch_env!(:electric, :chunk_bytes_threshold),
       log_producer: Electric.Replication.ShapeLogCollector.name(electric_instance_id),
       consumer_supervisor: Electric.Shapes.ConsumerSupervisor.name(electric_instance_id),
       registry: Registry.ShapeChanges}

    config = %Electric.Application.Configuration{
      electric_instance_id: electric_instance_id,
      storage: storage,
      persistent_kv: persistent_kv,
      connection_opts: Application.fetch_env!(:electric, :connection_opts),
      replication_opts: %{
        stream_id: replication_stream_id,
        publication_name: publication_name,
        slot_name: slot_name
      },
      pool_opts: %{
        size: Application.fetch_env!(:electric, :db_pool_size)
      },
      inspector: inspector,
      child_specs: %{
        shape_cache: shape_cache_spec
      }
    }

    Electric.Application.Configuration.save(config)
  end

  defp add_prometheus_router(children, nil), do: children

  defp add_prometheus_router(children, port) do
    children ++
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
