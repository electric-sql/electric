defmodule Electric.Tenant.Supervisor do
  use Supervisor, restart: :transient

  require Logger

  def name(electric_instance_id, tenant_id) do
    Electric.Application.process_name(electric_instance_id, tenant_id, __MODULE__)
  end

  def name(%{electric_instance_id: electric_instance_id, tenant_id: tenant_id}) do
    name(electric_instance_id, tenant_id)
  end

  def start_link(opts) do
    config = Map.new(opts)
    Supervisor.start_link(__MODULE__, config, name: name(config))
  end

  @impl true
  def init(%{
        electric_instance_id: electric_instance_id,
        tenant_id: tenant_id,
        connection_opts: connection_opts,
        inspector: inspector,
        persistent_kv: persistent_kv
      }) do
    # Start the different processes needed by the tenant

    {storage_module, storage_opts} = Application.fetch_env!(:electric, :storage)

    replication_stream_id = Application.fetch_env!(:electric, :replication_stream_id)
    publication_name = "electric_publication_#{replication_stream_id}"
    slot_name = "electric_slot_#{replication_stream_id}"

    with {:ok, storage_opts} <- storage_module.shared_opts(storage_opts) do
      storage = {storage_module, storage_opts}

      get_pg_version = fn ->
        server = Electric.Connection.Manager.name(electric_instance_id, tenant_id)
        Electric.Connection.Manager.get_pg_version(server)
      end

      prepare_tables_fn =
        {Electric.Postgres.Configuration, :configure_tables_for_replication!,
         [get_pg_version, publication_name]}

      children =
        if Application.fetch_env!(:electric, :environment) != :test do
          shape_log_collector =
            Electric.Replication.ShapeLogCollector.name(electric_instance_id, tenant_id)

          db_pool =
            Electric.Application.process_name(electric_instance_id, tenant_id, Electric.DbPool)

          shape_cache =
            {
              Electric.ShapeCache,
              electric_instance_id: electric_instance_id,
              tenant_id: tenant_id,
              storage: storage,
              inspector: inspector,
              prepare_tables_fn: prepare_tables_fn,
              chunk_bytes_threshold: Application.fetch_env!(:electric, :chunk_bytes_threshold),
              log_producer: shape_log_collector,
              consumer_supervisor:
                Electric.Shapes.ConsumerSupervisor.name(electric_instance_id, tenant_id),
              persistent_kv: persistent_kv,
              registry: Registry.ShapeChanges
            }

          connection_manager_opts = [
            electric_instance_id: electric_instance_id,
            tenant_id: tenant_id,
            connection_opts: connection_opts,
            replication_opts: [
              publication_name: publication_name,
              try_creating_publication?: true,
              slot_name: slot_name,
              transaction_received:
                {Electric.Replication.ShapeLogCollector, :store_transaction,
                 [shape_log_collector]},
              relation_received:
                {Electric.Replication.ShapeLogCollector, :handle_relation_msg,
                 [shape_log_collector]}
            ],
            pool_opts: [
              name: db_pool,
              pool_size: Application.fetch_env!(:electric, :db_pool_size),
              types: PgInterop.Postgrex.Types
            ],
            timeline_opts: [
              tenant_id: tenant_id,
              persistent_kv: persistent_kv
            ],
            log_collector:
              {Electric.Replication.ShapeLogCollector,
               electric_instance_id: electric_instance_id,
               tenant_id: tenant_id,
               inspector: inspector},
            shape_cache: shape_cache
          ]

          [
            {Electric.Connection.Manager, connection_manager_opts},
            {Electric.Postgres.Inspector.EtsInspector,
             pool: db_pool, electric_instance_id: electric_instance_id, tenant_id: tenant_id}
          ]
        else
          []
        end

      Supervisor.init(children, strategy: :one_for_one, auto_shutdown: :any_significant)
    end
  end
end
