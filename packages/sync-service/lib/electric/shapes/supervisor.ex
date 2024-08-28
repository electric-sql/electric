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

    replication_client = Keyword.fetch!(opts, :replication_client)
    shape_cache = Keyword.fetch!(opts, :shape_cache)
    log_collector = Keyword.fetch!(opts, :log_collector)

    consumer_supervisor =
      Keyword.get(opts, :consumer_supervisor, {Electric.Shapes.ConsumerSupervisor, []})

    children =
      Enum.reject(
        [consumer_supervisor, log_collector, shape_cache, replication_client],
        &is_nil/1
      )

    Supervisor.init(children, strategy: :one_for_all)
  end
end
