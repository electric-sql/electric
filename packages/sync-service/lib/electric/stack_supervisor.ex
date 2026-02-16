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
  4. `Electric.Shapes.Supervisor` is a supervisor responsible for taking the replication log from the replication client and shoving it into storage appropriately. It starts 3 things in one-for-all mode:
      1. `Electric.Shapes.DynamicConsumerSupervisor` is DynamicSupervisor. It oversees various per-shape processes
          1. `Electric.Shapes.Consumer` is a consumer subscribing to `LogCollector`, which acts a shared producer for all shapes. It passes any incoming operation along to the storage.
          2. `Electric.Shapes.Consumer.Snapshotter` is a temporary GenServer that executes initial snapshot query and writes that to storage
          3. `Electric.Shapes.Consumer.Materializer` monitors a sub-shape in order to invalidate dependent shapes
      2. `Electric.Replication.PublicationManager` manages all filters on the publication for the replication
      3. `Electric.Replication.ShapeLogCollector` collects transactions from the replication connection, fanning them out to `Electric.Shapes.Consumer` (4.1.1.2)
      4. `Electric.ShapeCache` coordinates shape creation and handle allocation, shape metadata
  """

  opts =
    if Application.compile_env(:electric, :start_in_library_mode, true) do
      [
        # Setting `restart: :transient` is required for passing the `:auto_shutdown` to `Supervisor.init()` below.
        restart: :transient
      ]
    else
      [
        restart: :transient,
        # Make StackSupervisor `significant` so that in the case that electric is in single-stack mode, the stack stopping
        # will stop the entire Electric application (since `auto_shutdown` is set to `:any_significant` in `Application`).
        significant: true
      ]
    end

  use Supervisor, opts

  alias Electric.ShapeCache.LogChunker

  require Logger

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
                 max_shapes: [type: {:or, [:non_neg_integer, nil]}, default: nil],
                 max_concurrent_requests: [
                   type: :map,
                   keys: [
                     initial: [type: :integer, required: true],
                     existing: [type: :integer, required: true]
                   ],
                   default: Electric.Config.default(:max_concurrent_requests)
                 ],
                 replication_opts: [
                   type: :keyword_list,
                   required: true,
                   keys: [
                     connection_opts: [
                       type: :keyword_list,
                       required: true,
                       keys: Electric.connection_opts_schema()
                     ],
                     publication_name: [type: :string, required: true],
                     slot_name: [type: :string, required: true],
                     slot_temporary?: [type: :boolean, default: false],
                     try_creating_publication?: [type: :boolean, default: true],
                     max_txn_size: [type: {:or, [:non_neg_integer, nil]}, default: nil],
                     max_batch_size: [
                       type: :non_neg_integer,
                       default: Electric.Config.default(:max_batch_size)
                     ],
                     replication_idle_timeout: [
                       type: :non_neg_integer,
                       default: Electric.Config.default(:replication_idle_timeout)
                     ]
                   ]
                 ],
                 pool_opts: [
                   type: :keyword_list,
                   required: false,
                   doc:
                     "will be passed on to the Postgrex connection pool. See `t:Postgrex.start_option()`, apart from the connection options."
                 ],
                 storage: [type: :mod_arg, required: true],
                 storage_dir: [type: :string, required: true],
                 chunk_bytes_threshold: [
                   type: :pos_integer,
                   default: LogChunker.default_chunk_size_threshold()
                 ],
                 feature_flags: [type: {:list, :string}, default: []],
                 tweaks: [
                   type: :keyword_list,
                   required: false,
                   doc:
                     "tweaks to the behaviour of parts of the supervision tree, used mostly for tests",
                   default: [],
                   keys: [
                     publication_alter_debounce_ms: [type: :non_neg_integer, default: 0],
                     cleanup_interval_ms: [type: :non_neg_integer, default: 10_000],
                     registry_partitions: [type: :non_neg_integer, required: false],
                     shape_cleaner_opts: [
                       type: :keyword_list,
                       required: false,
                       keys: [
                         on_cleanup: [type: {:fun, 1}]
                       ]
                     ],
                     publication_refresh_period: [type: :non_neg_integer, default: 60_000],
                     schema_reconciler_period: [type: :non_neg_integer, default: 60_000],
                     shape_hibernate_after: [
                       type: :integer,
                       default: Electric.Config.default(:shape_hibernate_after)
                     ],
                     shape_enable_suspend?: [
                       type: :boolean,
                       default: Electric.Config.default(:shape_enable_suspend?)
                     ],
                     snapshot_timeout_to_first_data: [
                       type: :pos_integer,
                       default: Electric.Config.default(:snapshot_timeout_to_first_data)
                     ],
                     conn_max_requests: [
                       type: :pos_integer,
                       default: Electric.Config.default(:conn_max_requests)
                     ],
                     process_spawn_opts: [type: :map, default: %{}]
                   ]
                 ],
                 manual_table_publishing?: [
                   type: :boolean,
                   required: false,
                   doc:
                     "Specify whether tables are to be added to the Postgres publication automatically or by hand",
                   default: false
                 ],
                 shape_db_opts: [
                   type: :keyword_list,
                   required: true,
                   doc: "Configuration of the shape db sub-system",
                   keys: [
                     storage_dir: [type: :string, required: true],
                     exclusive_mode: [type: :boolean],
                     synchronous: [type: :string],
                     cache_size: [type: :integer]
                   ]
                 ],
                 telemetry_opts: [type: :keyword_list, default: []],
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

  def opts_schema do
    @opts_schema
  end

  def start_link(opts) do
    opts = obfuscate_password(opts)

    with {:ok, config} <- NimbleOptions.validate(Map.new(opts), @opts_schema) do
      Supervisor.start_link(__MODULE__, config, Keyword.take(opts, [:name]))
    end
  end

  defp obfuscate_password(opts) when is_list(opts) do
    opts
    |> Keyword.update(:connection_opts, [], &Electric.Utils.obfuscate_password/1)
    |> Keyword.update(:replication_opts, [], fn repl_opts ->
      Keyword.update(repl_opts, :connection_opts, [], &Electric.Utils.obfuscate_password/1)
    end)
  end

  def subscribe_to_stack_events(
        registry \\ Electric.stack_events_registry(),
        stack_id,
        ref \\ make_ref()
      )

  def subscribe_to_stack_events(registry, stack_id, ref) do
    {:ok, _pid} = Registry.register(registry, {:stack_status, stack_id}, ref)
    ref
  end

  def dispatch_stack_event(registry \\ Electric.stack_events_registry(), stack_id, event)

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

  def subscribe_to_shape_events(stack_id, handle, ref \\ make_ref()) do
    registry = Electric.StackSupervisor.registry_name(stack_id)
    Registry.register(registry, handle, ref)
    ref
  end

  def build_shared_opts(opts) do
    # needs validation
    opts = Map.new(opts)
    stack_id = opts[:stack_id]

    shape_changes_registry_name = registry_name(stack_id)

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
        {Electric.Replication.PublicationManager, stack_id: stack_id}
      )

    persistent_kv = Access.fetch!(opts, :persistent_kv)

    [
      shape_cache: shape_cache,
      publication_manager: publication_manager,
      registry: shape_changes_registry_name,
      stack_events_registry: opts[:stack_events_registry],
      storage: shared_storage_opts(opts),
      inspector: shared_inspector_opts(opts),
      stack_id: stack_id,
      persistent_kv: persistent_kv,
      feature_flags: Map.get(opts, :feature_flags, []),
      max_concurrent_requests:
        Map.get(opts, :max_concurrent_requests, Electric.Config.default(:max_concurrent_requests))
    ]
  end

  def registry_name(stack_id) do
    :"Electric.Registry.ShapeChanges:#{stack_id}"
  end

  defp shared_storage_opts(config) do
    {mod, storage_opts} = config.storage

    storage_opts =
      storage_opts
      |> Keyword.put(:stack_id, config.stack_id)
      |> Keyword.put(:chunk_bytes_threshold, config[:chunk_bytes_threshold])

    Electric.ShapeCache.Storage.shared_opts({mod, storage_opts})
  end

  defp shared_inspector_opts(config) do
    Map.get_lazy(
      config,
      :inspector,
      fn ->
        {Electric.Postgres.Inspector.EtsInspector,
         stack_id: config.stack_id,
         server: Electric.Postgres.Inspector.EtsInspector.name(config.stack_id)}
      end
    )
  end

  @impl true
  def init(%{stack_id: stack_id} = config) do
    Logger.debug("StackSupervisor for stack #{inspect(stack_id)} is initializing...")

    Process.set_label({:stack_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    storage = shared_storage_opts(config)
    inspector = shared_inspector_opts(config)

    metadata_db_pool = Electric.Connection.Manager.admin_pool(stack_id)

    shape_changes_registry_name = registry_name(stack_id)

    shape_hibernate_after = Keyword.fetch!(config.tweaks, :shape_hibernate_after)
    shape_enable_suspend? = Keyword.fetch!(config.tweaks, :shape_enable_suspend?)
    process_spawn_opts = Keyword.fetch!(config.tweaks, :process_spawn_opts)

    shape_cache_opts = [
      stack_id: stack_id
    ]

    connection_manager_opts = [
      stack_id: stack_id,
      # Coming from the outside, need validation
      connection_opts: config.connection_opts,
      stack_events_registry: config.stack_events_registry,
      replication_opts:
        [
          stack_id: stack_id,
          handle_event: {Electric.Replication.ShapeLogCollector, :handle_event, [stack_id]}
        ] ++ config.replication_opts,
      pool_opts: [types: PgInterop.Postgrex.Types] ++ config.pool_opts,
      timeline_opts: [
        stack_id: stack_id,
        persistent_kv: config.persistent_kv
      ],
      persistent_kv: config.persistent_kv,
      shape_cache_opts: shape_cache_opts,
      inspector: inspector,
      max_shapes: config.max_shapes,
      tweaks: config.tweaks,
      manual_table_publishing?: config.manual_table_publishing?
    ]

    registry_partitions =
      Keyword.get(config.tweaks, :registry_partitions, System.schedulers_online())

    telemetry_child = Electric.StackSupervisor.Telemetry.configure(config)

    children =
      [
        telemetry_child,
        {Electric.ProcessRegistry, partitions: registry_partitions, stack_id: stack_id},
        {Electric.StackConfig,
         stack_id: stack_id,
         seed_config: [
           chunk_bytes_threshold: config.chunk_bytes_threshold,
           snapshot_timeout_to_first_data: config.tweaks[:snapshot_timeout_to_first_data],
           inspector: inspector,
           shape_hibernate_after: shape_hibernate_after,
           shape_enable_suspend?: shape_enable_suspend?,
           process_spawn_opts: process_spawn_opts,
           feature_flags: Map.get(config, :feature_flags, [])
         ]},
        {Electric.AsyncDeleter,
         stack_id: stack_id,
         storage_dir: config.storage_dir,
         cleanup_interval_ms: config.tweaks[:cleanup_interval_ms]},
        {Registry,
         name: shape_changes_registry_name, keys: :duplicate, partitions: registry_partitions},
        Electric.ShapeCache.Storage.stack_child_spec(storage),
        {Electric.Postgres.Inspector.EtsInspector,
         stack_id: stack_id, pool: metadata_db_pool, persistent_kv: config.persistent_kv},
        {Electric.MonitoredCoreSupervisor,
         stack_id: stack_id,
         connection_manager_opts: connection_manager_opts,
         shape_db_opts: config.shape_db_opts}
      ]
      |> Enum.reject(&is_nil/1)

    Supervisor.init(children, strategy: :one_for_one, auto_shutdown: :any_significant)
  end
end
