defmodule Electric.Tenant.Supervisor do
  use Supervisor, restart: :transient

  require Logger

  def name(electric_instance_id, tenant_id) do
    Electric.Application.process_name(electric_instance_id, tenant_id, __MODULE__)
  end

  def name(%{electric_instance_id: electric_instance_id, tenant_id: tenant_id}) do
    name(electric_instance_id, tenant_id)
  end

  def start_link(opts) do
    config = Map.new(opts)
    Supervisor.start_link(__MODULE__, config, name: name(config))
  end

  @impl true
  def init(%{
        app_config: app_config,
        electric_instance_id: electric_instance_id,
        tenant_id: tenant_id,
        connection_opts: connection_opts,
        inspector: inspector,
        storage: storage
      }) do
    get_pg_version_fn = fn ->
      server = Electric.Connection.Manager.name(electric_instance_id, tenant_id)
      Electric.Connection.Manager.get_pg_version(server)
    end

    prepare_tables_mfa =
      {Electric.Postgres.Configuration, :configure_tables_for_replication!,
       [get_pg_version_fn, app_config.replication_opts.publication_name]}

    shape_log_collector =
      Electric.Replication.ShapeLogCollector.name(electric_instance_id, tenant_id)

    db_pool =
      Electric.Application.process_name(electric_instance_id, tenant_id, Electric.DbPool)

    shape_cache_opts = [
      electric_instance_id: electric_instance_id,
      tenant_id: tenant_id,
      storage: storage,
      inspector: inspector,
      prepare_tables_fn: prepare_tables_mfa,
      # TODO: move this to config
      chunk_bytes_threshold: Application.fetch_env!(:electric, :chunk_bytes_threshold),
      log_producer: shape_log_collector,
      consumer_supervisor:
        Electric.Shapes.ConsumerSupervisor.name(electric_instance_id, tenant_id),
      registry: Registry.ShapeChanges
    ]

    connection_manager_opts = [
      electric_instance_id: electric_instance_id,
      tenant_id: tenant_id,
      connection_opts: connection_opts,
      replication_opts: [
        publication_name: app_config.replication_opts.publication_name,
        try_creating_publication?: true,
        slot_name: app_config.replication_opts.slot_name,
        transaction_received:
          {Electric.Replication.ShapeLogCollector, :store_transaction, [shape_log_collector]},
        relation_received:
          {Electric.Replication.ShapeLogCollector, :handle_relation_msg, [shape_log_collector]}
      ],
      pool_opts: [
        name: db_pool,
        pool_size: app_config.pool_opts.size,
        types: PgInterop.Postgrex.Types
      ],
      timeline_opts: [
        tenant_id: tenant_id,
        persistent_kv: app_config.persistent_kv
      ],
      shape_cache_opts: shape_cache_opts
    ]

    children = [
      {Electric.Postgres.Inspector.EtsInspector,
       pool: db_pool, electric_instance_id: electric_instance_id, tenant_id: tenant_id},
      {Electric.Connection.Supervisor, connection_manager_opts}
    ]

    Supervisor.init(children, strategy: :one_for_one, auto_shutdown: :any_significant)
  end
end
