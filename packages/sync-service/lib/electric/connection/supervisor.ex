defmodule Electric.Connection.Supervisor do
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
