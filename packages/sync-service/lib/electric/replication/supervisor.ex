defmodule Electric.Replication.Supervisor do
  @moduledoc """
  Supervisor responsible for the entire shape subsystem.

  It starts up and supervises the processes that manage shapes (create/remove), keep the
  Postgres publication up to date, consume incoming transactions and write them to shape logs.
  It also supervisers the consumer supervisor which starts a new consumer process for each
  shape.
  """

  use Supervisor

  require Logger

  def name(stack_id) when is_binary(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def name(opts), do: name(opts[:stack_id])

  def start_link(opts) do
    name = Access.get(opts, :name, name(opts))
    Supervisor.start_link(__MODULE__, opts, name: name)
  end

  @impl Supervisor
  def init(opts) do
    Process.set_label({:replication_supervisor, opts[:stack_id]})
    Logger.metadata(stack_id: opts[:stack_id])
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts[:stack_id])

    Logger.info("Starting shape replication pipeline")

    shape_status_owner = Keyword.fetch!(opts, :shape_status_owner)
    log_collector = Keyword.fetch!(opts, :log_collector)
    publication_manager = Keyword.fetch!(opts, :publication_manager)
    consumer_supervisor = Keyword.fetch!(opts, :consumer_supervisor)
    shape_cache = Keyword.fetch!(opts, :shape_cache)
    schema_reconciler = Keyword.fetch!(opts, :schema_reconciler)
    expiry_manager = Keyword.fetch!(opts, :expiry_manager)
    stack_id = Keyword.fetch!(opts, :stack_id)

    children = [
      {Task.Supervisor,
       name: Electric.ProcessRegistry.name(stack_id, Electric.StackTaskSupervisor)},
      shape_status_owner,
      log_collector,
      publication_manager,
      consumer_supervisor,
      shape_cache,
      schema_reconciler,
      expiry_manager
    ]

    Supervisor.init(children, strategy: :one_for_all)
  end
end
