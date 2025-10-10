defmodule Electric.Connection.Manager.Supervisor do
  @moduledoc """
  Intermediate supervisor that helps tie Connection.Manager's lifetime to that of Replication.Supervisor.
  """

  use Supervisor

  def name(opts) do
    Electric.ProcessRegistry.name(opts[:stack_id], __MODULE__)
  end

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: name(opts))
  end

  def init(opts) do
    Process.set_label({:connection_manager_supervisor, opts[:stack_id]})
    Logger.metadata(stack_id: opts[:stack_id])
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts[:stack_id])

    children = [
      {Electric.Connection.Manager, opts},
      {Electric.Connection.Manager.ConnectionResolver, stack_id: opts[:stack_id]}
    ]

    # Electric.Connection.Manager is a permanent child of the supervisor, so when it dies, the
    # :one_for_all strategy will kick in and restart the other children.
    # This is not the case for Electric.Replication.Supervisor which needs to be a temporary
    # child such that Electric.Connection.Manager decides when it starts. Because of this, when
    # Electric.Replication.Supervisor dies, even due to an error, it doesn't activate the
    # :one_for_all strategy.
    # We work around this by marking Electric.Replication.Supervisor as significant and
    # configuring this supervisor with [auto_shutdown: :any_significant].
    Supervisor.init(children, strategy: :one_for_all, auto_shutdown: :any_significant)
  end

  @doc """
  This function is supposed to be called from Connection.Manager at the right point in its
  initialization sequence.

  Replication.Supervisor is started as a temporary child so that, when it dies, it is up to the
  Connection.Manager process to restart it again at the right point in time.
  """
  def start_replication_supervisor(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    shape_cache_opts = Keyword.fetch!(opts, :shape_cache_opts)
    replication_opts = Keyword.fetch!(opts, :replication_opts)
    inspector = Keyword.fetch!(shape_cache_opts, :inspector)
    persistent_kv = Keyword.fetch!(opts, :persistent_kv)
    tweaks = Keyword.fetch!(opts, :tweaks)

    consumer_supervisor_spec = {Electric.Shapes.DynamicConsumerSupervisor, [stack_id: stack_id]}

    shape_cleaner_spec = {Electric.ShapeCache.ShapeCleaner, stack_id: stack_id}

    shape_cache_spec = {Electric.ShapeCache, shape_cache_opts}

    publication_manager_spec =
      {Electric.Replication.PublicationManager,
       stack_id: stack_id,
       publication_name: Keyword.fetch!(replication_opts, :publication_name),
       can_alter_publication?: Keyword.fetch!(opts, :can_alter_publication?),
       manual_table_publishing?: Keyword.fetch!(opts, :manual_table_publishing?),
       db_pool: Electric.Connection.Manager.admin_pool(stack_id),
       update_debounce_timeout: Keyword.get(tweaks, :publication_alter_debounce_ms, 0),
       refresh_period: Keyword.get(tweaks, :publication_refresh_period, 60_000)}

    shape_log_collector_spec =
      {Electric.Replication.ShapeLogCollector,
       stack_id: stack_id, inspector: inspector, persistent_kv: persistent_kv}

    schema_reconciler_spec =
      {Electric.Replication.SchemaReconciler,
       stack_id: stack_id,
       inspector: inspector,
       period: Keyword.get(tweaks, :schema_reconciler_period, 60_000)}

    expiry_manager_spec =
      {Electric.ShapeCache.ExpiryManager,
       max_shapes: Keyword.fetch!(opts, :max_shapes),
       expiry_batch_size: Keyword.fetch!(opts, :expiry_batch_size),
       stack_id: stack_id}

    child_spec =
      Supervisor.child_spec(
        {
          Electric.Replication.Supervisor,
          stack_id: stack_id,
          consumer_supervisor: consumer_supervisor_spec,
          shape_cleaner: shape_cleaner_spec,
          shape_cache: shape_cache_spec,
          publication_manager: publication_manager_spec,
          log_collector: shape_log_collector_spec,
          schema_reconciler: schema_reconciler_spec,
          expiry_manager: expiry_manager_spec
        },
        restart: :temporary,
        significant: true
      )

    Supervisor.start_child(name(opts), child_spec)
  end

  # Stopping the Connection.Manager causes all database connections to close, letting the
  # database server scale itself down to zero if it supports that.
  #
  # The replication supervisor keeps running.
  def stop_connection_manager(opts) do
    Supervisor.terminate_child(name(opts), Electric.Connection.Manager)
  end

  # Stopping the Connection.Manager.Supervisor causes the Connection.Supervisor to restart it
  # from a clean state. The end result is the Connection.Manager is back up and the
  # Replication.Supervisor has the opportunity to purge shapes if the need for this is
  # communicated by Connection.Manager.
  def restart(opts) do
    Supervisor.stop(name(opts))
  end
end
