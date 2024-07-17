defmodule Support.ComponentSetup do
  alias Electric.ShapeCache
  alias Electric.ShapeCache.CubDbStorage
  alias Electric.ShapeCache.InMemoryStorage

  def with_in_memory_storage(ctx) do
    {:ok, storage_opts} =
      InMemoryStorage.shared_opts(
        snapshot_ets_table: :"snapshot_ets_#{full_test_name(ctx)}",
        log_ets_table: :"log_ets_#{full_test_name(ctx)}"
      )

    {:ok, _} = InMemoryStorage.start_link(storage_opts)

    {:ok, %{storage: {InMemoryStorage, storage_opts}}}
  end

  def with_cub_db_storage(ctx) do
    {:ok, storage_opts} =
      CubDbStorage.shared_opts(
        db: :"shape_cubdb_#{full_test_name(ctx)}",
        file_path: ctx.tmp_dir
      )

    {:ok, _} = CubDbStorage.start_link(storage_opts)

    {:ok, %{storage: {CubDbStorage, storage_opts}}}
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

    %{
      shape_cache_opts: [
        server: server,
        shape_meta_table: shape_meta_table,
        storage: ctx.storage
      ]
    }
  end

  def full_test_name(ctx) do
    "#{ctx.module} #{ctx.test}"
  end
end
