defmodule Support.ComponentSetup do
  alias Electric.ShapeCache
  alias Electric.ShapeCache.InMemoryStorage

  def with_in_memory_storage(ctx) do
    {:ok, storage_opts} =
      InMemoryStorage.shared_opts(
        snapshot_ets_table: :"snapshot_ets_#{ctx.test}",
        log_ets_table: :"log_ets_#{ctx.test}"
      )

    {:ok, _} = InMemoryStorage.start_link(storage_opts)

    {:ok, %{storage: {InMemoryStorage, storage_opts}}}
  end

  def with_shape_cache(ctx, additional_opts \\ []) do
    shape_meta_table = :"shape_meta_#{ctx.test}"

    start_opts =
      [
        name: :"shape_cache_#{ctx.test}",
        shape_meta_table: shape_meta_table,
        storage: ctx.storage,
        db_pool: ctx.pool
      ] ++ additional_opts

    {:ok, _pid} = ShapeCache.start_link(start_opts)

    %{
      shape_cache_opts: [
        server: :"shape_cache_#{ctx.test}",
        shape_meta_table: shape_meta_table
      ]
    }
  end
end
