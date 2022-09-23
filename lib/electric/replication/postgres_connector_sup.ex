defmodule Electric.Replication.PostgresConnectorSup do
  use Supervisor
  require Logger

  alias Electric.Replication.PostgresConnector
  alias Electric.Replication.Postgres
  alias Electric.Replication.Vaxine

  @spec start_link(Keyword.t()) :: :ignore | {:error, any} | {:ok, pid}
  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg)
  end

  @spec name(PostgresConnector.origin()) :: Electric.reg_name()
  def name(origin) when is_binary(origin) do
    Electric.name(__MODULE__, origin)
  end

  @impl Supervisor
  def init(origin) do
    Electric.reg(name(origin))

    args = %{
      replication: PostgresConnector.get_replication_opts(origin),
      downstream: PostgresConnector.get_downstream_opts(origin)
    }

    downstream = PostgresConnector.get_downstream_opts(origin)
    vaxine_producer = Vaxine.LogProducer.get_name(origin)
    postgres_producer = Postgres.LogicalReplicationProducer.get_name(origin)

    children = [
      %{
        id: :slot_server,
        start: {Postgres.SlotServer, :start_link, [origin, args, vaxine_producer]}
      },
      %{
        id: :vaxine_consumer,
        start: {Vaxine.LogConsumer, :start_link, [origin, postgres_producer]}
      },
      %{
        id: :postgres_producer,
        start: {Postgres.LogicalReplicationProducer, :start_link, [origin]}
      },
      %{
        id: :vaxine_producer,
        start: {Vaxine.LogProducer, :start_link, [origin, downstream.producer_opts]}
      }
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  #  @spec stop_children(atom) :: :ok
  #  def stop_children(origin) do
  #    name = name(origin)
  #    # terminate replication from PG to Vaxine
  #   :ok = Supervisor.terminate_child(name, :vaxine_consumer)
  #    :ok = Supervisor.terminate_child(name, :postgres_producer)

  # with {:ok, conn} <- Client.connect(conn_config),
  #     :ok <- Client.stop_subscription(conn, subscription_name)
  # do
  #    :ok = Supervisor.terminate_child(name, :vaxine_producer)
  #    :ok = Supervisor.terminate_child(name, :slot_server)

  #  end

  # Order in which we should stop postgresql connection
  # vaxine_log_consumer
  # postgresl_producer

  # -- stop subscription --
  # we want to do that before terminating SlotServer, to avoud PG reconnects
  # and retriggering SlotServer

  # vaxine_log_producer
  # slot_server
end
