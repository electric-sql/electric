defmodule Electric.Application do
  use Application

  @impl true
  def start(_type, _args) do
    :erlang.system_flag(:backtrace_depth, 50)

    {storage_module, init_params} = Application.fetch_env!(:electric, :storage)

    publication_name = "electric_publication"
    slot_name = "electric_slot"

    with {:ok, storage_opts} <- storage_module.shared_opts(init_params) do
      storage = {storage_module, storage_opts}

      prepare_tables_fn =
        {Electric.Postgres.Configuration, :configure_tables_for_replication!, [publication_name]}

      shape_cache = {Electric.ShapeCache, storage: storage, prepare_tables_fn: prepare_tables_fn}

      inspector =
        {Electric.Postgres.Inspector.EtsInspector,
         server: Electric.Postgres.Inspector.EtsInspector}

      children =
        if Application.fetch_env!(:electric, :environment) != :test do
          [
            Electric.Telemetry,
            {storage_module, storage_opts},
            {Registry,
             name: Registry.ShapeChanges, keys: :duplicate, partitions: System.schedulers_online()},
            shape_cache,
            {Electric.Replication.ShapeLogCollector,
             registry: Registry.ShapeChanges, shape_cache: shape_cache, inspector: inspector},
            {Electric.ConnectionManager,
             connection_opts: Application.fetch_env!(:electric, :connection_opts),
             replication_opts: [
               publication_name: publication_name,
               try_creating_publication?: true,
               slot_name: slot_name,
               transaction_received:
                 {Electric.Replication.ShapeLogCollector, :store_transaction, []},
               relation_received:
                 {Electric.Replication.ShapeLogCollector, :handle_relation_change, []}
             ],
             pool_opts: [
               name: Electric.DbPool,
               pool_size: Application.fetch_env!(:electric, :db_pool_size),
               types: PgInterop.Postgrex.Types
             ]},
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

      opts = [strategy: :one_for_one, name: Electric.Supervisor]
      Supervisor.start_link(children, opts)
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
