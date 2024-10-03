defmodule Electric.TenantManager do
  use GenServer

  # Public API

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: Access.get(opts, :name, __MODULE__))
  end

  @doc """
  Retrieves the only tenant in the system.
  If there are no tenants, it returns `{:error, :not_found}`.
  If there are several tenants, it returns `{:error, :several_tenants}`
  and we should use `get_tenant` instead.
  """
  @spec get_only_tenant(Keyword.t()) ::
          {:ok, Keyword.t()} | {:error, :not_found} | {:error, :several_tenants}
  def get_only_tenant(opts \\ []) do
    server = Keyword.get(opts, :tenant_manager, __MODULE__)
    GenServer.call(server, :get_only_tenant)
  end

  @doc """
  Retrieves a tenant by its ID.
  """
  @spec get_tenant(String.t(), Keyword.t()) :: {:ok, Keyword.t()} | {:error, :not_found}
  def get_tenant(tenant_id, opts \\ []) do
    server = Keyword.get(opts, :tenant_manager, __MODULE__)
    GenServer.call(server, {:get_tenant, tenant_id})
  end

  @doc """
  Creates a new tenant for the provided database URL.
  """
  @spec create_tenant(String.t(), Keyword.t(), Keyword.t()) ::
          :ok | {:error, atom()}
  def create_tenant(tenant_id, connection_opts, opts \\ []) do
    {storage_module, storage_opts} = Application.fetch_env!(:electric, :storage)
    {kv_module, kv_fun, kv_params} = Application.fetch_env!(:electric, :persistent_kv)

    persistent_kv = apply(kv_module, kv_fun, [kv_params])

    electric_instance_id = Application.fetch_env!(:electric, :electric_instance_id)

    get_service_status = fn ->
      Electric.ServiceStatus.check(
        get_connection_status: fn ->
          Electric.Connection.Manager.get_status(Electric.Connection.Manager)
        end
      )
    end

    inspector =
      Access.get(
        opts,
        :inspector,
        {Electric.Postgres.Inspector.EtsInspector,
         electric_instance_id: electric_instance_id,
         tenant_id: tenant_id,
         server: Electric.Postgres.Inspector.EtsInspector.name(electric_instance_id, tenant_id)}
      )

    {:ok, _} =
      Electric.TenantSupervisor.start_tenant(
        electric_instance_id: electric_instance_id,
        tenant_id: tenant_id,
        connection_opts: connection_opts,
        inspector: inspector,
        persistent_kv: persistent_kv
      )

    # Can't load pg_id here because the connection manager may still be busy
    # connection to the DB so it might not be known yet
    # {pg_id, _} = Electric.Timeline.load_timeline(persistent_kv: persistent_kv)
    hostname = Access.fetch!(connection_opts, :hostname)
    port = Access.fetch!(connection_opts, :port)
    pg_id = hostname <> ":#{port}"

    {:ok, storage_opts} = storage_module.shared_opts(storage_opts)
    storage = {storage_module, storage_opts}

    # shape_cache = Electric.ShapeCache.name(electric_instance_id, tenant_id)

    tenant = [
      electric_instance_id: electric_instance_id,
      tenant_id: tenant_id,
      pg_id: pg_id,
      registry: Registry.ShapeChanges,
      storage: storage,
      shape_cache:
        {Electric.ShapeCache,
         electric_instance_id: electric_instance_id,
         tenant_id: tenant_id,
         server: Electric.ShapeCache.name(electric_instance_id, tenant_id)},
      get_service_status: get_service_status,
      inspector: inspector,
      long_poll_timeout: 20_000,
      max_age: Application.fetch_env!(:electric, :cache_max_age),
      stale_age: Application.fetch_env!(:electric, :cache_stale_age),
      allow_shape_deletion: Application.get_env(:electric, :allow_shape_deletion, false)
    ]

    # Store the tenant in the tenant manager
    store_tenant(tenant, opts)
  end

  @doc """
  Stores the provided tenant in the tenant manager.
  """
  @spec store_tenant(Keyword.t(), Keyword.t()) :: :ok | {:error, atom()}
  def store_tenant(tenant, opts \\ []) do
    server = Keyword.get(opts, :tenant_manager, __MODULE__)

    case GenServer.call(server, {:store_tenant, tenant}) do
      :tenant_already_exists -> {:error, :tenant_already_exists}
      :db_already_in_use -> {:error, :db_already_in_use}
      :ok -> :ok
    end
  end

  @doc """
  Deletes a tenant by its ID.
  """
  @spec delete_tenant(String.t(), Keyword.t()) :: :ok
  def delete_tenant(tenant_id, opts \\ []) do
    server = Keyword.get(opts, :tenant_manager, __MODULE__)

    case GenServer.call(server, {:get_tenant, tenant_id}) do
      {:ok, tenant} ->
        pg_id = Access.fetch!(tenant, :pg_id)
        GenServer.call(server, {:delete_tenant, tenant_id, pg_id})

      {:error, :not_found} ->
        :ok
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
        {:store_tenant, tenant},
        _from,
        %{tenants: tenants, dbs: dbs} = state
      ) do
    tenant_id = tenant[:tenant_id]
    pg_id = tenant[:pg_id]

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
  def handle_call(:get_only_tenant, _from, %{tenants: tenants} = state) do
    case map_size(tenants) do
      1 ->
        tenant = tenants |> Map.values() |> Enum.at(0)
        {:reply, {:ok, tenant}, state}

      0 ->
        {:reply, {:error, :not_found}, state}

      _ ->
        {:reply, {:error, :several_tenants}, state}
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

  @impl GenServer
  def handle_call({:delete_tenant, tenant_id, pg_id}, _from, %{tenants: tenants, dbs: dbs}) do
    {:reply, :ok, %{tenants: Map.delete(tenants, tenant_id), dbs: MapSet.delete(dbs, pg_id)}}
  end
end
