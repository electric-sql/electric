defmodule Electric.Replication.PostgresConnectorSup do
  use Supervisor
  require Logger

  alias Electric.Replication.Connectors
  alias Electric.Replication.Postgres
  alias Electric.Replication.Vaxine

  @spec start_link(Connectors.config()) :: :ignore | {:error, any} | {:ok, pid}
  def start_link(conn_config) do
    Supervisor.start_link(__MODULE__, conn_config)
  end

  @spec name(Connectors.origin()) :: Electric.reg_name()
  def name(origin) when is_binary(origin) do
    Electric.name(__MODULE__, origin)
  end

  @impl Supervisor
  def init(conn_config) do
    origin = Connectors.origin(conn_config)
    Electric.reg(name(origin))

    downstream = Connectors.get_downstream_opts(conn_config)
    vaxine_producer = Vaxine.LogProducer.get_name(origin)
    postgres_producer = Postgres.LogicalReplicationProducer.get_name(origin)

    children = [
      %{
        id: :slot_server,
        start: {Postgres.SlotServer, :start_link, [conn_config, vaxine_producer]}
      },
      %{
        id: :vaxine_consumer,
        start: {Vaxine.LogConsumer, :start_link, [origin, postgres_producer]}
      },
      %{
        id: :postgres_producer,
        start: {Postgres.LogicalReplicationProducer, :start_link, [conn_config]}
      },
      %{
        id: :vaxine_producer,
        start: {Vaxine.LogProducer, :start_link, [origin, downstream.producer_opts]}
      }
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
