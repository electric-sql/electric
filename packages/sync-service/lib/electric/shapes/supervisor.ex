defmodule Electric.Shapes.Supervisor do
  use Supervisor

  require Logger

  def name(electric_instance_id, tenant_id) do
    Electric.Application.process_name(electric_instance_id, tenant_id, __MODULE__)
  end

  def name(opts) do
    electric_instance_id = Access.fetch!(opts, :electric_instance_id)
    tenant_id = Access.fetch!(opts, :tenant_id)
    name(electric_instance_id, tenant_id)
  end

  def start_link(opts) do
    name = Access.get(opts, :name, name(opts))

    Supervisor.start_link(__MODULE__, opts, name: name)
  end

  @impl Supervisor
  def init(opts) do
    Logger.info("Starting shape replication pipeline")

    replication_client = Keyword.fetch!(opts, :replication_client)
    shape_cache = Keyword.fetch!(opts, :shape_cache)
    log_collector = Keyword.fetch!(opts, :log_collector)
    electric_instance_id = Keyword.fetch!(opts, :electric_instance_id)
    tenant_id = Keyword.fetch!(opts, :tenant_id)

    consumer_supervisor =
      Keyword.get(
        opts,
        :consumer_supervisor,
        {Electric.Shapes.ConsumerSupervisor,
         [electric_instance_id: electric_instance_id, tenant_id: tenant_id]}
      )

    children =
      Enum.reject(
        [consumer_supervisor, log_collector, shape_cache, replication_client],
        &is_nil/1
      )

    Supervisor.init(children, strategy: :one_for_all)
  end
end
