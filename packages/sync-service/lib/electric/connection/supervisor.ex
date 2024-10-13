defmodule Electric.Connection.Supervisor do
  @moduledoc """
  The connection supervisor is a rest-for-one supervisor that starts `ConnectionManager`,
  followed by `Shapes.Supervisor`.

  ConnectionManager monitors all of the connection process that it starts and if any one of
  the goes down with a critical error (such as Postgres shutting down), the connection manager
  itself will shut down. This will cause the shutdown of Shapes.Supervisor, due to the nature
  of the rest-for-one supervision strategy, and, since the latter supervisor is started as a
  `temporary` child of the connection supervisor, it won't be restarted until its child spec is
  re-added by a new call to `start_shapes_supervisor/0`.

  This supervision design is deliberate: none of the "shapes" processes can function without a
  working DB pool and we only have a DB pool when the ConnectionManager process can see that
  all of its database connections are healthy. ConnectionManager tries to reopen connections
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
    Supervisor.init([{Electric.ConnectionManager, opts}], strategy: :rest_for_one)
  end

  def start_shapes_supervisor do
    app_config = Electric.Application.Configuration.get()

    shape_log_collector_spec =
      {Electric.Replication.ShapeLogCollector,
       electric_instance_id: app_config.electric_instance_id, inspector: app_config.inspector}

    child_spec =
      Supervisor.child_spec(
        {
          Electric.Shapes.Supervisor,
          electric_instance_id: app_config.electric_instance_id,
          shape_cache: app_config.child_specs.shape_cache,
          log_collector: shape_log_collector_spec
        },
        restart: :temporary
      )

    Supervisor.start_child(@name, child_spec)
  end
end
