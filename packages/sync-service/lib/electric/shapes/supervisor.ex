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

    storage_dir = Electric.StackConfig.lookup!(stack_id, :storage_dir)
    wal_buffer_capacity = Electric.StackConfig.lookup(stack_id, :wal_buffer_capacity, 64 * 1024 * 1024)
    durable_streams_url = Electric.StackConfig.lookup(stack_id, :durable_streams_url)
    durable_streams_token = Electric.StackConfig.lookup(stack_id, :durable_streams_token)
    num_writers = Electric.StackConfig.lookup(stack_id, :durable_streams_writer_pool_size, 4)

    wal_buffer_spec =
      {Electric.Replication.WalBuffer,
       stack_id: stack_id, data_dir: storage_dir, wal_buffer_capacity: wal_buffer_capacity}

    durable_streams_children =
      if durable_streams_url do
        [
          {Electric.DurableStreams.Distributor,
           stack_id: stack_id, num_writers: num_writers},
          {Electric.DurableStreams.WriterPool,
           stack_id: stack_id,
           num_writers: num_writers,
           durable_streams_url: durable_streams_url,
           durable_streams_token: durable_streams_token}
        ]
      else
        []
      end

    children = [
      {Task.Supervisor,
       name: Electric.ProcessRegistry.name(stack_id, Electric.StackTaskSupervisor)},
      wal_buffer_spec,
      log_collector,
      publication_manager,
      consumer_supervisor,
      shape_cache,
      expiry_manager,
      schema_reconciler
    ] ++ durable_streams_children ++ [canary_spec(stack_id)]

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
