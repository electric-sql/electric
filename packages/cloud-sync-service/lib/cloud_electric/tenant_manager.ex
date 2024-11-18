defmodule CloudElectric.TenantManager do
  alias CloudElectric.DynamicTenantSupervisor
  use GenServer
  require Logger

  @tenant_info_pos 2

  # Public API

  def tenants_ets_table_name(_opts) do
    :tenants_ets_table
  end

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @doc """
  Retrieves a tenant by its ID.
  """
  @spec get_tenant(String.t(), Keyword.t()) :: {:ok, Keyword.t()} | {:error, :not_found}
  def get_tenant(tenant_id, opts) do
    tenants = tenants_ets_table_name(opts)

    case :ets.lookup_element(tenants, tenant_id, @tenant_info_pos, :not_found) do
      :not_found -> {:error, :not_found}
      result -> {:ok, result}
    end
  end

  @doc """
  Creates a new tenant for the provided database URL.
  """
  @spec create_tenant(String.t(), Keyword.t(), Keyword.t()) ::
          :ok | {:error, term()}
  def create_tenant(tenant_id, connection_opts, opts \\ []) do
    server = Keyword.get(opts, :tenant_manager, __MODULE__)
    GenServer.call(server, {:create_tenant, tenant_id, connection_opts, opts})
  end

  if Mix.env() == :test do
    @doc false
    def store_tenant(tenant_conf, tenant_opts) do
      server = Keyword.get(tenant_opts, :tenant_manager, __MODULE__)
      GenServer.call(server, {:store_tenant, tenant_conf})
    end
  end

  @doc """
  Deletes a tenant by its ID.
  """
  @spec delete_tenant(String.t(), Keyword.t()) :: :ok | {:error, :not_found}
  def delete_tenant(tenant_id, opts) do
    server = Keyword.get(opts, :tenant_manager, __MODULE__)

    with {:ok, _} <- get_tenant(tenant_id, opts) do
      GenServer.call(server, {:delete_tenant, tenant_id})
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
    {:ok,
     %{
       tenants_ets: tenants_ets_table,
       dbs: MapSet.new(),
       init_opts: opts,
       load_successful?: false
     }, {:continue, :load_from_control_plane}}
  end

  @impl GenServer
  def handle_continue(:load_from_control_plane, state) do
    case initialize_tenants_from_control_plane(state) do
      {:ok, state} ->
        {:noreply, %{state | load_successful?: true}}

      {:error, :unreachable} ->
        Process.send_after(self(), :retry_initialization, 500)
        {:noreply, state}
    end
  end

  @impl GenServer
  def handle_info(:retry_initialization, state) do
    {:noreply, state, {:continue, :load_from_control_plane}}
  end

  @impl GenServer
  def handle_call(_, _, %{load_successful?: false} = state) do
    {:reply, {:error, :not_ready}, state}
  end

  def handle_call({:create_tenant, tenant_id, connection_opts, opts}, _, state) do
    case do_create_tenant(tenant_id, connection_opts, opts, state) do
      {:ok, state} -> {:reply, :ok, state}
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:delete_tenant, tenant_id}, _from, state) do
    case do_stop_and_delete_tenant(tenant_id, state) do
      {:ok, state} -> {:reply, :ok, state}
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  if Mix.env() == :test do
    def handle_call({:store_tenant, tenant}, _, %{dbs: dbs, tenants_ets: tenants} = state) do
      tenant_id = tenant[:tenant_id]
      pg_id = tenant[:pg_id]
      true = :ets.insert_new(tenants, {tenant_id, tenant})
      {:reply, :ok, %{state | dbs: MapSet.put(dbs, pg_id)}}
    end
  end

  defp do_stop_and_delete_tenant(tenant_id, %{dbs: dbs, tenants_ets: tenants} = state) do
    case get_tenant(tenant_id, state.init_opts) do
      {:ok, tenant} ->
        pg_id = Access.fetch!(tenant, :pg_id)
        :ets.delete(tenants, tenant_id)
        state = %{state | dbs: MapSet.delete(dbs, pg_id)}

        drop_replication_slot(tenant_id)

        # TODO: This leaves orphaned shapes with data on disk
        :ok = DynamicTenantSupervisor.stop_tenant(tenant_id)

        {:ok, state}

      error ->
        # TODO: after a restart the tenant is not there, so the supervisor is not started,
        #       so there is no way to clean up the publication slot. This also means `get_tenant`
        #       will always return "not found" after a restart, so shape data is also orphaned.
        error
    end
  end

  defp drop_replication_slot(tenant_id) do
    tenant_id
    |> Electric.Connection.Manager.name()
    |> Electric.Connection.Manager.drop_replication_slot()
  end

  defp do_create_tenant(
         tenant_id,
         connection_opts,
         opts,
         %{dbs: dbs, tenants_ets: tenants} = state
       ) do
    {tenant, start_tenant_opts} =
      create_tenant_spec(tenant_id, connection_opts, Keyword.merge(state.init_opts, opts))

    tenant_id = tenant[:tenant_id]
    pg_id = tenant[:pg_id]

    cond do
      :ets.member(tenants, tenant_id) ->
        {:error, {:tenant_already_exists, tenant_id}}

      MapSet.member?(dbs, pg_id) ->
        {:error, {:db_already_in_use, pg_id}}

      true ->
        with {:ok, _} <- DynamicTenantSupervisor.start_tenant(start_tenant_opts) do
          true = :ets.insert_new(tenants, {tenant_id, tenant})
          {:ok, %{state | dbs: MapSet.put(dbs, pg_id)}}
        end
    end
  end

  defp initialize_tenants_from_control_plane(state) do
    with {:load, control_plane} <- get_control_plane(state),
         {:ok, to_add, to_remove} <-
           CloudElectric.ControlPlane.list_tenants(control_plane, state.init_opts) do
      state =
        Enum.reduce(to_remove, state, fn %{"id" => tenant_id}, state ->
          case do_stop_and_delete_tenant(tenant_id, state) do
            {:ok, state} -> state
            _ -> state
          end
        end)

      state =
        Enum.reduce(to_add, state, fn %{
                                        "id" => tenant_id,
                                        "connection_url" => connection_url
                                      },
                                      state ->
          {:ok, result} = Electric.ConfigParser.parse_postgresql_uri(connection_url)
          connection_opts = Electric.Utils.obfuscate_password(result)

          case do_create_tenant(
                 tenant_id,
                 connection_opts,
                 state.init_opts,
                 state
               ) do
            {:ok, state} ->
              state

            {:error, error} ->
              raise """
              Error while trying to initialize a tenant #{tenant_id} from the control plane:
              #{inspect(error)}
              Connection opts: #{inspect(result)}
              """
          end
        end)

      {:ok, state}
    end
  end

  defp get_control_plane(state) do
    control_plane = Keyword.get(state.init_opts, :control_plane)
    if is_nil(control_plane), do: {:ok, state}, else: {:load, control_plane}
  end

  defp create_tenant_spec(tenant_id, connection_opts, opts) do
    tenant =
      [tenant_id: tenant_id, pg_id: build_pg_id(connection_opts)]
      |> Keyword.merge(opts)
      |> Keyword.merge(
        Electric.StackSupervisor.build_shared_opts(
          stack_id: tenant_id,
          storage: opts[:storage]
        )
      )

    formatted_tenant_id = format_tenant_id(tenant_id)

    start_tenant_opts = [
      tenant_id: tenant_id,
      connection_opts: connection_opts,
      replication_opts: [
        publication_name: "cloud_electric_pub_#{formatted_tenant_id}",
        slot_name: "cloud_electric_slot_#{formatted_tenant_id}"
      ],
      persistent_kv: Keyword.fetch!(opts, :persistent_kv),
      pool_opts: Keyword.fetch!(opts, :pool_opts),
      storage: Keyword.fetch!(opts, :storage)
    ]

    {tenant, start_tenant_opts}
  end

  defp format_tenant_id(tenant_id) when byte_size(tenant_id) < 40,
    do: tenant_id |> String.downcase() |> String.replace(~r/[^a-z0-9_]/, "_")

  defp build_pg_id(connection_opts) do
    hostname = Access.fetch!(connection_opts, :hostname)
    port = Access.fetch!(connection_opts, :port)
    database = Access.fetch!(connection_opts, :database)
    hostname <> ":" <> to_string(port) <> "/" <> database
  end
end
