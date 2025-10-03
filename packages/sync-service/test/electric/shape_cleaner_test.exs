defmodule Electric.ShapeCleanerTest do
  use ExUnit.Case, async: true
  use Support.Mock

  import ExUnit.CaptureLog
  import Support.ComponentSetup
  import Support.TestUtils
  import Mox

  alias Electric.ShapeCache
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache.ShapeCleaner
  alias Electric.Replication.LogOffset

  @stub_inspector Support.StubInspector.new(
                    tables: [{1, {"public", "items"}}],
                    columns: [
                      %{name: "id", type: "text", type_id: {25, 1}, is_generated: false},
                      %{name: "value", type: "text", type_id: {25, 1}, is_generated: false}
                    ]
                  )

  @shape Electric.Shapes.Shape.new!("items", inspector: @stub_inspector)
  @zero_offset LogOffset.last_before_real_offsets()
  @pg_snapshot_xmin_10 {10, 11, [10]}

  @moduletag :tmp_dir

  setup :verify_on_exit!

  # Provide an inspector for downstream setup helpers (shape log collector, etc.)
  setup do
    %{inspector: @stub_inspector, pool: nil}
  end

  setup [
    :with_persistent_kv,
    :with_stack_id_from_test,
    :with_async_deleter,
    :with_pure_file_storage,
    :with_shape_status,
    :with_status_monitor,
    :with_shape_monitor,
    :with_shape_cleaner
  ]

  describe "remove_shape/2" do
    setup [
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_noop_publication_manager
    ]

    test "cleans up shape data and rotates the shape handle", ctx do
      Support.TestUtils.patch_snapshotter(fn parent, shape_handle, _shape, %{storage: storage} ->
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
        Storage.make_new_snapshot!([["test"]], storage)
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      %{shape_cache_opts: opts} = with_shape_cache(ctx)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)

      consumer_ref =
        Electric.Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
        |> Process.monitor()

      storage = Storage.for_shape(shape_handle, ctx.storage)
      writer = Storage.init_writer!(storage, @shape)

      Storage.append_to_log!(
        changes_to_log_items([
          %Electric.Replication.Changes.NewRecord{
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

      :ok = ShapeCleaner.remove_shape(shape_handle, stack_id: ctx.stack_id)

      assert_receive {:DOWN, ^consumer_ref, :process, _pid, {:shutdown, :cleanup}}

      {shape_handle2, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert :started = ShapeCache.await_snapshot_start(shape_handle2, opts)
      assert shape_handle != shape_handle2
    end

    test "remove_shape swallows error if no shape to clean up", ctx do
      shape_handle = "foo"

      Support.TestUtils.patch_snapshotter(fn parent, shape_handle, _shape, %{storage: storage} ->
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
        Storage.make_new_snapshot!([["test"]], storage)
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      %{shape_cache_opts: _opts} = with_shape_cache(ctx)

      {:ok, _} =
        with_log(fn -> ShapeCleaner.remove_shape(shape_handle, stack_id: ctx.stack_id) end)
    end
  end

  describe "remove_shapes_for_relations/2" do
    setup [
      :with_log_chunking,
      :with_registry,
      :with_shape_log_collector,
      :with_noop_publication_manager
    ]

    setup ctx do
      Support.TestUtils.patch_snapshotter(fn parent, shape_handle, _shape, %{storage: storage} ->
        GenServer.cast(parent, {:pg_snapshot_known, shape_handle, @pg_snapshot_xmin_10})
        Storage.make_new_snapshot!([["test"]], storage)
        GenServer.cast(parent, {:snapshot_started, shape_handle})
      end)

      %{shape_cache_opts: opts} = with_shape_cache(ctx)

      {:ok, %{shape_cache_opts: opts}}
    end

    test "cleans up shape data for relevant shapes", %{shape_cache_opts: opts} = ctx do
      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert :started = ShapeCache.await_snapshot_start(shape_handle, opts)

      consumer_ref =
        Electric.Shapes.Consumer.whereis(ctx.stack_id, shape_handle)
        |> Process.monitor()

      storage = Storage.for_shape(shape_handle, ctx.storage)
      writer = Storage.init_writer!(storage, @shape)

      Storage.append_to_log!(
        changes_to_log_items([
          %Electric.Replication.Changes.NewRecord{
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

      # Cleaning unrelated relations should not affect the shape
      :ok =
        ShapeCleaner.remove_shapes_for_relations(
          [{@shape.root_table_id + 1, {"public", "different"}}],
          stack_id: ctx.stack_id
        )

      refute_receive {:DOWN, ^consumer_ref, :process, _pid, {:shutdown, :cleanup}}, 100

      # Shouldn't raise
      assert :ok = Stream.run(Storage.get_log_stream(@zero_offset, storage))

      :ok =
        ShapeCleaner.remove_shapes_for_relations(
          [{@shape.root_table_id, {"public", "items"}}],
          stack_id: ctx.stack_id
        )

      # Allow asynchronous queued removal to complete
      assert_receive {:DOWN, ^consumer_ref, :process, _pid, {:shutdown, :cleanup}}, 1_000

      {shape_handle2, _} = ShapeCache.get_or_create_shape_handle(@shape, opts)
      assert :started = ShapeCache.await_snapshot_start(shape_handle2, opts)
      assert shape_handle != shape_handle2
    end
  end
end
