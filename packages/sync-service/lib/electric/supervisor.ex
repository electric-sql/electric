defmodule Electric.Supervisor do
  use Supervisor

  @opts_schema NimbleOptions.new!(
                 name: [type: :any, required: false],
                 stack_id: [type: :string, required: true],
                 persistent_kv: [type: :any, required: true],
                 connection_opts: [
                   type: :keyword_list,
                   required: true,
                   keys: [
                     hostname: [type: :string, required: true],
                     port: [type: :integer, required: true],
                     database: [type: :string, required: true],
                     username: [type: :string, required: true],
                     password: [type: {:fun, 0}, required: true],
                     sslmode: [type: :atom, required: true],
                     ipv6: [type: :boolean, required: true]
                   ]
                 ],
                 replication_opts: [
                   type: :keyword_list,
                   required: true,
                   keys: [
                     publication_name: [type: :string, required: true],
                     slot_name: [type: :string, required: true],
                     slot_temporary?: [type: :boolean, default: false],
                     try_creating_publication?: [type: :boolean, default: true],
                     stream_id: [type: :string, required: false]
                   ]
                 ],
                 pool_opts: [type: :keyword_list, required: true],
                 storage: [type: :mod_arg, required: true]
               )

  def start_link(opts) do
    with {:ok, config} <- NimbleOptions.validate(Map.new(opts), @opts_schema) do
      Supervisor.start_link(__MODULE__, config, Keyword.take(opts, [:name]))
    end
  end

  def build_shared_opts(opts) do
    # needs validation
    opts = Map.new(opts)
    stack_id = opts[:stack_id]

    shape_changes_registry_name = :"#{Registry.ShapeChanges}:#{stack_id}"

    shape_cache =
      Access.get(
        opts,
        :shape_cache,
        {Electric.ShapeCache, stack_id: stack_id, server: Electric.ShapeCache.name(stack_id)}
      )

    inspector =
      Access.get(
        opts,
        :inspector,
        {Electric.Postgres.Inspector.EtsInspector,
         stack_id: stack_id,
         server: Electric.Postgres.Inspector.EtsInspector.name(stack_id: stack_id)}
      )

    [
      shape_cache: shape_cache,
      registry: shape_changes_registry_name,
      storage: storage_mod_arg(opts),
      inspector: inspector
    ]
  end

  defp storage_mod_arg(%{stack_id: stack_id, storage: {mod, arg}}) do
    {mod, arg |> Keyword.put(:stack_id, stack_id) |> mod.shared_opts()}
  end

  @impl true
  def init(%{stack_id: stack_id} = config) do
    inspector =
      Access.get(
        config,
        :inspector,
        {Electric.Postgres.Inspector.EtsInspector,
         stack_id: stack_id,
         server: Electric.Postgres.Inspector.EtsInspector.name(stack_id: stack_id)}
      )

    storage = storage_mod_arg(config)

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
        [get_pg_version_fn, config.replication_opts[:publication_name]]
      }

    # FIXME: should be passed in as a parameter
    chunk_bytes_threshold = Application.fetch_env!(:electric, :chunk_bytes_threshold)

    shape_changes_registry_name = :"#{Registry.ShapeChanges}:#{stack_id}"

    shape_cache_opts = [
      stack_id: stack_id,
      storage: storage,
      inspector: inspector,
      prepare_tables_fn: prepare_tables_mfa,
      chunk_bytes_threshold: chunk_bytes_threshold,
      log_producer: shape_log_collector,
      consumer_supervisor: Electric.Shapes.ConsumerSupervisor.name(stack_id),
      registry: shape_changes_registry_name
    ]

    new_connection_manager_opts = [
      stack_id: stack_id,
      # Coming from the outside, need validation
      connection_opts: config.connection_opts,
      replication_opts:
        [
          transaction_received:
            {Electric.Replication.ShapeLogCollector, :store_transaction, [shape_log_collector]},
          relation_received:
            {Electric.Replication.ShapeLogCollector, :handle_relation_msg, [shape_log_collector]}
        ] ++ config.replication_opts,
      pool_opts:
        [
          name: db_pool,
          types: PgInterop.Postgrex.Types
        ] ++ config.pool_opts,
      # Replaced `tenant_id`, needs updating
      timeline_opts: [
        stack_id: stack_id,
        persistent_kv: config.persistent_kv
      ],
      shape_cache_opts: shape_cache_opts
    ]

    new_children = [
      {Electric.ProcessRegistry, partitions: System.schedulers_online(), stack_id: stack_id},
      {Registry,
       name: shape_changes_registry_name, keys: :duplicate, partitions: System.schedulers_online()},
      {Electric.Postgres.Inspector.EtsInspector, stack_id: stack_id, pool: db_pool},
      {Electric.Connection.Supervisor, new_connection_manager_opts}
    ]

    Supervisor.init(new_children, strategy: :one_for_one, auto_shutdown: :any_significant)
  end
end
