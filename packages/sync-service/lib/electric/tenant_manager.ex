defmodule Electric.TenantManager do
  use GenServer
  require Logger

  alias Electric.Tenant.Persistence

  @tenant_info_pos 2

  # Public API

  def name(electric_instance_id)
      when is_binary(electric_instance_id) or is_atom(electric_instance_id) do
    Electric.Application.process_name(electric_instance_id, "no tenant", __MODULE__)
  end

  def name([]) do
    __MODULE__
  end

  def name(opts) do
    Access.get(opts, :electric_instance_id, [])
    |> name()
  end

  def tenants_ets_table_name(electric_instance_id)
      when is_binary(electric_instance_id) or is_atom(electric_instance_id) do
    :"tenants_ets_table_#{electric_instance_id}"
  end

  def tenants_ets_table_name(opts) do
    Access.fetch!(opts, :electric_instance_id)
    |> tenants_ets_table_name()
  end

  def start_link(opts) do
    {:ok, pid} =
      GenServer.start_link(__MODULE__, opts,
        name: Keyword.get_lazy(opts, :name, fn -> name(opts) end)
      )

    recreate_tenants_from_disk!(opts)

    {:ok, pid}
  end

  @doc """
  Retrieves the only tenant in the system.
  If there are no tenants, it returns `{:error, :not_found}`.
  If there are several tenants, it returns `{:error, :several_tenants}`
  and we should use `get_tenant` instead.
  """
  @spec get_only_tenant(Keyword.t()) ::
          {:ok, Keyword.t()} | {:error, :not_found} | {:error, :several_tenants}
  def get_only_tenant(opts) do
    tenants = tenants_ets_table_name(opts)

    case :ets.first(tenants) do
      :"$end_of_table" ->
        # the ETS table does not contain any tenant
        {:error, :not_found}

      tenant_id ->
        case :ets.next(tenants, tenant_id) do
          :"$end_of_table" ->
            # There is no next key, so this is the only tenant
            tenant = :ets.lookup_element(tenants, tenant_id, @tenant_info_pos)
            {:ok, tenant}

          _ ->
            {:error, :several_tenants}
        end
    end
  end

  @doc """
  Retrieves a tenant by its ID.
  """
  @spec get_tenant(String.t(), Keyword.t()) :: {:ok, Keyword.t()} | {:error, :not_found}
  def get_tenant(tenant_id, opts) do
    tenants = tenants_ets_table_name(opts)

    if :ets.member(tenants, tenant_id) do
      {:ok, :ets.lookup_element(tenants, tenant_id, @tenant_info_pos)}
    else
      {:error, :not_found}
    end
  end

  @doc """
  Creates a new tenant for the provided database URL.
  """
  @spec create_tenant(String.t(), Keyword.t(), Keyword.t()) ::
          :ok | {:error, atom()}
  def create_tenant(tenant_id, connection_opts, opts \\ []) do
    app_config =
      %{electric_instance_id: electric_instance_id, persistent_kv: persistent_kv} =
      Keyword.get_lazy(opts, :app_config, fn -> Electric.Application.Configuration.get() end)

    inspector =
      Access.get(
        opts,
        :inspector,
        {Electric.Postgres.Inspector.EtsInspector,
         electric_instance_id: electric_instance_id,
         tenant_id: tenant_id,
         server:
           Electric.Postgres.Inspector.EtsInspector.name(
             electric_instance_id,
             tenant_id
           ),
         tenant_tables_name:
           Electric.Postgres.Inspector.EtsInspector.fetch_tenant_tables_name(opts)}
      )

    registry = Access.get(opts, :registry, Registry.ShapeChanges)

    get_storage = fn ->
      {storage_module, storage_in_opts} = Application.fetch_env!(:electric, :storage)

      storage_opts =
        storage_module.shared_opts(storage_in_opts |> Keyword.put(:tenant_id, tenant_id))

      {storage_module, storage_opts}
    end

    storage = Access.get(opts, :storage, get_storage.())

    # Can't load pg_id here because the connection manager may still be busy
    # connecting to the DB so it might not be known yet
    # {pg_id, _} = Electric.Timeline.load_timeline(persistent_kv: persistent_kv)
    get_pg_id = fn ->
      hostname = Access.fetch!(connection_opts, :hostname)
      port = Access.fetch!(connection_opts, :port)
      database = Access.fetch!(connection_opts, :database)
      hostname <> ":" <> to_string(port) <> "/" <> database
    end

    pg_id = Access.get(opts, :pg_id, get_pg_id.())

    shape_cache =
      Access.get(
        opts,
        :shape_cache,
        {Electric.ShapeCache,
         electric_instance_id: electric_instance_id,
         tenant_id: tenant_id,
         server: Electric.ShapeCache.name(electric_instance_id, tenant_id)}
      )

    get_service_status =
      Access.get(opts, :get_service_status, fn ->
        Electric.ServiceStatus.check(electric_instance_id, tenant_id)
      end)

    long_poll_timeout = Access.get(opts, :long_poll_timeout, 20_000)
    max_age = Access.get(opts, :max_age, Application.fetch_env!(:electric, :cache_max_age))
    stale_age = Access.get(opts, :stale_age, Application.fetch_env!(:electric, :cache_stale_age))

    allow_shape_deletion =
      Access.get(
        opts,
        :allow_shape_deletion,
        Application.get_env(:electric, :allow_shape_deletion, false)
      )

    tenant = [
      electric_instance_id: electric_instance_id,
      tenant_id: tenant_id,
      pg_id: pg_id,
      registry: registry,
      storage: storage,
      shape_cache: shape_cache,
      get_service_status: get_service_status,
      inspector: inspector,
      long_poll_timeout: long_poll_timeout,
      max_age: max_age,
      stale_age: stale_age,
      allow_shape_deletion: allow_shape_deletion
    ]

    # Store the tenant in the tenant manager
    store_tenant_opts =
      opts ++
        [
          electric_instance_id: electric_instance_id,
          persistent_kv: persistent_kv,
          connection_opts: connection_opts
        ]

    start_tenant_opts = [
      app_config: app_config,
      electric_instance_id: electric_instance_id,
      tenant_id: tenant_id,
      connection_opts: connection_opts,
      inspector: inspector,
      storage: storage
    ]

    with :ok <- store_tenant(tenant, store_tenant_opts),
         {:ok, _} <- Electric.TenantSupervisor.start_tenant(start_tenant_opts) do
      :ok
    end
  end

  @doc """
  Stores the provided tenant in the tenant manager.
  """
  @spec store_tenant(Keyword.t(), Keyword.t()) :: :ok | {:error, atom()}
  def store_tenant(tenant, opts) do
    server = Keyword.get(opts, :tenant_manager, name(opts))

    case GenServer.call(server, {:store_tenant, tenant}) do
      {:tenant_already_exists, tenant_id} ->
        {:error, {:tenant_already_exists, tenant_id}}

      {:db_already_in_use, pg_id} ->
        {:error, {:db_already_in_use, pg_id}}

      :ok ->
        Electric.Tenant.Persistence.persist_tenant!(
          Keyword.fetch!(tenant, :tenant_id),
          Keyword.fetch!(opts, :connection_opts),
          opts
        )
    end
  end

  @doc """
  Deletes a tenant by its ID.
  """
  @spec delete_tenant(String.t(), Keyword.t()) :: :ok | :not_found
  def delete_tenant(tenant_id, opts) do
    server = Keyword.get(opts, :tenant_manager, name(opts))

    case get_tenant(tenant_id, opts) do
      {:ok, tenant} ->
        pg_id = Access.fetch!(tenant, :pg_id)

        case GenServer.call(server, {:delete_tenant, tenant_id, pg_id}) do
          :ok ->
            :ok = Electric.TenantSupervisor.stop_tenant(opts ++ [tenant_id: tenant_id])
            :ok = Electric.Tenant.Persistence.delete_tenant!(tenant_id, opts)

          :not_found ->
            :not_found
        end

      {:error, :not_found} ->
        :not_found
    end
  end

  ## Internal API

  @impl GenServer
  def init(opts) do
    # information about all tenants is kept in an ETS table
    # that maps tenant_id to tenant information.
    # it is stored in an ETS table to allow concurrent reads.
    # the table is protected such that only this genserver can write to it
    # which ensures that all writes are serialised
    tenants_ets_table =
      :ets.new(tenants_ets_table_name(opts), [
        :named_table,
        :protected,
        :set,
        {:read_concurrency, true}
      ])

    # state is a set `dbs` of PG identifiers used by tenants
    # such that we can reject any request to store a tenant
    # that uses a DB that is already in use
    {:ok, %{tenants_ets: tenants_ets_table, dbs: MapSet.new()}}
  end

  @impl GenServer
  def handle_call(
        {:store_tenant, tenant},
        _from,
        %{dbs: dbs, tenants_ets: tenants} = state
      ) do
    tenant_id = tenant[:tenant_id]
    pg_id = tenant[:pg_id]

    if :ets.member(tenants, tenant_id) do
      {:reply, {:tenant_already_exists, tenant_id}, state}
    else
      if MapSet.member?(dbs, pg_id) do
        {:reply, {:db_already_in_use, pg_id}, state}
      else
        true = :ets.insert_new(tenants, {tenant_id, tenant})
        {:reply, :ok, %{state | dbs: MapSet.put(dbs, pg_id)}}
      end
    end
  end

  @impl GenServer
  def handle_call(
        {:delete_tenant, tenant_id, pg_id},
        _from,
        %{tenants_ets: tenants, dbs: dbs} = state
      ) do
    if :ets.member(tenants, tenant_id) do
      :ets.delete(tenants, tenant_id)
      {:reply, :ok, %{state | dbs: MapSet.delete(dbs, pg_id)}}
    else
      {:reply, :not_found, state}
    end
  end

  defp recreate_tenants_from_disk!(opts) do
    # Load the tenants from the persistent KV store
    tenants = Persistence.load_tenants!(opts)

    # Recreate all tenants
    Enum.each(tenants, fn {tenant_id, conn_opts} ->
      Logger.info("Reloading tenant #{tenant_id} from storage")
      :ok = create_tenant(tenant_id, conn_opts, opts)
    end)
  end
end
