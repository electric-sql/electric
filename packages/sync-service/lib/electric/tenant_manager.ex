defmodule Electric.Tenant do
  defstruct [
    :tenant_id,
    :pg_id,
    :registry,
    :shape_cache,
    :get_service_status,
    :inspector,
    :long_poll_timeout,
    :max_age,
    :stale_age,
    :allow_shape_deletion
  ]

  def new(
        tenant_id,
        pg_id,
        registry,
        shape_cache,
        get_service_status,
        inspector,
        long_poll_timeout,
        max_age,
        stale_age,
        allow_shape_deletion
      ) do
    %__MODULE__{
      tenant_id: tenant_id,
      pg_id: pg_id,
      registry: registry,
      shape_cache: shape_cache,
      get_service_status: get_service_status,
      inspector: inspector,
      long_poll_timeout: long_poll_timeout,
      max_age: max_age,
      stale_age: stale_age,
      allow_shape_deletion: allow_shape_deletion
    }
  end
end

defmodule Electric.TenantManager do
  use GenServer

  # Public API

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: Access.get(opts, :name, __MODULE__))
  end

  @doc """
  Retrieves a tenant by its ID.
  """
  @spec get_tenant(String.t(), Keyword.t()) :: {:ok, Electric.Tenant.t()} | {:error, :not_found}
  def get_tenant(tenant_id, opts \\ []) do
    server = Keyword.get(opts, :tenant_manager, __MODULE__)
    GenServer.call(server, {:get_tenant, tenant_id})
  end

  @doc """
  Creates a new tenant for the provided database URL.
  """
  @spec create_tenant(String.t(), Keyword.t(), Keyword.t()) ::
          :ok | {:error, String.t()}
  def create_tenant(tenant_id, connection_opts, opts \\ []) do
    server = Keyword.get(opts, :tenant_manager, __MODULE__)

    # {:ok, database_url_config} = Electric.Config.parse_postgresql_uri(db_url)
    # connection_opts = [ipv6: db_use_ipv6] ++ database_url_config

    # Start the different processes needed by the tenant

    {storage_module, storage_opts} = Application.fetch_env!(:electric, :storage)
    {kv_module, kv_fun, kv_params} = Application.fetch_env!(:electric, :persistent_kv)

    persistent_kv = apply(kv_module, kv_fun, [kv_params])

    replication_stream_id = Application.fetch_env!(:electric, :replication_stream_id)
    publication_name = "electric_publication_#{replication_stream_id}"
    slot_name = "electric_slot_#{replication_stream_id}"

    with {:ok, storage_opts} <- storage_module.shared_opts(storage_opts) do
      storage = {storage_module, storage_opts}

      get_pg_version = fn ->
        Electric.ConnectionManager.get_pg_version(Electric.ConnectionManager)
      end

      get_service_status = fn ->
        Electric.ServiceStatus.check(
          get_connection_status: fn ->
            Electric.ConnectionManager.get_status(Electric.ConnectionManager)
          end
        )
      end

      prepare_tables_fn =
        {Electric.Postgres.Configuration, :configure_tables_for_replication!,
         [get_pg_version, publication_name]}

      electric_instance_id = Application.fetch_env!(:electric, :electric_instance_id)

      inspector =
        {Electric.Postgres.Inspector.EtsInspector,
         electric_instance_id: electric_instance_id,
         tenant_id: tenant_id,
         server: Electric.Postgres.Inspector.EtsInspector.name(electric_instance_id, tenant_id)}

      shape_changes_registry =
        Electric.Application.process_name(
          electric_instance_id,
          tenant_id,
          Registry.ShapeChanges
        )

      per_env_processes =
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
              registry: shape_changes_registry
            }

          connection_manager_opts = [
            electric_instance_id: electric_instance_id,
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
              shape_cache: {Electric.ShapeCache, []},
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
            {Registry,
             name: shape_changes_registry,
             keys: :duplicate,
             partitions: System.schedulers_online()},
            {Electric.ConnectionManager, connection_manager_opts},
            {Electric.Postgres.Inspector.EtsInspector, pool: db_pool}
          ]
        else
          []
        end

      Supervisor.start_link(per_env_processes,
        strategy: :one_for_one,
        name: Electric.TenantSupervisor
      )

      {pg_id, _} = Electric.Timeline.load_timeline(persistent_kv: persistent_kv)

      tenant =
        Electric.Tenant.new(
          tenant_id,
          pg_id,
          shape_changes_registry,
          {Electric.ShapeCache, []},
          get_service_status,
          inspector,
          20_000,
          Application.fetch_env!(:electric, :cache_max_age),
          Application.fetch_env!(:electric, :cache_stale_age),
          Application.get_env(:electric, :allow_shape_deletion, false)
        )

      # Store the tenant in the tenant manager
      case GenServer.call(server, {:store_tenant, tenant}) do
        :tenant_already_exists -> {:error, :tenant_already_exists}
        :db_already_in_use -> {:error, :db_already_in_use}
        :ok -> :ok
      end
    end
  end

  ## Internal API

  @impl GenServer
  def init(_opts) do
    # state contains an index `tenants` of tenant_id -> tenant
    # and a set `dbs` of PG identifiers used by tenants
    {:ok, %{tenants: Map.new(), dbs: MapSet.new()}}
  end

  @impl GenServer
  def handle_call(
        {:store_tenant, %Electric.Tenant{tenant_id: tenant_id, pg_id: pg_id} = tenant},
        _from,
        %{tenants: tenants, dbs: dbs} = state
      ) do
    if Map.has_key?(tenants, tenant_id) do
      {:reply, :tenant_already_exists, state}
    else
      if MapSet.member?(dbs, pg_id) do
        {:reply, :db_already_in_use, state}
      else
        {:reply, :ok,
         %{tenants: Map.put(tenants, tenant_id, tenant), dbs: MapSet.put(dbs, pg_id)}}
      end
    end
  end

  @impl GenServer
  def handle_call({:get_tenant, tenant_id}, _from, %{tenants: tenants} = state) do
    if Map.has_key?(tenants, tenant_id) do
      {:reply, {:ok, Map.get(tenants, tenant_id)}, state}
    else
      {:reply, {:error, :not_found}, state}
    end
  end
end
