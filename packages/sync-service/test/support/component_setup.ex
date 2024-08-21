defmodule Support.ComponentSetup do
  import ExUnit.Callbacks
  alias Electric.Postgres.ReplicationClient
  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache
  alias Electric.ShapeCache.CubDbStorage
  alias Electric.ShapeCache.InMemoryStorage
  alias Electric.Postgres.Inspector.EtsInspector

  def with_registry(ctx) do
    registry_name = Module.concat(Registry, String.to_atom(full_test_name(ctx)))
    start_link_supervised!({Registry, keys: :duplicate, name: registry_name})

    %{registry: registry_name}
  end

  def with_in_memory_storage(ctx) do
    {:ok, storage_opts} =
      InMemoryStorage.shared_opts(
        snapshot_ets_table: :"snapshot_ets_#{full_test_name(ctx)}",
        log_ets_table: :"log_ets_#{full_test_name(ctx)}"
      )

    {:ok, _} = InMemoryStorage.start_link(storage_opts)

    %{storage: {InMemoryStorage, storage_opts}}
  end

  def with_no_pool(_ctx) do
    %{pool: :no_pool}
  end

  def with_cub_db_storage(ctx) do
    {:ok, storage_opts} =
      CubDbStorage.shared_opts(
        db: :"shape_cubdb_#{full_test_name(ctx)}",
        file_path: ctx.tmp_dir
      )

    {:ok, _} = CubDbStorage.start_link(storage_opts)

    %{storage: {CubDbStorage, storage_opts}}
  end

  def with_shape_cache(ctx, additional_opts \\ []) do
    shape_meta_table = :"shape_meta_#{full_test_name(ctx)}"
    server = :"shape_cache_#{full_test_name(ctx)}"

    start_opts =
      [
        name: server,
        shape_meta_table: shape_meta_table,
        storage: ctx.storage,
        db_pool: ctx.pool
      ]
      |> Keyword.merge(additional_opts)
      |> Keyword.put_new_lazy(:prepare_tables_fn, fn ->
        {Electric.Postgres.Configuration, :configure_tables_for_replication!,
         [ctx.publication_name]}
      end)

    {:ok, _pid} = ShapeCache.start_link(start_opts)

    shape_cache_opts = [
      server: server,
      shape_meta_table: shape_meta_table,
      storage: ctx.storage
    ]

    %{
      shape_cache_opts: shape_cache_opts,
      shape_cache: {ShapeCache, shape_cache_opts}
    }
  end

  def with_shape_log_collector(ctx) do
    server = :"shape_log_collector #{full_test_name(ctx)}"

    {:ok, _} =
      ShapeLogCollector.start_link(
        name: server,
        registry: ctx.registry,
        shape_cache: {Electric.ShapeCache, ctx.shape_cache_opts},
        inspector: ctx.inspector
      )

    %{shape_log_collector: server}
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

  def with_complete_stack(ctx) do
    [
      &with_registry/1,
      &with_inspector/1,
      &with_cub_db_storage/1,
      &with_shape_cache/1,
      &with_shape_log_collector/1,
      &with_replication_client/1
    ]
    |> Enum.reduce(ctx, &Map.merge(&2, apply(&1, [&2])))
  end

  def build_router_opts(ctx, overrides \\ []) do
    [
      storage: ctx.storage,
      registry: ctx.registry,
      shape_cache: ctx.shape_cache,
      inspector: ctx.inspector,
      long_poll_timeout: Access.get(overrides, :long_poll_timeout, 5_000),
      max_age: Access.get(overrides, :max_age, 60),
      stale_age: Access.get(overrides, :stale_age, 300),
      allow_shape_deletion: Access.get(overrides, :allow_shape_deletion, true)
    ]
    |> Keyword.merge(overrides)
  end

  defp full_test_name(ctx) do
    "#{ctx.module} #{ctx.test}"
  end
end
