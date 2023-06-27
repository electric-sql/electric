defmodule Electric.Replication.SatelliteConnector do
  alias Electric.Replication.SatelliteCollectorProducer
  alias Electric.Replication.SatelliteCollectorConsumer
  use Supervisor

  require Logger

  @type init_arg() :: %{
          :name => String.t(),
          :producer => Electric.reg_name()
        }

  @spec start_link(init_arg()) :: Supervisor.on_start()
  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg)
  end

  @impl Supervisor
  def init(init_arg) do
    name = init_arg.name

    # `cancel: :temporary` is used here since the death of the Satellite WS process will eventually kill the supervisor,
    # but it'll kill SatelliteCollectorConsumer first and cause it to restart with nowhere to resubscribe.
    children = [
      {SatelliteCollectorConsumer,
       name: SatelliteCollectorConsumer.name(name),
       subscribe_to: [{init_arg.producer, cancel: :temporary}],
       push_to: SatelliteCollectorProducer.name()},
      {Electric.Postgres.CachedWal.Producer,
       name: Electric.Postgres.CachedWal.Producer.name(name)}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
