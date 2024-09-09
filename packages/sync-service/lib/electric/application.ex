defmodule Electric.Application do
  use Application

  @electric_instance_id :default
  @process_registry_name Electric.Registry.Processes

  @spec legacy_process_name(atom()) :: {:via, atom(), atom()}
  def legacy_process_name(module) when is_atom(module) do
    {:via, Registry, {@process_registry_name, module}}
  end

  @spec legacy_process_name(atom(), term()) :: {:via, atom(), {atom(), term()}}
  def legacy_process_name(module, id) when is_atom(module) do
    {:via, Registry, {@process_registry_name, {module, id}}}
  end

  @spec process_name(atom(), atom()) :: {:via, atom(), atom()}
  def process_name(electric_instance_id, module) when is_atom(module) do
    {:via, Registry, {@process_registry_name, {module, electric_instance_id}}}
  end

  @spec process_name(atom(), atom(), term()) :: {:via, atom(), {atom(), term()}}
  def process_name(electric_instance_id, module, id) when is_atom(module) do
    {:via, Registry, {@process_registry_name, {module, electric_instance_id, id}}}
  end

  @impl true
  def start(_type, _args) do
    :erlang.system_flag(:backtrace_depth, 50)

    {storage_module, storage_opts} = Application.fetch_env!(:electric, :storage)
    {kv_module, kv_fun, kv_params} = Application.fetch_env!(:electric, :persistent_kv)

    persistent_kv = apply(kv_module, kv_fun, [kv_params])

    publication_name = "electric_publication"
    slot_name = "electric_slot"

    with {:ok, storage_opts} <- storage_module.shared_opts(storage_opts) do
      storage = {storage_module, storage_opts}

      prepare_tables_fn =
        {Electric.Postgres.Configuration, :configure_tables_for_replication!, [publication_name]}

      inspector =
        {Electric.Postgres.Inspector.EtsInspector,
         server: Electric.Postgres.Inspector.EtsInspector}

      shape_cache =
        {Electric.ShapeCache,
         electric_instance_id: @electric_instance_id,
         storage: storage,
         inspector: inspector,
         prepare_tables_fn: prepare_tables_fn,
         chunk_bytes_threshold: Application.fetch_env!(:electric, :chunk_bytes_threshold),
         log_producer: Electric.Replication.ShapeLogCollector,
         persistent_kv: persistent_kv,
         registry: Registry.ShapeChanges}

      core_processes = [
        {Registry,
         name: @process_registry_name, keys: :unique, partitions: System.schedulers_online()}
      ]

      connection_manager_opts = [
        connection_opts: Application.fetch_env!(:electric, :connection_opts),
        replication_opts: [
          publication_name: publication_name,
          try_creating_publication?: true,
          slot_name: slot_name,
          transaction_received: {Electric.Replication.ShapeLogCollector, :store_transaction, []},
          relation_received: {Electric.Replication.ShapeLogCollector, :handle_relation_msg, []}
        ],
        pool_opts: [
          name: Electric.DbPool,
          pool_size: Application.fetch_env!(:electric, :db_pool_size),
          types: PgInterop.Postgrex.Types
        ],
        timeline_opts: [
          shape_cache: {Electric.ShapeCache, []},
          persistent_kv: persistent_kv
        ],
        log_collector: {Electric.Replication.ShapeLogCollector, inspector: inspector},
        shape_cache: shape_cache
      ]

      per_env_processes =
        if Application.fetch_env!(:electric, :environment) != :test do
          [
            Electric.Telemetry,
            {Registry,
             name: Registry.ShapeChanges, keys: :duplicate, partitions: System.schedulers_online()},
            {Electric.ConnectionManager, connection_manager_opts},
            {Electric.Postgres.Inspector.EtsInspector, pool: Electric.DbPool},
            {Bandit,
             plug:
               {Electric.Plug.Router,
                storage: storage,
                registry: Registry.ShapeChanges,
                shape_cache: {Electric.ShapeCache, []},
                inspector: inspector,
                long_poll_timeout: 20_000,
                max_age: Application.fetch_env!(:electric, :cache_max_age),
                stale_age: Application.fetch_env!(:electric, :cache_stale_age),
                allow_shape_deletion: Application.get_env(:electric, :allow_shape_deletion, false)},
             port: 3000}
          ]
          |> add_prometheus_router(Application.fetch_env!(:electric, :prometheus_port))
        else
          []
        end

      Supervisor.start_link(core_processes ++ per_env_processes,
        strategy: :one_for_one,
        name: Electric.Supervisor
      )
    end
  end

  defp add_prometheus_router(children, nil), do: children

  defp add_prometheus_router(children, port) do
    children ++
      [
        {
          Bandit,
          plug: {Electric.Plug.UtilityRouter, []}, port: port
        }
      ]
  end
end
