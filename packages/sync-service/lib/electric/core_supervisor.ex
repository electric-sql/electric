defmodule Electric.CoreSupervisor do
  @moduledoc """
  A supervisor that starts the core components of the Electric system.

  This is divided into two subsystems:
  1. The connection subsystem (processes that may exit on a connection failure), started with Connection.Manager.Supervisor
  2. The shape subsystem (processes that are resilient to connection failures), started with Electric.Replication.Supervisor
  """
  use Supervisor, restart: :transient, significant: true

  alias Electric.ShapeCache.LogChunker
  alias Electric.ShapeCache.ShapeStatus

  require Logger

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: name(opts))
  end

  def name(stack_id) when is_binary(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def name(opts) do
    name(Access.fetch!(opts, :stack_id))
  end

  def reset_storage(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    shape_cache_opts = Keyword.fetch!(opts, :shape_cache_opts)
    storage = Keyword.fetch!(shape_cache_opts, :storage)
    supervisor = name(stack_id)

    Logger.info("Purging all shapes.")
    Supervisor.terminate_child(supervisor, Electric.Replication.Supervisor)
    Electric.ShapeCache.Storage.cleanup_all!(storage)
    Supervisor.restart_child(supervisor, Electric.Replication.Supervisor)
  end

  @impl true
  def init(%{stack_id: stack_id} = config) do
    Process.set_label({:core_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    shape_log_collector = Electric.Replication.ShapeLogCollector.name(stack_id)

    storage = storage_mod_arg(config)

    shape_status =
      {ShapeStatus,
       ShapeStatus.opts(
         shape_meta_table: ShapeStatus.shape_meta_table(stack_id),
         shape_last_used_table: ShapeStatus.shape_last_used_table(stack_id),
         storage: storage
       )}

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
      shape_status: shape_status,
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

    shape_status_owner_spec =
      {Electric.ShapeCache.ShapeStatusOwner,
       [stack_id: stack_id, shape_status: Keyword.fetch!(shape_cache_opts, :shape_status)]}

    consumer_supervisor_spec = {Electric.Shapes.DynamicConsumerSupervisor, [stack_id: stack_id]}

    shape_cleaner_spec =
      {Electric.ShapeCache.ShapeCleaner,
       stack_id: stack_id, shape_status: Keyword.fetch!(shape_cache_opts, :shape_status)}

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
       stack_id: stack_id,
       shape_status: Keyword.fetch!(shape_cache_opts, :shape_status)}

    children =
      [
        {Electric.Replication.Supervisor,
         stack_id: stack_id,
         shape_status_owner: shape_status_owner_spec,
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
