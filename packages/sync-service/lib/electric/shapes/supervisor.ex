defmodule Electric.Shapes.Supervisor do
  @moduledoc """
  Supervisor responsible for the entire shape subsystem.

  It starts up and supervises the processes that manage shapes (create/remove), keep the
  Postgres publication up to date, consume incoming transactions and write them to shape logs.
  It also supervisers the consumer supervisor which starts a new consumer process for each
  shape.
  """

  use Supervisor

  require Logger

  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
  end

  def reset_storage(stack_id) do
    stack_storage = Electric.ShapeCache.Storage.for_stack(stack_id)

    Logger.info("Purging all shapes.")
    Electric.ShapeCache.Storage.cleanup_all!(stack_storage)
  end

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    # Start the sup only if the connection subsystem is up
    case Electric.StatusMonitor.status(stack_id) do
      %{conn: ready} when ready in [:up, :waiting_on_integrity_checks] ->
        name = Access.get(opts, :name, name(opts))
        Supervisor.start_link(__MODULE__, opts, name: name)

      _ ->
        :ignore
    end
  end

  @impl Supervisor
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    Process.set_label({:replication_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    Logger.info("Starting shape replication pipeline")

    inspector = Keyword.fetch!(opts, :inspector)
    persistent_kv = Keyword.fetch!(opts, :persistent_kv)

    connection_manager_opts = Keyword.fetch!(opts, :connection_manager_opts)
    replication_opts = Keyword.fetch!(connection_manager_opts, :replication_opts)
    tweaks = Keyword.fetch!(opts, :tweaks)

    children = [
      {Task.Supervisor,
       name: Electric.ProcessRegistry.name(stack_id, Electric.StackTaskSupervisor)},
      {Electric.ShapeCache.ShapeCleaner.CleanupTaskSupervisor, stack_id: stack_id},
      {Electric.Replication.ShapeLogCollector,
       stack_id: stack_id, inspector: inspector, persistent_kv: persistent_kv},
      {Electric.Replication.PublicationManager,
       stack_id: stack_id,
       publication_name: Keyword.fetch!(replication_opts, :publication_name),
       manual_table_publishing?: Keyword.get(opts, :manual_table_publishing?, false),
       db_pool: Electric.Connection.Manager.admin_pool(stack_id),
       update_debounce_timeout: Keyword.get(tweaks, :publication_alter_debounce_ms, 0),
       refresh_period: Keyword.get(tweaks, :publication_refresh_period, 60_000)},
      {Electric.Shapes.DynamicConsumerSupervisor, stack_id: stack_id},
      {Electric.ShapeCache, stack_id: stack_id},
      {Electric.ShapeCache.ExpiryManager, stack_id: stack_id},
      {Electric.Replication.SchemaReconciler,
       stack_id: stack_id,
       inspector: inspector,
       period: Keyword.get(tweaks, :schema_reconciler_period, 60_000)},
      canary_spec(stack_id)
    ]

    Supervisor.init(children, strategy: :one_for_all)
  end

  def canary_name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, :canary)
  end

  defp canary_spec(stack_id) do
    %{
      id: __MODULE__.Canary,
      start: {
        Agent,
        :start_link,
        [fn -> canary_state(stack_id) end, [name: canary_name(stack_id)]]
      },
      type: :worker
    }
  end

  defp canary_state(stack_id) do
    Electric.StatusMonitor.mark_supervisor_processes_ready(stack_id, self())
  end
end
