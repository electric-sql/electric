defmodule Electric.ExpiryManagerTest do
  use ExUnit.Case, async: true
  use Support.Mock
  use Repatch.ExUnit

  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache
  alias Electric.ShapeCache.ExpiryManager
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Shape

  import Mox
  import Support.ComponentSetup
  import Support.TestUtils

  @stub_inspector Support.StubInspector.new(
                    tables: [{1, {"public", "items"}}],
                    columns: [
                      %{
                        name: "id",
                        type: "int8",
                        type_id: {20, 1},
                        pk_position: 0,
                        is_generated: false
                      },
                      %{name: "value", type: "text", type_id: {25, 1}, is_generated: false}
                    ]
                  )
  @shape Shape.new!("items", inspector: @stub_inspector)

  # {xmin, xmax, xip_list}
  @pg_snapshot_xmin_10 {10, 11, [10]}

  @moduletag :tmp_dir

  defmodule TempPubManager do
    def add_shape(_handle, _, opts) do
      send(opts[:test_pid], {:called, :prepare_tables_fn})
    end
  end

  setup :verify_on_exit!

  setup do
    %{inspector: @stub_inspector, pool: nil}
  end

  setup [
    :with_persistent_kv,
    :with_stack_id_from_test,
    :with_async_deleter,
    :with_pure_file_storage,
    :with_shape_status,
    :with_shape_cleaner,
    :with_status_monitor,
    :with_shape_monitor,
    :with_log_chunking,
    :with_registry,
    :with_shape_log_collector,
    :with_noop_publication_manager
  ]

  test "expires shapes if shape count has gone over max_shapes", ctx do
    Support.TestUtils.patch_snapshotter(fn parent, shape_handle, _shape, %{storage: storage} ->
      GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
      Storage.make_new_snapshot!([["test"]], storage)
      GenServer.cast(parent, {:snapshot_started, shape_handle})
    end)

    %{shape_cache_opts: opts} = with_shape_cache(ctx)

    start_supervised!(
      {ExpiryManager,
       max_shapes: 1,
       expiry_batch_size: 1,
       period: 10,
       stack_id: ctx.stack_id,
       shape_status: ctx.shape_status}
    )

    {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
    assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)

    consumer_ref =
      Electric.Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
      |> Process.monitor()

    storage = Storage.for_shape(shape_handle, ctx.storage)
    writer = Storage.init_writer!(storage, @shape)

    Storage.append_to_log!(
      changes_to_log_items([
        %Changes.NewRecord{
          relation: {"public", "items"},
          record: %{"id" => "1", "value" => "Alice"},
          log_offset: LogOffset.new(Electric.Postgres.Lsn.from_integer(1000), 0)
        }
      ]),
      writer
    )

    assert Storage.snapshot_started?(storage)

    assert Enum.count(Storage.get_log_stream(LogOffset.last_before_real_offsets(), storage)) ==
             1

    {new_shape_handle, _} =
      ShapeCache.get_or_create_shape_handle(%{@shape | where: "1 == 1"}, opts)

    assert :started = ShapeCache.await_snapshot_start(new_shape_handle, opts)

    assert_receive {:DOWN, ^consumer_ref, :process, _pid, {:shutdown, :cleanup}}

    assert :ok = await_for_storage_to_raise(storage)

    {shape_handle2, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
    assert shape_handle != shape_handle2
    assert :started = ShapeCache.await_snapshot_start(shape_handle2, opts)
  end

  defp await_for_storage_to_raise(storage, timeout \\ 5_000)

  defp await_for_storage_to_raise(_storage, timeout) when timeout <= 0 do
    raise "Storage did not raise Storage.Error in time"
  end

  defp await_for_storage_to_raise(storage, timeout) do
    try do
      start_time = System.monotonic_time()
      Stream.run(Storage.get_log_stream(LogOffset.before_all(), storage))
      Process.sleep(50)
      elapsed = System.monotonic_time() - start_time

      await_for_storage_to_raise(
        storage,
        timeout - System.convert_time_unit(elapsed, :native, :millisecond)
      )
    rescue
      Storage.Error -> :ok
    end
  end
end
