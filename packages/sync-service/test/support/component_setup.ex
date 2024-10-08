defmodule Support.ComponentSetup do
  import ExUnit.Callbacks
  alias Electric.Postgres.ReplicationClient
  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache
  alias Electric.ShapeCache.FileStorage
  alias Electric.ShapeCache.InMemoryStorage
  alias Electric.Postgres.Inspector.EtsInspector

  def with_electric_instance_id(ctx) do
    %{electric_instance_id: String.to_atom(full_test_name(ctx))}
  end

  def with_tenant_id(_ctx) do
    %{tenant_id: "test_tenant"}
  end

  def with_registry(ctx) do
    registry_name = Module.concat(Registry, ctx.electric_instance_id)
    start_link_supervised!({Registry, keys: :duplicate, name: registry_name})

    %{registry: registry_name}
  end

  def with_in_memory_storage(ctx) do
    {:ok, storage_opts} =
      InMemoryStorage.shared_opts(
        table_base_name: :"in_memory_storage_#{full_test_name(ctx)}",
        electric_instance_id: ctx.electric_instance_id,
        tenant_id: ctx.tenant_id
      )

    %{storage: {InMemoryStorage, storage_opts}}
  end

  def with_no_pool(_ctx) do
    %{pool: :no_pool}
  end

  def with_cub_db_storage(ctx) do
    {:ok, storage_opts} =
      FileStorage.shared_opts(
        storage_dir: ctx.tmp_dir,
        electric_instance_id: ctx.electric_instance_id,
        tenant_id: ctx.tenant_id
      )

    %{storage: {FileStorage, storage_opts}}
  end

  def with_persistent_kv(_ctx) do
    kv = Electric.PersistentKV.Memory.new!()
    %{persistent_kv: kv}
  end

  def with_log_chunking(_ctx) do
    %{chunk_bytes_threshold: Electric.ShapeCache.LogChunker.default_chunk_size_threshold()}
  end

  def with_shape_cache(ctx, additional_opts \\ []) do
    shape_meta_table = :"shape_meta_#{full_test_name(ctx)}"
    server = :"shape_cache_#{full_test_name(ctx)}"
    consumer_supervisor = :"consumer_supervisor_#{full_test_name(ctx)}"
    get_pg_version = fn -> Application.fetch_env!(:electric, :pg_version_for_tests) end

    start_opts =
      [
        name: server,
        electric_instance_id: ctx.electric_instance_id,
        tenant_id: ctx.tenant_id,
        shape_meta_table: shape_meta_table,
        inspector: ctx.inspector,
        storage: ctx.storage,
        chunk_bytes_threshold: ctx.chunk_bytes_threshold,
        db_pool: ctx.pool,
        persistent_kv: ctx.persistent_kv,
        registry: ctx.registry,
        log_producer: ctx.shape_log_collector,
        consumer_supervisor: consumer_supervisor
      ]
      |> Keyword.merge(additional_opts)
      |> Keyword.put_new_lazy(:prepare_tables_fn, fn ->
        {
          Electric.Postgres.Configuration,
          :configure_tables_for_replication!,
          [get_pg_version, ctx.publication_name]
        }
      end)

    {:ok, _pid} =
      Electric.Shapes.ConsumerSupervisor.start_link(
        name: consumer_supervisor,
        electric_instance_id: ctx.electric_instance_id,
        tenant_id: ctx.tenant_id
      )

    {:ok, _pid} = ShapeCache.start_link(start_opts)

    shape_cache_opts = [
      server: server,
      shape_meta_table: shape_meta_table,
      storage: ctx.storage
    ]

    %{
      shape_cache_opts: shape_cache_opts,
      shape_cache: {ShapeCache, shape_cache_opts},
      shape_cache_server: server,
      consumer_supervisor: consumer_supervisor
    }
  end

  def with_shape_log_collector(ctx) do
    {:ok, _} =
      ShapeLogCollector.start_link(
        electric_instance_id: ctx.electric_instance_id,
        tenant_id: ctx.tenant_id,
        inspector: ctx.inspector,
        link_consumers: Map.get(ctx, :link_log_collector, true)
      )

    %{shape_log_collector: ShapeLogCollector.name(ctx.electric_instance_id, ctx.tenant_id)}
  end

  def with_replication_client(ctx) do
    replication_opts = [
      publication_name: ctx.publication_name,
      try_creating_publication?: true,
      slot_name: ctx.slot_name,
      transaction_received:
        {Electric.Replication.ShapeLogCollector, :store_transaction, [ctx.shape_log_collector]},
      relation_received:
        {Electric.Replication.ShapeLogCollector, :handle_relation_msg, [ctx.shape_log_collector]}
    ]

    {:ok, pid} = ReplicationClient.start_link(ctx.db_config, replication_opts)
    %{replication_client: pid}
  end

  def with_inspector(ctx) do
    server = :"inspector #{full_test_name(ctx)}"
    pg_info_table = :"pg_info_table #{full_test_name(ctx)}"

    {:ok, _} =
      EtsInspector.start_link(pg_info_table: pg_info_table, pool: ctx.db_conn, name: server)

    %{inspector: {EtsInspector, pg_info_table: pg_info_table, server: server}}
  end

  def with_complete_stack(ctx, opts \\ []) do
    [
      Keyword.get(opts, :electric_instance_id, &with_electric_instance_id/1),
      Keyword.get(opts, :tenant_id, &with_tenant_id/1),
      Keyword.get(opts, :registry, &with_registry/1),
      Keyword.get(opts, :inspector, &with_inspector/1),
      Keyword.get(opts, :persistent_kv, &with_persistent_kv/1),
      Keyword.get(opts, :log_chunking, &with_log_chunking/1),
      Keyword.get(opts, :storage, &with_cub_db_storage/1),
      Keyword.get(opts, :log_collector, &with_shape_log_collector/1),
      Keyword.get(opts, :shape_cache, &with_shape_cache/1),
      Keyword.get(opts, :replication_client, &with_replication_client/1)
    ]
    |> Enum.reduce(ctx, &Map.merge(&2, apply(&1, [&2])))
  end

  def build_router_opts(ctx, overrides \\ []) do
    [
      # TODO: make a with_tenant_manager function and add it in with_complete_stack
      tenant_manager: ctx.tenant_manager,
      storage: ctx.storage,
      registry: ctx.registry,
      shape_cache: ctx.shape_cache,
      inspector: ctx.inspector,
      long_poll_timeout: Access.get(overrides, :long_poll_timeout, 5_000),
      max_age: Access.get(overrides, :max_age, 60),
      stale_age: Access.get(overrides, :stale_age, 300),
      get_service_status: Access.get(overrides, :get_service_status, fn -> :active end),
      chunk_bytes_threshold:
        Access.get(overrides, :chunk_bytes_threshold, ctx.chunk_bytes_threshold),
      allow_shape_deletion: Access.get(overrides, :allow_shape_deletion, true)
    ]
    |> Keyword.merge(overrides)
  end

  def full_test_name(ctx) do
    "#{ctx.module} #{ctx.test}"
  end
end
