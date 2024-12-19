defmodule Electric.StackSupervisor do
  @moduledoc """
  Root supervisor that starts a stack of processes to serve shapes.

  Full supervision tree looks roughly like this:

  First, we start 2 registries, `Electric.ProcessRegistry`, and a registry for shape subscriptions. Both are named using the provided `stack_id` variable.

  1. `Electric.Postgres.Inspector.EtsInspector` is started with a pool name as a config option, module that is passed from the base config is __ignored__
  2. `Electric.Connection.Supervisor` takes a LOT of options to configure replication and start the rest of the tree. It starts (3) and then (4) in `rest-for-one` mode
  3. `Electric.Connection.Manager` takes all the connection/replication options and starts the db pool. It goes through the following steps:
      - start_lock_connection
      - exclusive_connection_lock_acquired (as a callback from the lock connection)
      - start_replication_client
        This starts a replication client (3.1) with no auto-reconnection, because manager is expected to restart this client in case something goes wrong. The streaming of WAL does not start automatically and has to be started explicitly by the manager
      - start_connection_pool (only if it's not started already, otherwise start streaming)
        This starts a `Postgrex` connection pool (3.2) to the DB we're going to use. If it's ok, we then do a bunch of checks, then ask (3) to finally start (4), and start streaming

      1. `Electric.Postgres.ReplicationClient` - connects to PG in replication mod, sets up slots, _does not start streaming_ until requested
      2. `Postgrex` connection pool is started for querying initial snapshots & info about the DB
  4. `Electric.Replication.Supervisor` is a supervisor responsible for taking the replication log from the replication client and shoving it into storage appropriately. It starts 3 things in one-for-all mode:
      1. `Electric.Shapes.DynamicConsumerSupervisor` is DynamicSupervisor. It oversees a per-shape storage & replication log consumer
          1. `Electric.Shapes.ConsumerSupervisor` supervises the "consumer" part of the replication process, starting 3 children. These are started for each shape.
              1. `Electric.ShapeCache.Storage` is a process that knows how to write to disk. Takes configuration options for the underlying storage, is an end point
              2. `Electric.Shapes.Consumer` is GenStage consumer, subscribing to `LogCollector`, which acts a shared producer for all shapes. It passes any incoming operation along to the storage.
              3. `Electric.Shapes.Consumer.Snapshotter` is a temporary GenServer that executes initial snapshot query and writes that to storage
      3. `Electric.Replication.PublicationManager` manages all filters on the publication for the replication
      2. `Electric.Replication.ShapeLogCollector` collects transactions from the replication connection, fanning them out to `Electric.Shapes.Consumer` (4.1.1.2)
      3. `Electric.ShapeCache` coordinates shape creation and handle allocation, shape metadata
  """
  use Supervisor, restart: :transient

  @opts_schema NimbleOptions.new!(
                 name: [type: :any, required: false],
                 stack_id: [type: :string, required: true],
                 persistent_kv: [type: :any, required: true],
                 stack_events_registry: [type: :atom, required: true],
                 connection_opts: [
                   type: :keyword_list,
                   required: true,
                   keys: Electric.connection_opts_schema()
                 ],
                 replication_opts: [
                   type: :keyword_list,
                   required: true,
                   keys: [
                     publication_name: [type: :string, required: true],
                     slot_name: [type: :string, required: true],
                     slot_temporary?: [type: :boolean, default: false],
                     try_creating_publication?: [type: :boolean, default: true],
                     stream_id: [type: :string, required: false]
                   ]
                 ],
                 pool_opts: [
                   type: :keyword_list,
                   required: false,
                   doc:
                     "will be passed on to the Postgrex connection pool. See `t:Postgrex.start_option()`, apart from the connection options."
                 ],
                 storage: [type: :mod_arg, required: true],
                 chunk_bytes_threshold: [
                   type: :pos_integer,
                   default: Electric.ShapeCache.LogChunker.default_chunk_size_threshold()
                 ],
                 tweaks: [
                   type: :keyword_list,
                   required: false,
                   doc:
                     "tweaks to the behaviour of parts of the supervision tree, used mostly for tests",
                   default: [],
                   keys: [
                     registry_partitions: [type: :non_neg_integer, required: false]
                   ]
                 ],
                 telemetry_span_attrs: [
                   # Validates the OpenTelemetry.attributes_map() type
                   # cf. https://github.com/open-telemetry/opentelemetry-erlang/blob/9f7affe630676d2803b04f69d0c759effb6e0245/apps/opentelemetry_api/src/opentelemetry.erl#L118
                   type:
                     {:or,
                      [
                        {:map, {:or, [:atom, :string]},
                         {:or,
                          [
                            :atom,
                            :string,
                            :integer,
                            :float,
                            :boolean,
                            {:list, {:or, [:atom, :string, :integer, :float, :boolean]}},
                            :map
                          ]}},
                        {:list,
                         {:tuple,
                          [
                            {:or, [:atom, :string]},
                            {:or,
                             [
                               :atom,
                               :string,
                               :integer,
                               :float,
                               :boolean,
                               {:list, {:or, [:atom, :string, :integer, :float, :boolean]}},
                               :map
                             ]}
                          ]}}
                      ]},
                   required: false
                 ]
               )

  def start_link(opts) do
    with {:ok, config} <- NimbleOptions.validate(Map.new(opts), @opts_schema) do
      Supervisor.start_link(__MODULE__, config, Keyword.take(opts, [:name]))
    end
  end

  def subscribe_to_stack_events(registry, stack_id, value) do
    Registry.register(registry, {:stack_status, stack_id}, value)
  end

  # noop if there's no registry running
  def dispatch_stack_event(nil, _stack_id, _event) do
    :ok
  end

  def dispatch_stack_event(registry, stack_id, event) do
    Registry.dispatch(registry, {:stack_status, stack_id}, fn entries ->
      for {pid, ref} <- entries do
        send(pid, {:stack_status, ref, event})
      end
    end)
  end

  def build_shared_opts(opts) do
    # needs validation
    opts = Map.new(opts)
    stack_id = opts[:stack_id]

    shape_changes_registry_name = :"#{Registry.ShapeChanges}:#{stack_id}"

    shape_cache =
      Access.get(
        opts,
        :shape_cache,
        {Electric.ShapeCache, stack_id: stack_id, server: Electric.ShapeCache.name(stack_id)}
      )

    publication_manager =
      Access.get(
        opts,
        :publication_manager,
        {Electric.Replication.PublicationManager,
         stack_id: stack_id, server: Electric.Replication.PublicationManager.name(stack_id)}
      )

    inspector =
      Access.get(
        opts,
        :inspector,
        {Electric.Postgres.Inspector.EtsInspector,
         stack_id: stack_id,
         server: Electric.Postgres.Inspector.EtsInspector.name(stack_id: stack_id)}
      )

    [
      shape_cache: shape_cache,
      publication_manager: publication_manager,
      registry: shape_changes_registry_name,
      stack_events_registry: opts[:stack_events_registry],
      storage: storage_mod_arg(opts),
      inspector: inspector,
      stack_id: stack_id,
      get_service_status: fn -> Electric.ServiceStatus.check(stack_id) end
    ]
  end

  @doc false
  def storage_mod_arg(%{stack_id: stack_id, storage: {mod, arg}}) do
    {mod, arg |> Keyword.put(:stack_id, stack_id) |> mod.shared_opts()}
  end

  @impl true
  def init(%{stack_id: stack_id} = config) do
    Process.set_label({:stack_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    inspector =
      Access.get(
        config,
        :inspector,
        {Electric.Postgres.Inspector.EtsInspector,
         stack_id: stack_id,
         server: Electric.Postgres.Inspector.EtsInspector.name(stack_id: stack_id)}
      )

    storage = storage_mod_arg(config)

    # This is a name of the ShapeLogCollector process
    shape_log_collector =
      Electric.Replication.ShapeLogCollector.name(stack_id)

    db_pool =
      Electric.ProcessRegistry.name(stack_id, Electric.DbPool)

    shape_changes_registry_name = :"#{Registry.ShapeChanges}:#{stack_id}"

    shape_cache_opts = [
      stack_id: stack_id,
      storage: storage,
      inspector: inspector,
      publication_manager: {Electric.Replication.PublicationManager, stack_id: stack_id},
      chunk_bytes_threshold: config.chunk_bytes_threshold,
      log_producer: shape_log_collector,
      consumer_supervisor: Electric.Shapes.DynamicConsumerSupervisor.name(stack_id),
      registry: shape_changes_registry_name
    ]

    new_connection_manager_opts = [
      stack_id: stack_id,
      # Coming from the outside, need validation
      connection_opts: config.connection_opts,
      stack_events_registry: config.stack_events_registry,
      replication_opts:
        [
          stack_id: stack_id,
          transaction_received:
            {Electric.Replication.ShapeLogCollector, :store_transaction, [shape_log_collector]},
          relation_received:
            {Electric.Replication.ShapeLogCollector, :handle_relation_msg, [shape_log_collector]}
        ] ++ config.replication_opts,
      pool_opts:
        [
          name: db_pool,
          types: PgInterop.Postgrex.Types
        ] ++ config.pool_opts,
      timeline_opts: [
        stack_id: stack_id,
        persistent_kv: config.persistent_kv
      ],
      shape_cache_opts: shape_cache_opts,
      tweaks: config.tweaks
    ]

    registry_partitions =
      Keyword.get(config.tweaks, :registry_partitions, System.schedulers_online())

    children = [
      {Electric.ProcessRegistry, partitions: registry_partitions, stack_id: stack_id},
      {Registry,
       name: shape_changes_registry_name, keys: :duplicate, partitions: registry_partitions},
      {Electric.Postgres.Inspector.EtsInspector, stack_id: stack_id, pool: db_pool},
      {Electric.Connection.Supervisor, new_connection_manager_opts}
    ]

    # Store the telemetry span attributes in the persistent term for this stack
    telemetry_span_attrs = Access.get(config, :telemetry_span_attrs, %{})

    if telemetry_span_attrs != %{},
      do:
        Electric.Telemetry.OpenTelemetry.set_stack_span_attrs(
          stack_id,
          telemetry_span_attrs
        )

    Supervisor.init(children, strategy: :one_for_one, auto_shutdown: :any_significant)
  end
end
