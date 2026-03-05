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

  def reset_storage(opts) do
    shape_cache_opts = Keyword.fetch!(opts, :shape_cache_opts)
    stack_id = Keyword.fetch!(shape_cache_opts, :stack_id)
    stack_storage = Electric.ShapeCache.Storage.for_stack(stack_id)

    Logger.notice("Purging all shapes.")
    Electric.ShapeCache.Storage.cleanup_all!(stack_storage)
  end

  def start_link(opts) do
    name = Access.get(opts, :name, name(opts))
    Supervisor.start_link(__MODULE__, opts, name: name)
  end

  @impl Supervisor
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    Process.set_label({:replication_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    Logger.notice("Starting shape replication pipeline")

    log_collector = Keyword.fetch!(opts, :log_collector)
    publication_manager = Keyword.fetch!(opts, :publication_manager)
    consumer_supervisor = Keyword.fetch!(opts, :consumer_supervisor)
    shape_cache = Keyword.fetch!(opts, :shape_cache)
    expiry_manager = Keyword.fetch!(opts, :expiry_manager)
    schema_reconciler = Keyword.fetch!(opts, :schema_reconciler)

    children = [
      {Task.Supervisor,
       name: Electric.ProcessRegistry.name(stack_id, Electric.StackTaskSupervisor)},
      log_collector,
      publication_manager,
      consumer_supervisor,
      shape_cache,
      expiry_manager,
      schema_reconciler,
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
