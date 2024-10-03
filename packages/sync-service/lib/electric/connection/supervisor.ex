defmodule Electric.Connection.Supervisor do
  @moduledoc """
  The connection supervisor is a rest-for-one supervisor that starts `Connection.Manager`,
  followed by `Shapes.Supervisor`.

  Connection.Manager monitors all of the connection process that it starts and if any one of
  the goes down with a critical error (such as Postgres shutting down), the connection manager
  itself will shut down. This will cause the shutdown of Shapes.Supervisor, due to the nature
  of the rest-for-one supervision strategy, and, since the latter supervisor is started as a
  `temporary` child of the connection supervisor, it won't be restarted until its child spec is
  re-added by a new call to `start_shapes_supervisor/0`.

  This supervision design is deliberate: none of the "shapes" processes can function without a
  working DB pool and we only have a DB pool when the Connection.Manager process can see that
  all of its database connections are healthy. Connection.Manager tries to reopen connections
  when they are closed, with an exponential backoff, so it is the first process to know when a
  connection has been restored and it's also the one that starts Shapes.Supervisor once it
  has successfully initialized a database connection pool.
  """

  use Supervisor

  @name __MODULE__

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: @name)
  end

  def init(opts) do
    Supervisor.init([{Electric.Connection.Manager, opts}], strategy: :rest_for_one)
  end

  def start_shapes_supervisor(opts) do
    app_config = Electric.Application.Configuration.get()

    shape_cache_opts = app_config.shape_cache_opts ++ Keyword.take(opts, [:purge_all_shapes?])
    shape_cache_spec = {Electric.ShapeCache, shape_cache_opts}

    shape_log_collector_spec =
      {Electric.Replication.ShapeLogCollector,
       electric_instance_id: app_config.electric_instance_id, inspector: app_config.inspector}

    child_spec =
      Supervisor.child_spec(
        {
          Electric.Shapes.Supervisor,
          electric_instance_id: app_config.electric_instance_id,
          tenant_id: Keyword.fetch!(opts, :tenant_id),
          shape_cache: shape_cache_spec,
          log_collector: shape_log_collector_spec
        },
        restart: :temporary
      )

    Supervisor.start_child(@name, child_spec)
  end
end
