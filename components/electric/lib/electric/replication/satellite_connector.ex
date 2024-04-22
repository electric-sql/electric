defmodule Electric.Replication.SatelliteConnector do
  use Supervisor

  alias Electric.Replication.Connectors
  alias Electric.Replication.SatelliteCollectorProducer
  alias Electric.Replication.SatelliteCollectorConsumer

  require Logger

  @type start_opts() :: %{
          name: String.t(),
          producer: Electric.reg_name(),
          origin: Connectors.origin()
        }

  @spec start_link(start_opts()) :: Supervisor.on_start()
  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts)
  end

  @impl Supervisor
  def init(%{name: name, producer: producer, origin: origin}) do
    # `cancel: :temporary` is used here since the death of the Satellite WS process will eventually kill the supervisor,
    # but it'll kill SatelliteCollectorConsumer first and cause it to restart with nowhere to resubscribe.
    children = [
      {SatelliteCollectorConsumer,
       name: SatelliteCollectorConsumer.name(name),
       subscribe_to: [{producer, cancel: :temporary}],
       push_to: SatelliteCollectorProducer.reg_name(origin)},
      {Electric.Postgres.CachedWal.Producer,
       name: Electric.Postgres.CachedWal.Producer.name(name), origin: origin}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
