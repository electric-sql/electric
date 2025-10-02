defmodule Electric.CoreSupervisor do
  use Supervisor, restart: :transient, significant: true

  alias Electric.ShapeCache.LogChunker

  require Logger

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts)
  end

  @impl true
  def init(%{stack_id: stack_id} = config) do
    Process.set_label({:core_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    shape_log_collector = Electric.Replication.ShapeLogCollector.name(stack_id)

    storage = storage_mod_arg(config)

    inspector =
      Access.get(
        config,
        :inspector,
        {Electric.Postgres.Inspector.EtsInspector,
         stack_id: stack_id,
         server: Electric.Postgres.Inspector.EtsInspector.name(stack_id: stack_id)}
      )

    shape_hibernate_after = Keyword.fetch!(config.tweaks, :shape_hibernate_after)

    shape_cache_opts = [
      stack_id: stack_id,
      storage: storage,
      inspector: inspector,
      publication_manager: {Electric.Replication.PublicationManager, stack_id: stack_id},
      chunk_bytes_threshold: config.chunk_bytes_threshold,
      log_producer: shape_log_collector,
      consumer_supervisor: Electric.Shapes.DynamicConsumerSupervisor.name(stack_id),
      registry: :"#{inspect(Registry.ShapeChanges)}:#{stack_id}",
      shape_hibernate_after: shape_hibernate_after
    ]

    new_connection_manager_opts = [
      stack_id: stack_id,
      # Coming from the outside, need validation
      connection_opts: config.connection_opts,
      stack_events_registry: config.stack_events_registry,
      replication_opts:
        [
          stack_id: stack_id,
          transaction_received:
            {Electric.Replication.ShapeLogCollector, :store_transaction, [shape_log_collector]},
          relation_received:
            {Electric.Replication.ShapeLogCollector, :handle_relation_msg, [shape_log_collector]}
        ] ++ config.replication_opts,
      pool_opts: [types: PgInterop.Postgrex.Types] ++ config.pool_opts,
      timeline_opts: [
        stack_id: stack_id,
        persistent_kv: config.persistent_kv
      ],
      persistent_kv: config.persistent_kv,
      shape_cache_opts: shape_cache_opts,
      max_shapes: config.max_shapes,
      expiry_batch_size: config.expiry_batch_size,
      tweaks: config.tweaks,
      manual_table_publishing?: config.manual_table_publishing?
    ]

    consumer_supervisor_spec = {Electric.Shapes.DynamicConsumerSupervisor, [stack_id: stack_id]}

    shape_cleaner_spec = {Electric.ShapeCache.ShapeCleaner, stack_id: stack_id}

    shape_cache_spec = {Electric.ShapeCache, shape_cache_opts}

    publication_manager_spec =
      {
        Electric.Replication.PublicationManager,
        stack_id: stack_id,
        publication_name: Keyword.fetch!(config.replication_opts, :publication_name),
        can_alter_publication?: true,
        manual_table_publishing?: config.manual_table_publishing?,
        db_pool: Electric.Connection.Manager.admin_pool(stack_id),
        update_debounce_timeout: Keyword.get(config.tweaks, :publication_alter_debounce_ms, 0),
        refresh_period: Keyword.get(config.tweaks, :publication_refresh_period, 60_000)
      }

    shape_log_collector_spec =
      {Electric.Replication.ShapeLogCollector,
       stack_id: stack_id, inspector: inspector, persistent_kv: config.persistent_kv}

    schema_reconciler_spec =
      {Electric.Replication.SchemaReconciler,
       stack_id: stack_id,
       inspector: inspector,
       period: Keyword.get(config.tweaks, :schema_reconciler_period, 60_000)}

    expiry_manager_spec =
      {Electric.ShapeCache.ExpiryManager,
       max_shapes: config.max_shapes,
       expiry_batch_size: config.expiry_batch_size,
       stack_id: stack_id}

    children =
      [
        {Electric.Replication.Supervisor,
         stack_id: stack_id,
         consumer_supervisor: consumer_supervisor_spec,
         shape_cleaner: shape_cleaner_spec,
         shape_cache: shape_cache_spec,
         publication_manager: publication_manager_spec,
         log_collector: shape_log_collector_spec,
         schema_reconciler: schema_reconciler_spec,
         expiry_manager: expiry_manager_spec},
        {Electric.Connection.Manager.Supervisor, new_connection_manager_opts}
      ]

    Supervisor.init(children, strategy: :one_for_one, auto_shutdown: :any_significant)
  end

  @doc false
  defp storage_mod_arg(%{stack_id: stack_id, storage: {mod, arg}} = opts) do
    arg =
      arg
      |> put_in([:stack_id], stack_id)
      |> put_in(
        [:chunk_bytes_threshold],
        opts[:chunk_bytes_threshold] || LogChunker.default_chunk_size_threshold()
      )

    Electric.ShapeCache.Storage.shared_opts({mod, arg})
  end
end
