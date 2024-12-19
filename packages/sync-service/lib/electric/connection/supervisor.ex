defmodule Electric.Connection.Supervisor do
  @moduledoc """
  The connection supervisor is a rest-for-one supervisor that starts `Connection.Manager`,
  followed by `Replication.Supervisor`.

  Connection.Manager monitors all of the connection process that it starts and if any one of
  the goes down with a critical error (such as Postgres shutting down), the connection manager
  itself will shut down. This will cause the shutdown of Replication.Supervisor, due to the nature
  of the rest-for-one supervision strategy, and, since the latter supervisor is started as a
  `temporary` child of the connection supervisor, it won't be restarted until its child spec is
  re-added by a new call to `start_shapes_supervisor/0`.

  This supervision design is deliberate: none of the "shapes" processes can function without a
  working DB pool and we only have a DB pool when the Connection.Manager process can see that
  all of its database connections are healthy. Connection.Manager tries to reopen connections
  when they are closed, with an exponential backoff, so it is the first process to know when a
  connection has been restored and it's also the one that starts Replication.Supervisor once it
  has successfully initialized a database connection pool.
  """

  use Supervisor, restart: :transient, significant: true

  require Logger

  def name(opts) do
    Electric.ProcessRegistry.name(opts[:stack_id], __MODULE__)
  end

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: name(opts))
  end

  def shutdown(stack_id, reason) do
    Logger.error(
      "Stopping connection supervisor with stack_id=#{inspect(stack_id)} " <>
        "due to an unrecoverable error: #{inspect(reason)}"
    )

    Supervisor.stop(name(stack_id: stack_id), {:shutdown, reason}, 1_000)
  end

  def init(opts) do
    Process.set_label({:connection_supervisor, opts[:stack_id]})
    Logger.metadata(stack_id: opts[:stack_id])
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts[:stack_id])
    Supervisor.init([{Electric.Connection.Manager, opts}], strategy: :rest_for_one)
  end

  def start_shapes_supervisor(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    shape_cache_opts = Keyword.fetch!(opts, :shape_cache_opts)
    db_pool_opts = Keyword.fetch!(opts, :pool_opts)
    replication_opts = Keyword.fetch!(opts, :replication_opts)
    inspector = Keyword.fetch!(shape_cache_opts, :inspector)

    shape_cache_spec = {Electric.ShapeCache, shape_cache_opts}

    publication_manager_spec =
      {Electric.Replication.PublicationManager,
       stack_id: stack_id,
       publication_name: Keyword.fetch!(replication_opts, :publication_name),
       db_pool: Keyword.fetch!(db_pool_opts, :name)}

    shape_log_collector_spec =
      {Electric.Replication.ShapeLogCollector, stack_id: stack_id, inspector: inspector}

    child_spec =
      Supervisor.child_spec(
        {
          Electric.Replication.Supervisor,
          stack_id: stack_id,
          shape_cache: shape_cache_spec,
          publication_manager: publication_manager_spec,
          log_collector: shape_log_collector_spec
        },
        restart: :temporary
      )

    with {:ok, pid} <- Supervisor.start_child(name(opts), child_spec) do
      Electric.StackSupervisor.dispatch_stack_event(
        opts[:stack_events_registry],
        stack_id,
        :ready
      )

      {:ok, pid}
    end
  end
end
