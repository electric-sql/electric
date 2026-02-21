defmodule Support.ComponentSetup do
  import ExUnit.Callbacks
  import ExUnit.Assertions
  import Support.TestUtils, only: [full_test_name: 1]

  alias Electric.ShapeCache.Storage
  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache
  alias Electric.ShapeCache.PureFileStorage
  alias Electric.ShapeCache.InMemoryStorage
  alias Electric.Postgres.Inspector.EtsInspector

  defmodule NoopPublicationManager do
    use GenServer

    def add_shape(_stack_id, _handle, _shape), do: :ok
    def remove_shape(_stack_id, _handle), do: :ok
    def wait_for_restore(_stack_id, _opts), do: :ok

    def start_link(stack_id) do
      GenServer.start_link(__MODULE__, [],
        name: Electric.Replication.PublicationManager.name(stack_id)
      )
    end

    def init([]) do
      {:ok, []}
    end

    def handle_call({:add_shape, _shape_handle, _pub_filter}, _from, state),
      do: {:reply, :ok, state}

    def handle_call({:remove_shape, _shape_handle}, _from, state),
      do: {:reply, :ok, state}

    def handle_call(:wait_for_restore, _from, state),
      do: {:reply, :ok, state}
  end

  defmodule TestPublicationManager do
    use GenServer

    def add_shape(stack_id, handle, shape) do
      GenServer.call(
        Electric.Replication.PublicationManager.name(stack_id),
        {:add_shape, handle, shape}
      )
    end

    def remove_shape(stack_id, handle) do
      GenServer.call(
        Electric.Replication.PublicationManager.name(stack_id),
        {:remove_shape, handle}
      )
    end

    def wait_for_restore(stack_id, _opts) do
      GenServer.call(
        Electric.Replication.PublicationManager.name(stack_id),
        :wait_for_restore
      )
    end

    def start_link(ctx) do
      GenServer.start_link(__MODULE__, ctx.test_pid,
        name: Electric.Replication.PublicationManager.name(ctx.stack_id)
      )
    end

    def init(test_pid) do
      {:ok, test_pid}
    end

    def handle_call({:add_shape, handle, shape}, _from, test_pid) do
      send(test_pid, {TestPublicationManager, :add_shape, handle, shape})
      {:reply, :ok, test_pid}
    end

    def handle_call({:remove_shape, handle}, _from, test_pid) do
      send(test_pid, {TestPublicationManager, :remove_shape, handle})
      {:reply, :ok, test_pid}
    end

    def handle_call(:wait_for_restore, _from, test_pid) do
      send(test_pid, {TestPublicationManager, :wait_for_restore})
      {:reply, :ok, test_pid}
    end
  end

  def with_stack_id_from_test(ctx) do
    stack_id = full_test_name(ctx)
    registry = start_supervised!({Electric.ProcessRegistry, stack_id: stack_id})

    seed_config = Map.get(ctx, :stack_config_seed, [])

    start_supervised!(
      {Electric.StackConfig,
       stack_id: stack_id,
       seed_config:
         Keyword.merge(
           [
             chunk_bytes_threshold:
               Map.get(
                 ctx,
                 :chunk_bytes_threshold,
                 Electric.ShapeCache.LogChunker.default_chunk_size_threshold()
               ),
             snapshot_timeout_to_first_data: :timer.seconds(30),
             inspector: Map.get(ctx, :inspector, nil),
             shape_changes_registry:
               Map.get(ctx, :registry, Electric.StackSupervisor.registry_name(stack_id)),
             shape_hibernate_after: Map.get(ctx, :shape_hibernate_after, 1_000),
             shape_enable_suspend?: Map.get(ctx, :suspend, false),
             feature_flags: Electric.Config.get_env(:feature_flags),
             process_spawn_opts: Map.get(ctx, :process_spawn_opts, %{})
           ],
           seed_config
         )}
    )

    %{stack_id: stack_id, process_registry: registry}
  end

  def with_registry(ctx) do
    registry_name = Electric.StackSupervisor.registry_name(ctx.stack_id)

    start_supervised!({Registry, keys: :duplicate, name: registry_name})

    %{registry: registry_name}
  end

  def with_async_deleter(ctx) do
    storage_dir =
      ctx[:storage_dir] || ctx[:tmp_dir] ||
        Path.join(
          System.tmp_dir!(),
          "electric-trash-#{System.monotonic_time()}-#{System.unique_integer([:positive, :monotonic])}"
        )

    start_supervised!(
      {Electric.AsyncDeleter,
       stack_id: ctx.stack_id, storage_dir: storage_dir, cleanup_interval_ms: 0}
    )

    %{}
  end

  def with_in_memory_storage(ctx) do
    storage =
      Storage.shared_opts(
        {InMemoryStorage,
         table_base_name: :"in_memory_storage_#{ctx.stack_id}", stack_id: ctx.stack_id}
      )

    start_supervised!(Storage.stack_child_spec(storage), restart: :temporary)

    %{storage: storage}
  end

  def with_tracing_storage(%{storage: storage}) do
    [storage: Support.TestStorage.wrap(storage, %{})]
  end

  def with_no_pool(_ctx) do
    %{pool: :no_pool}
  end

  def with_pure_file_storage(ctx) do
    storage =
      Storage.shared_opts(
        {PureFileStorage,
         [storage_dir: ctx.tmp_dir, stack_id: ctx.stack_id] ++
           Map.get(ctx, :with_pure_file_storage_opts, [])}
      )

    start_supervised!(Storage.stack_child_spec(storage), restart: :temporary)

    %{storage: storage, storage_dir: ctx.tmp_dir}
  end

  def with_persistent_kv(_ctx) do
    kv = Electric.PersistentKV.Memory.new!()
    %{persistent_kv: kv}
  end

  def with_log_chunking(_ctx) do
    %{chunk_bytes_threshold: Electric.ShapeCache.LogChunker.default_chunk_size_threshold()}
  end

  def with_shape_cleaner(ctx) do
    start_supervised!(
      {Electric.ShapeCache.ShapeCleaner.CleanupTaskSupervisor,
       Keyword.merge(shape_cleaner_opts(ctx), stack_id: ctx.stack_id)}
    )

    :ok
  end

  def with_publication_manager(ctx) do
    server = Electric.Replication.PublicationManager.name(ctx.stack_id)

    start_supervised!(%{
      id: server,
      start: {
        Electric.Replication.PublicationManager,
        :start_link,
        [
          [
            stack_id: ctx.stack_id,
            publication_name: ctx.publication_name,
            update_debounce_timeout: Access.get(ctx, :update_debounce_timeout, 0),
            db_pool: ctx.pool,
            manual_table_publishing?: Access.get(ctx, :manual_table_publishing?, false)
          ]
        ]
      },
      restart: :temporary
    })

    call_target = Electric.Replication.PublicationManager.RelationTracker.name(ctx.stack_id)

    %{
      publication_manager:
        {Electric.Replication.PublicationManager, stack_id: ctx.stack_id, server: call_target}
    }
  end

  def with_test_publication_manager(ctx) do
    publication_manager = start_supervised!({TestPublicationManager, ctx})

    %{publication_manager: publication_manager}
  end

  def with_noop_publication_manager(ctx) do
    start_supervised!({NoopPublicationManager, ctx.stack_id})
    :ok
  end

  def with_shape_status(ctx) do
    %{shape_db: shape_db} = with_shape_db(ctx)

    start_supervised!(%{
      id: "shape_status_owner",
      start: {Electric.ShapeCache.ShapeStatusOwner, :start_link, [[stack_id: ctx.stack_id]]},
      restart: :temporary
    })

    :ok = Electric.ShapeCache.ShapeStatusOwner.initialize(ctx.stack_id)

    %{shape_status_owner: "shape_status_owner", shape_db: shape_db}
  end

  def with_shape_db(ctx) do
    shape_db_opts = Map.get(ctx, :shape_db_opts, [])

    start_supervised!(
      {Electric.ShapeCache.ShapeStatus.ShapeDb.Supervisor,
       [
         stack_id: ctx.stack_id,
         shape_db_opts:
           Keyword.merge(
             [
               storage_dir: ctx.tmp_dir,
               manual_flush_only: true
             ],
             shape_db_opts
           )
       ]},
      id: "shape_db"
    )

    %{shape_db: "shape_db"}
  end

  def with_dynamic_consumer_supervisor(%{consumer_supervisor: name} = ctx) do
    if GenServer.whereis(name) do
      ctx
    else
      start_consumer_supervisor(ctx)
    end
  end

  def with_dynamic_consumer_supervisor(ctx) do
    start_consumer_supervisor(ctx)
  end

  defp start_consumer_supervisor(ctx) do
    consumer_supervisor = :"consumer_supervisor_#{full_test_name(ctx)}"

    {Electric.Shapes.DynamicConsumerSupervisor, [stack_id: ctx.stack_id]}
    |> Supervisor.child_spec(id: consumer_supervisor, restart: :temporary)
    |> start_supervised!()

    %{consumer_supervisor: consumer_supervisor}
  end

  def with_shape_cache(ctx, additional_opts \\ []) do
    start_supervised!(
      {Task.Supervisor,
       name: Electric.ProcessRegistry.name(ctx.stack_id, Electric.StackTaskSupervisor)}
      |> Supervisor.child_spec(id: "shape_task_supervisor")
    )

    %{consumer_supervisor: consumer_supervisor} = with_dynamic_consumer_supervisor(ctx)

    start_opts =
      [stack_id: ctx.stack_id]
      |> Keyword.merge(additional_opts)

    start_supervised!(%{
      id: "shape_cache",
      start: {ShapeCache, :start_link, [start_opts]},
      restart: :temporary
    })

    %{
      shape_cache: "shape_cache",
      consumer_supervisor: consumer_supervisor
    }
  end

  def with_lsn_tracker(%{stack_id: stack_id}) do
    Electric.LsnTracker.initialize(stack_id)
    Electric.LsnTracker.set_last_processed_lsn(stack_id, Electric.Postgres.Lsn.from_integer(0))
    :ok
  end

  def with_consumer_registry(ctx) do
    pid =
      start_supervised!(
        {Agent,
         fn ->
           {:ok, registry_state} =
             Electric.Shapes.ConsumerRegistry.new(
               ctx.stack_id,
               Map.get(ctx, :consumer_registry_opts, [])
             )

           registry_state
         end}
      )

    %{consumer_registry: pid}
  end

  def with_shape_log_collector(ctx) do
    name = :"shape_log_collector_#{ctx.stack_id}"

    start_supervised!(
      {ShapeLogCollector.Supervisor,
       [stack_id: ctx.stack_id, inspector: ctx.inspector, persistent_kv: ctx.persistent_kv]},
      id: name,
      restart: :temporary
    )

    %{shape_log_collector: name}
  end

  def with_slot_name(ctx) do
    # Derive a deterministic (per test) replication slot name from the full test name.
    # We hash the test name to (a) stay within Postgres identifier length limits (<= 63 bytes)
    # and (b) restrict characters to [a-z0-9_]. Using a stable hash also prevents collisions
    # across concurrently running test databases referencing different DB OIDs.
    base = full_test_name(ctx)

    hash =
      :crypto.hash(:sha256, base)
      |> Base.encode16(case: :lower)
      |> binary_part(0, 12)

    %{
      slot_name: "electric_test_slot_" <> hash
    }
  end

  def with_inspector(ctx) do
    server =
      start_supervised!(
        {EtsInspector,
         stack_id: ctx.stack_id, pool: ctx.db_conn, persistent_kv: ctx.persistent_kv}
      )

    pg_inspector_table = EtsInspector.inspector_table(stack_id: ctx.stack_id)

    Electric.StackConfig.put(
      ctx.stack_id,
      :inspector,
      {EtsInspector, stack_id: ctx.stack_id, server: server}
    )

    %{
      inspector: {EtsInspector, stack_id: ctx.stack_id, server: server},
      pg_inspector_table: pg_inspector_table,
      inspector_pid: server
    }
  end

  def with_status_monitor(ctx) do
    start_supervised!({Electric.StatusMonitor, stack_id: ctx.stack_id})
    %{}
  end

  def shape_cleaner_opts(ctx) do
    parent = self()

    on_cleanup =
      Map.get(ctx, :on_shape_cleanup, fn handle ->
        send(parent, {Electric.ShapeCache.ShapeCleaner, :cleanup, handle})
      end)

    [on_cleanup: on_cleanup]
  end

  def with_complete_stack(ctx) do
    stack_id = full_test_name(ctx)

    kv = %Electric.PersistentKV.Memory{
      parent: self(),
      pid: start_supervised!(Electric.PersistentKV.Memory, restart: :temporary)
    }

    storage =
      {PureFileStorage, stack_id: stack_id, storage_dir: ctx.tmp_dir}

    stack_events_registry = Electric.stack_events_registry()

    ref = Electric.StackSupervisor.subscribe_to_stack_events(stack_id)

    publication_name =
      Map.get(ctx, :publication_name, "electric_test_pub_#{:erlang.phash2(stack_id)}")

    connection_opts =
      Keyword.merge(ctx.pooled_db_config, List.wrap(ctx[:connection_opt_overrides]))

    replication_connection_opts =
      Keyword.merge(ctx.db_config, List.wrap(ctx[:connection_opt_overrides]))

    stack_supervisor =
      start_supervised!(
        {Electric.StackSupervisor,
         stack_id: stack_id,
         stack_events_registry: stack_events_registry,
         chunk_bytes_threshold:
           Map.get(
             ctx,
             :chunk_size,
             Electric.ShapeCache.LogChunker.default_chunk_size_threshold()
           ),
         persistent_kv: kv,
         storage: storage,
         storage_dir: ctx.tmp_dir,
         connection_opts: connection_opts,
         replication_opts:
           Keyword.merge(
             [
               connection_opts: replication_connection_opts,
               slot_name: "electric_test_slot_#{:erlang.phash2(stack_id)}",
               publication_name: publication_name,
               try_creating_publication?: true,
               slot_temporary?: true
             ],
             List.wrap(ctx[:replication_opts_overrides])
           ),
         pool_opts: [
           backoff_type: :stop,
           max_restarts: 0,
           pool_size: 2
         ],
         tweaks: [
           registry_partitions: 1,
           shape_cleaner_opts: shape_cleaner_opts(ctx)
         ],
         manual_table_publishing?: Map.get(ctx, :manual_table_publishing?, false),
         telemetry_opts: [instance_id: "test_instance", version: Electric.version()],
         feature_flags: Electric.Config.get_env(:feature_flags),
         shape_db_opts: [
           storage_dir: ctx.tmp_dir
         ]},
        restart: :temporary,
        significant: false
      )

    # allow a reasonable time for full stack setup to account for
    # potential CI slowness, including PG
    assert_receive {:stack_status, ^ref, :ready}, 2000

    %{
      stack_id: stack_id,
      registry: Electric.StackSupervisor.registry_name(stack_id),
      stack_events_registry: stack_events_registry,
      shape_cache: {ShapeCache, [stack_id: stack_id]},
      persistent_kv: kv,
      stack_supervisor: stack_supervisor,
      storage: storage,
      inspector:
        {EtsInspector, stack_id: stack_id, server: EtsInspector.name(stack_id: stack_id)},
      feature_flags: Electric.Config.get_env(:feature_flags),
      publication_name: publication_name
    }
  end

  def secure_mode(_ctx) do
    %{secret: "test_secret_#{:erlang.unique_integer()}"}
  end

  def build_router_opts(ctx, overrides \\ []) do
    [
      long_poll_timeout: 4_000,
      max_age: 60,
      stale_age: 300,
      allow_shape_deletion: true,
      secret: ctx[:secret]
    ]
    |> Keyword.merge(
      Electric.StackSupervisor.build_shared_opts(
        stack_id: ctx.stack_id,
        stack_events_registry: ctx.stack_events_registry,
        storage: ctx.storage,
        persistent_kv: ctx.persistent_kv,
        feature_flags: ctx.feature_flags
      )
    )
    |> Keyword.merge(overrides)
    |> Electric.Shapes.Api.plug_opts()
  end
end
