defmodule Electric.Replication.SatelliteConnector do
  use Supervisor

  require Logger

  @type init_arg() :: %{
          :name => String.t(),
          :producer => Electric.reg_name(),
          :vaxine_opts => %{}
        }

  @spec start_link(init_arg()) :: Supervisor.on_start()
  def start_link(init_arg) do
    vaxine_opts =
      Application.get_env(
        :electric,
        Electric.Replication.SQConnectors
      )

    Supervisor.start_link(
      __MODULE__,
      Map.put(init_arg, :vaxine_opts, vaxine_opts)
    )
  end

  @impl Supervisor
  def init(init_arg) do
    name = init_arg.name
    producer = init_arg.producer
    vaxine_opts = init_arg.vaxine_opts

    children = [
      %{
        id: :vx_consumer,
        start: {Electric.Replication.Vaxine.LogConsumer, :start_link, [name, producer]}
      },
      %{
        id: :vx_producer,
        start: {Electric.Replication.Vaxine.LogProducer, :start_link, [name, vaxine_opts]}
      }
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
