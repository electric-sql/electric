defmodule Electric.Replication.Supervisor do
  use Supervisor

  require Logger

  def name(opts) do
    Electric.ProcessRegistry.name(opts[:stack_id], __MODULE__)
  end

  def start_link(opts) do
    name = Access.get(opts, :name, name(opts))

    # TODO: naming this is not necessary
    Supervisor.start_link(__MODULE__, opts, name: name)
  end

  @impl Supervisor
  def init(opts) do
    Process.set_label({:replication_supervisor, opts[:stack_id]})
    Logger.info("Starting shape replication pipeline")

    # TODO: weird to have these without defaults but `consumer_supervisor` with a default
    shape_cache = Keyword.fetch!(opts, :shape_cache)
    log_collector = Keyword.fetch!(opts, :log_collector)
    stack_id = Keyword.fetch!(opts, :stack_id)

    consumer_supervisor =
      Keyword.get(
        opts,
        :consumer_supervisor,
        {Electric.Shapes.DynamicConsumerSupervisor, [stack_id: stack_id]}
      )

    children = [consumer_supervisor, log_collector, shape_cache]
    Supervisor.init(children, strategy: :one_for_all)
  end
end
