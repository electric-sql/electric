defmodule Electric.Shapes.Supervisor do
  use Supervisor

  require Logger

  def start_link(opts) do
    name = Access.get(opts, :name, __MODULE__)

    Supervisor.start_link(__MODULE__, opts, name: name)
  end

  @impl Supervisor
  def init(opts) do
    Logger.info("Starting shape replication pipeline")

    shape_cache = Keyword.fetch!(opts, :shape_cache)
    log_collector = Keyword.fetch!(opts, :log_collector)
    electric_instance_id = Keyword.fetch!(opts, :electric_instance_id)

    consumer_supervisor =
      Keyword.get(
        opts,
        :consumer_supervisor,
        {Electric.Shapes.ConsumerSupervisor, [electric_instance_id: electric_instance_id]}
      )

    children = [consumer_supervisor, log_collector, shape_cache]
    Supervisor.init(children, strategy: :one_for_all)
  end
end
