defmodule Electric.Application do
  use Application
  require Config

  @process_registry_name Electric.Registry.Processes
  def process_registry, do: @process_registry_name

  @spec process_name(atom(), String.t(), atom()) :: {:via, atom(), atom()}
  def process_name(electric_instance_id, tenant_id, module) when is_atom(module) do
    {:via, Registry, {@process_registry_name, {module, electric_instance_id, tenant_id}}}
  end

  @spec process_name(atom(), String.t(), atom(), term()) :: {:via, atom(), {atom(), term()}}
  def process_name(electric_instance_id, tenant_id, module, id) when is_atom(module) do
    {:via, Registry, {@process_registry_name, {module, electric_instance_id, tenant_id, id}}}
  end

  @impl true
  def start(_type, _args) do
    :erlang.system_flag(:backtrace_depth, 50)

    config = configure()

    # The root application supervisor starts the core global processes, including the HTTP
    # server and the database connection manager. The latter is responsible for establishing
    # all needed connections to the database (acquiring the exclusive access lock, opening a
    # replication connection, starting a connection pool).
    #
    # Once there is a DB connection pool running, Connection.Manager will start the singleton
    # `Electric.Shapes.Supervisor` which is responsible for starting the shape log collector
    # and individual shape consumer process trees.
    #
    # See the moduledoc in `Electric.Connection.Supervisor` for more info.
    children =
      Enum.concat([
        [
          Electric.Telemetry,
          {Registry,
           name: @process_registry_name, keys: :unique, partitions: System.schedulers_online()},
          {Registry,
           name: Registry.ShapeChanges, keys: :duplicate, partitions: System.schedulers_online()},
          Electric.TenantSupervisor,
          Electric.TenantManager,
          {Bandit,
           plug:
             {Electric.Plug.Router,
              storage: config.storage, tenant_manager: Electric.TenantManager},
           port: Application.fetch_env!(:electric, :service_port),
           thousand_island_options: http_listener_options()}
          # {Bandit,
          #  plug:
          #    {Electric.Plug.Router,
          #     storage: config.storage,
          #     registry: Registry.ShapeChanges,
          #     shape_cache: {Electric.ShapeCache, config.shape_cache_opts},
          #     get_service_status: &Electric.ServiceStatus.check/0,
          #     inspector: config.inspector,
          #     long_poll_timeout: 20_000,
          #     max_age: Application.fetch_env!(:electric, :cache_max_age),
          #     stale_age: Application.fetch_env!(:electric, :cache_stale_age),
          #     allow_shape_deletion: Application.get_env(:electric, :allow_shape_deletion, false)},
          #  port: Application.fetch_env!(:electric, :service_port),
          #  thousand_island_options: http_listener_options()}
        ],
        prometheus_endpoint(Application.fetch_env!(:electric, :prometheus_port))
      ])

    {:ok, sup_pid} =
      Supervisor.start_link(children,
        strategy: :one_for_one,
        name: Electric.Supervisor
      )

    if Application.get_env(:electric, :test_mode, false) do
      test_tenant = Application.fetch_env!(:electric, :test_tenant)
      connection_opts = Application.fetch_env!(:electric, :connection_opts)
      Electric.TenantManager.create_tenant(test_tenant, connection_opts)
    end

    {:ok, sup_pid}
  end

  # This function is called once in the application's start() callback. It reads configuration
  # from the OTP application env, runs some pre-processing functions and stores the processed
  # configuration as a single map using `:persistent_term`.
  defp configure do
    electric_instance_id = Application.fetch_env!(:electric, :electric_instance_id)

    {storage_module, storage_in_opts} = Application.fetch_env!(:electric, :storage)
    storage_opts = storage_module.shared_opts(storage_in_opts)
    storage = {storage_module, storage_opts}

    {kv_module, kv_fun, kv_params} = Application.fetch_env!(:electric, :persistent_kv)
    persistent_kv = apply(kv_module, kv_fun, [kv_params])

    replication_stream_id = Application.fetch_env!(:electric, :replication_stream_id)
    publication_name = "electric_publication_#{replication_stream_id}"
    slot_name = "electric_slot_#{replication_stream_id}"
    slot_temporary? = Application.get_env(:electric, :replication_slot_temporary?, false)

    config = %Electric.Application.Configuration{
      electric_instance_id: electric_instance_id,
      storage: storage,
      persistent_kv: persistent_kv,
      connection_opts: Application.fetch_env!(:electric, :connection_opts),
      replication_opts: %{
        stream_id: replication_stream_id,
        publication_name: publication_name,
        slot_name: slot_name,
        slot_temporary?: slot_temporary?
      },
      pool_opts: %{
        size: Application.fetch_env!(:electric, :db_pool_size)
      }
    }

    Electric.Application.Configuration.save(config)
  end

  defp prometheus_endpoint(nil), do: []

  defp prometheus_endpoint(port) do
    [
      {
        Bandit,
        plug: {Electric.Plug.UtilityRouter, []},
        port: port,
        thousand_island_options: http_listener_options()
      }
    ]
  end

  defp http_listener_options do
    if Application.get_env(:electric, :listen_on_ipv6?, false) do
      [transport_options: [:inet6]]
    else
      []
    end
  end
end
