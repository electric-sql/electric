defmodule Electric.Supervisor do
  use Supervisor

  def start_link(opts) do
    config = Map.new(opts)
    Supervisor.start_link(__MODULE__, config, name: Access.fetch!(opts, :name))
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
    # TODO: later add electric instance ID once we decided what it will be
    stack_id = tenant_id

    # This is a name of the ShapeLogCollector process
    shape_log_collector =
      Electric.Replication.ShapeLogCollector.name(stack_id)

    db_pool =
      Electric.ProcessRegistry.name(stack_id, Electric.DbPool)

    get_pg_version_fn = fn ->
      server = Electric.Connection.Manager.name(stack_id)
      Electric.Connection.Manager.get_pg_version(server)
    end

    prepare_tables_mfa =
      {
        Electric.Postgres.Configuration,
        :configure_tables_for_replication!,
        # FIXME: App config is not a thing
        [get_pg_version_fn, app_config.replication_opts.publication_name]
      }

    # FIXME: should be passed in as a parameter
    chunk_bytes_threshold = Application.fetch_env!(:electric, :chunk_bytes_threshold)

    shape_changes_registry_name = :"#{Registry.ShapeChanges}:#{stack_id}"

    shape_cache_opts = [
      stack_id: stack_id,
      # Passed in, should be built here instead
      storage: storage,
      # Passed in, should be built there instead
      inspector: inspector,
      prepare_tables_fn: prepare_tables_mfa,
      chunk_bytes_threshold: chunk_bytes_threshold,
      log_producer: shape_log_collector,
      consumer_supervisor:
        Electric.Shapes.ConsumerSupervisor.name(stack_id),
      registry: shape_changes_registry_name
    ]

    new_connection_manager_opts = [
      stack_id: stack_id,
      # Coming from the outside, need validation
      connection_opts: connection_opts,
      replication_opts: [
        # FIXME: App config is not a thing
        publication_name: app_config.replication_opts.publication_name,
        # Does this need to be exposed as a config option?
        try_creating_publication?: true,
        # FIXME: App config is not a thing
        slot_name: app_config.replication_opts.slot_name,
        # FIXME: App config is not a thing
        slot_temporary?: app_config.replication_opts.slot_temporary?,
        transaction_received:
          {Electric.Replication.ShapeLogCollector, :store_transaction, [shape_log_collector]},
        relation_received:
          {Electric.Replication.ShapeLogCollector, :handle_relation_msg, [shape_log_collector]}
      ],
      pool_opts: [
        name: db_pool,
        # FIXME: App config is not a thing
        pool_size: app_config.pool_opts.size,
        types: PgInterop.Postgrex.Types
      ],
      # Replaced `tenant_id`, needs updating
      timeline_opts: [
        stack_id: stack_id,
        persistent_kv: app_config.persistent_kv
      ],
      shape_cache_opts: shape_cache_opts
    ]

    new_children = [
      {Electric.ProcessRegistry, partitions: System.schedulers_online(), stack_id: stack_id},
      {Registry,
       name: shape_changes_registry_name,
       keys: :duplicate,
       partitions: System.schedulers_online()},
      {Electric.Postgres.Inspector.EtsInspector, stack_id: stack_id, pool: db_pool},
      {Electric.Connection.Supervisor, new_connection_manager_opts}
    ]

    Supervisor.init(new_children, strategy: :one_for_one, auto_shutdown: :any_significant)
  end
end
