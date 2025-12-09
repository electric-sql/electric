defmodule Electric.ShapeCache.ShapeStatusTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit, assert_expectations: true

  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes.Shape

  import Support.ComponentSetup, only: [with_stack_id_from_test: 1]
  import Support.TestUtils, only: [expect_calls: 3, patch_calls: 3]

  @inspector Support.StubInspector.new(
               tables: [{1, {"public", "items"}}, {2, {"public", "other_table"}}],
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

  setup :with_stack_id_from_test

  test "starts empty", ctx do
    {:ok, state, []} = new_state(ctx)
    assert [] = ShapeStatus.list_shapes(state)
  end

  test "can recover shapes from storage", ctx do
    {:ok, state, []} = new_state(ctx)
    shape = shape!()
    assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
    assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)

    ShapeStatus.remove(state)

    {:ok, state, []} =
      new_state(ctx,
        stored_shapes: %{
          shape_handle => {:ok, {shape, true, LogOffset.last_before_real_offsets()}},
          "invalid" => {:error, :corrupted}
        }
      )

    assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)

    assert [^shape_handle] =
             ShapeStatus.list_shape_handles_for_relations(state, [
               {shape.root_table_id, {"public", "other_table"}}
             ])

    assert ShapeStatus.snapshot_started?(state, shape_handle)
  end

  test "can add shapes", ctx do
    {:ok, state, []} = new_state(ctx)
    shape = shape!()
    assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
    assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)
  end

  test "can delete shape instances", ctx do
    {:ok, state, []} = new_state(ctx)
    shape_1 = shape!()
    assert {:ok, shape_handle_1} = ShapeStatus.add_shape(state, shape_1)

    shape_2 = shape2!()

    assert {:ok, shape_handle_2} = ShapeStatus.add_shape(state, shape_2)

    assert Enum.sort_by([{shape_handle_1, shape_1}, {shape_handle_2, shape_2}], &elem(&1, 0)) ==
             ShapeStatus.list_shapes(state) |> Enum.sort_by(&elem(&1, 0))

    assert {:ok, ^shape_1} = ShapeStatus.remove_shape(state, shape_handle_1)
    assert [{^shape_handle_2, ^shape_2}] = ShapeStatus.list_shapes(state)

    assert [^shape_handle_2] =
             ShapeStatus.list_shape_handles_for_relations(state, [
               {shape_2.root_table_id, {"public", "table"}}
             ])

    assert [] =
             ShapeStatus.list_shape_handles_for_relations(state, [
               {shape_1.root_table_id, {"public", "other_table"}}
             ])
  end

  test "get_existing_shape/2 with %Shape{}", ctx do
    {:ok, state, []} = new_state(ctx)
    shape = shape!()

    refute ShapeStatus.get_existing_shape(state, shape)

    assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(state, shape)

    assert {:ok, ^shape} = ShapeStatus.remove_shape(state, shape_handle)
    refute ShapeStatus.get_existing_shape(state, shape)
  end

  test "fetch_shape_by_handle/2", ctx do
    shape = shape!()
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape])

    assert {:ok, ^shape} = ShapeStatus.fetch_shape_by_handle(state, shape_handle)
    assert :error = ShapeStatus.fetch_shape_by_handle(state, "not-my-handle")
  end

  test "has_shape_handle?/2", ctx do
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])
    assert ShapeStatus.has_shape_handle?(state, shape_handle)
    refute ShapeStatus.has_shape_handle?(state, "no-such-shape")
  end

  test "validate_shape_handle/3", ctx do
    shape1 = shape!("one")
    shape2 = shape!("two")

    {:ok, state, [shape_handle1, shape_handle2]} = new_state(ctx, shapes: [shape1, shape2])

    offset = LogOffset.new(100, 3)

    ShapeStatus.set_latest_offset(ctx.stack_id, shape_handle1, offset)

    assert {:ok, ^offset} = ShapeStatus.validate_shape_handle(state, shape_handle1, shape1)
    assert {:ok, _} = ShapeStatus.validate_shape_handle(state, shape_handle2, shape2)

    # not a valid handle
    assert :error = ShapeStatus.validate_shape_handle(state, "not-the-handle", shape1)
    # wrong handle for the shape
    assert :error = ShapeStatus.validate_shape_handle(state, shape_handle1, shape2)
  end

  test "latest_offset", ctx do
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])
    assert :error = ShapeStatus.latest_offset(state, "sdfsodf")

    assert ShapeStatus.latest_offset(state, shape_handle) ==
             {:ok, LogOffset.last_before_real_offsets()}

    # virtual latest offsets are always normalized to the last before the
    # real offsets to avoid client backtracking
    assert ShapeStatus.set_latest_offset(state, shape_handle, LogOffset.new(0, 100))

    assert ShapeStatus.latest_offset(state, shape_handle) ==
             {:ok, LogOffset.last_before_real_offsets()}

    offset = LogOffset.new(100, 3)
    assert ShapeStatus.set_latest_offset(state, shape_handle, offset)

    # set latest offset for an unknown shape silently does nothing
    # this is because real-world race conditions mean that we may
    # still receive updates on a shape that is in the process of
    # being deleted
    assert ShapeStatus.set_latest_offset(state, "not my shape", offset)

    assert ShapeStatus.latest_offset(state, shape_handle) == {:ok, offset}
  end

  test "latest_offset public api", ctx do
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])
    assert :error = ShapeStatus.latest_offset(state, "sdfsodf")

    assert ShapeStatus.latest_offset(state, shape_handle) ==
             {:ok, LogOffset.last_before_real_offsets()}

    offset = LogOffset.new(100, 3)

    assert ShapeStatus.set_latest_offset(state, "not my shape", offset)

    assert ShapeStatus.set_latest_offset(state, shape_handle, offset)
    assert ShapeStatus.latest_offset(state, shape_handle) == {:ok, offset}
  end

  test "initialise_shape/3", ctx do
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])
    offset = LogOffset.new(100, 3)
    assert :ok = ShapeStatus.initialise_shape(state, shape_handle, offset)
    assert ShapeStatus.latest_offset(state, shape_handle) == {:ok, offset}
  end

  test "snapshot_started?/2", ctx do
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])

    refute ShapeStatus.snapshot_started?(state, "sdfsodf")
    refute ShapeStatus.snapshot_started?(state.stack_id, "sdfsodf")
    refute ShapeStatus.snapshot_started?(state, shape_handle)

    ShapeStatus.mark_snapshot_as_started(state, shape_handle)

    assert ShapeStatus.snapshot_started?(state, shape_handle)
    assert ShapeStatus.snapshot_started?(state.stack_id, shape_handle)
  end

  describe "list_shapes/2" do
    test "returns shapes with dependencies in a topological order", ctx do
      {:ok, state, []} = new_state(ctx)

      outer =
        %{shape_dependencies: [inner]} =
        Shape.new!("public.items",
          where: "id IN (SELECT id FROM other_table)",
          inspector: @inspector
        )

      {:ok, inner_handle} = ShapeStatus.add_shape(state, inner)
      outer = %{outer | shape_dependencies_handles: [inner_handle]}
      {:ok, outer_handle} = ShapeStatus.add_shape(state, outer)

      assert [{^inner_handle, _}, {^outer_handle, _}] = ShapeStatus.list_shapes(state)
    end
  end

  describe "least_recently_used/2" do
    setup ctx do
      {:ok, state, []} = new_state(ctx)
      %{state: state}
    end

    test "returns the shape that was least recently updated", %{state: state} do
      {:ok, shape1} = ShapeStatus.add_shape(state, shape!())
      {:ok, shape2} = ShapeStatus.add_shape(state, shape2!())

      now = System.monotonic_time()
      ShapeStatus.update_last_read_time(state, shape2, now)
      ShapeStatus.update_last_read_time(state, shape1, now + 10)

      assert {[^shape2], +0.0} = ShapeStatus.least_recently_used(state, _count = 1)
    end

    test "returns shape first created if update_last_read_time_to_now has not been called", %{
      state: state
    } do
      {:ok, shape1} = ShapeStatus.add_shape(state, shape!())
      {:ok, _shape2} = ShapeStatus.add_shape(state, shape2!())

      assert {[^shape1], _} = ShapeStatus.least_recently_used(state, _count = 1)
    end

    test "returns empty list if no shapes have been added", %{state: state} do
      assert {[], _} = ShapeStatus.least_recently_used(state, _count = 1)
    end

    test "returns empty list if all shapes have been deleted", %{state: state} do
      {:ok, shape1} = ShapeStatus.add_shape(state, shape!())
      {:ok, shape2} = ShapeStatus.add_shape(state, shape2!())
      ShapeStatus.remove_shape(state, shape1)
      ShapeStatus.remove_shape(state, shape2)

      assert {[], +0.0} = ShapeStatus.least_recently_used(state, _count = 1)
    end

    test "returns all shapes when count exceeds total shapes", %{state: state} do
      {:ok, shape1} = ShapeStatus.add_shape(state, shape!())
      {:ok, shape2} = ShapeStatus.add_shape(state, shape2!())

      {handles, _} = ShapeStatus.least_recently_used(state, _count = 100)
      assert length(handles) == 2
      assert shape1 in handles
      assert shape2 in handles
    end

    test "returns correct N shapes when N < total shapes", %{state: state} do
      # Add 5 shapes with staggered updates
      now = System.monotonic_time()

      shapes =
        for i <- 1..5 do
          {:ok, handle} = ShapeStatus.add_shape(state, shape!("test_#{i}"))
          ShapeStatus.update_last_read_time(state, handle, now + i * 10)
          handle
        end

      # Request the 3 least recently used (should be the first 3)
      {result_handles, _} = ShapeStatus.least_recently_used(state, _count = 3)
      assert length(result_handles) == 3

      expected_handles = Enum.take(shapes, 3)
      assert expected_handles == result_handles
    end

    test "returns shapes in order from least to most recently used", %{state: state} do
      now = System.monotonic_time()
      {:ok, shape1} = ShapeStatus.add_shape(state, shape!("oldest"))
      {:ok, shape2} = ShapeStatus.add_shape(state, shape!("middle"))
      {:ok, shape3} = ShapeStatus.add_shape(state, shape!("newest"))

      ShapeStatus.update_last_read_time(state, shape1, now)
      ShapeStatus.update_last_read_time(state, shape2, now + 5)
      ShapeStatus.update_last_read_time(state, shape3, now + 10)

      assert {[^shape1, ^shape2, ^shape3], _} = ShapeStatus.least_recently_used(state, _count = 3)
    end

    test "returns shapes with same timestamp in arbitrary order", %{state: state} do
      {:ok, shape1} = ShapeStatus.add_shape(state, shape!("1"))
      {:ok, shape2} = ShapeStatus.add_shape(state, shape!("2"))
      {:ok, shape3} = ShapeStatus.add_shape(state, shape!("3"))

      now = System.monotonic_time()
      ShapeStatus.update_last_read_time(state, shape1, now + 10)
      ShapeStatus.update_last_read_time(state, shape2, now)
      ShapeStatus.update_last_read_time(state, shape3, now)

      assert {shapes, +0.0} = ShapeStatus.least_recently_used(state, _count = 2)
      assert shapes |> Enum.sort() == [shape2, shape3] |> Enum.sort()
    end

    use ExUnitProperties

    property "returns correct number of shapes in LRU order", %{state: state} do
      check all(
              num_shapes <- StreamData.integer(1..100),
              count <- StreamData.integer(0..100),
              timestamps <-
                StreamData.list_of(
                  StreamData.integer(1..10_000),
                  length: num_shapes
                ),
              :ok <- ShapeStatus.reset(state)
            ) do
        shape_handles =
          for {timestamp, i} <- Enum.with_index(timestamps) do
            {:ok, handle} = ShapeStatus.add_shape(state, shape!("property_test_#{i}"))
            ShapeStatus.update_last_read_time(state, handle, timestamp)
            {handle, timestamp}
          end

        {result_handles, _time} = ShapeStatus.least_recently_used(state, count)

        expected_count = min(count, num_shapes)
        assert length(result_handles) == expected_count

        # Sort by timestamp (and handle for stable ordering when timestamps are equal)
        sorted_by_timestamp = Enum.sort_by(shape_handles, fn {handle, ts} -> {ts, handle} end)

        expected_handles =
          sorted_by_timestamp |> Enum.take(expected_count) |> Enum.map(&elem(&1, 0))

        assert Enum.sort(result_handles) == Enum.sort(expected_handles)
      end
    end
  end

  describe "high concurrency" do
    @num_shapes_to_seed 10_000
    setup ctx do
      {:ok, state, []} = new_state(ctx)

      for i <- 1..@num_shapes_to_seed do
        ShapeStatus.add_shape(state, shape!("seed_#{i}"))
      end

      {:ok, state: state}
    end

    @tag slow: true
    test "add and delete of the same shape should never fail", ctx do
      %{state: state} = ctx

      shape = shape!()
      ShapeStatus.add_shape(state, shape)

      add_task =
        Task.async(fn ->
          for _ <- 1..1000 do
            case ShapeStatus.get_existing_shape(state, shape) do
              nil -> ShapeStatus.add_shape(state, shape)
              _ -> :ok
            end
          end
        end)

      remove_tasks =
        for _ <- 1..1000 do
          Task.async(fn ->
            case ShapeStatus.get_existing_shape(state, shape) do
              nil -> :ok
              {handle, _} -> ShapeStatus.remove_shape(state, handle)
            end
          end)
        end

      Task.await_many([add_task | remove_tasks], 20_000)
    end
  end

  describe "shape storage and backup" do
    setup ctx do
      Electric.StackConfig.put(ctx.stack_id, Electric.ShapeCache.Storage, {Mock.Storage, []})
      %{state: %{stack_id: ctx.stack_id}}
    end

    test "terminate stores backup and initialise loads from backup instead of storage", %{
      state: state
    } do
      backup_base_dir =
        Path.join(System.tmp_dir!(), "shape_status_test_#{System.unique_integer([:positive])}")

      # First lifecycle: no shapes in storage, start empty, add a shape, terminate to create backup
      stub_storage(metadata_backup_dir: fn _ -> backup_base_dir end)

      expect_storage(
        get_all_stored_shape_handles: fn _ -> {:ok, MapSet.new()} end,
        get_stored_shapes: fn _, _ -> %{} end
      )

      assert :ok = ShapeStatus.initialize_from_storage(state)
      shape = shape!()
      assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
      assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)

      # Persist backup
      assert :ok = ShapeStatus.save_checkpoint(state)

      backup_dir = Path.join([backup_base_dir, "shape_status_backups"])
      assert File.exists?(backup_dir)

      ShapeStatus.remove(state)

      # Second lifecycle: should load from backup (so must NOT call get_stored_shapes)
      stub_storage([force: true],
        get_stored_shapes: fn _, _ ->
          flunk("get_stored_shapes should not be called when backup exists")
        end
      )

      expect_storage([force: true],
        get_all_stored_shape_handles: fn _ -> {:ok, MapSet.new([shape_handle])} end
      )

      assert :ok = ShapeStatus.initialize_from_storage(state)
      assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)
      assert {^shape_handle, _offset} = ShapeStatus.get_existing_shape(state, shape)
      assert ShapeStatus.count_shapes(state) == 1
      # consuming backup directory should have removed it after load
      refute File.exists?(backup_dir)
    end

    test "backup restore reconciled if stored handles missing", %{state: state} do
      backup_base_dir =
        Path.join(System.tmp_dir!(), "shape_status_test_#{System.unique_integer([:positive])}")

      # First lifecycle: create backup containing one shape
      stub_storage(metadata_backup_dir: fn _ -> backup_base_dir end)

      expect_storage(
        get_all_stored_shape_handles: fn _ -> {:ok, MapSet.new()} end,
        get_stored_shapes: fn _, _ -> %{} end
      )

      assert :ok = ShapeStatus.initialize_from_storage(state)
      to_keep_shape = shape!()
      to_invalidate_shape = shape!("to be invalidated")
      assert {:ok, to_keep_shape_handle} = ShapeStatus.add_shape(state, to_keep_shape)
      assert {:ok, to_invalidate_shape_handle} = ShapeStatus.add_shape(state, to_invalidate_shape)

      assert [
               {to_invalidate_shape_handle, to_invalidate_shape},
               {to_keep_shape_handle, to_keep_shape}
             ] == ShapeStatus.list_shapes(state)

      assert :ok = ShapeStatus.save_checkpoint(state)

      backup_dir = Path.join([backup_base_dir, "shape_status_backups"])
      assert File.exists?(backup_dir)

      ShapeStatus.remove(state)

      not_backed_up_shape = shape!("not backed up")
      not_backed_up_shape_handle = "not-backed-up-handle"

      expected_handles_to_load = MapSet.new([not_backed_up_shape_handle])

      expect_storage([force: true],
        # After loading from backup and showing mismatch of stored vs in-memory handles,
        # the missing stored handle should be loaded from storage and in memory removed
        get_all_stored_shape_handles: fn _ ->
          {:ok, MapSet.new([to_keep_shape_handle, not_backed_up_shape_handle])}
        end,
        get_stored_shapes: fn _, ^expected_handles_to_load ->
          %{
            not_backed_up_shape_handle =>
              {:ok, {not_backed_up_shape, false, LogOffset.last_before_real_offsets()}}
          }
        end
      )

      assert :ok = ShapeStatus.initialize_from_storage(state)
      # after reconciliation, only the to_keep_shape and not_backed_up_shape remain
      assert [
               {to_keep_shape_handle, to_keep_shape},
               {not_backed_up_shape_handle, not_backed_up_shape}
             ] == ShapeStatus.list_shapes(state)

      refute File.exists?(backup_dir)
    end
  end

  defp shape!, do: shape!("test")

  defp shape!(val) do
    where = "value = '#{val}'"

    assert {:ok, %Shape{where: %{query: ^where}} = shape} =
             Shape.new("items", inspector: @inspector, where: where)

    shape
  end

  defp shape2! do
    assert {:ok, %Shape{where: nil} = shape} =
             Shape.new("public.other_table", inspector: @inspector)

    shape
  end

  defp new_state(ctx, opts \\ []) do
    Electric.StackConfig.put(ctx.stack_id, Electric.ShapeCache.Storage, {Mock.Storage, []})
    stub_storage([force: true], metadata_backup_dir: fn _ -> nil end)

    stored_shapes = Access.get(opts, :stored_shapes, %{})
    stored_shape_handles = Map.keys(stored_shapes) |> MapSet.new()

    expect_storage(
      get_all_stored_shape_handles: fn _ -> {:ok, stored_shape_handles} end,
      get_stored_shapes: fn _, _ -> Access.get(opts, :stored_shapes, %{}) end
    )

    state = %{
      storage: {Mock.Storage, []},
      stack_id: ctx.stack_id
    }

    :ok = ShapeStatus.initialize_from_storage(state)

    shapes = Keyword.get(opts, :shapes, [])

    shape_handles =
      for shape <- shapes do
        {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
        shape_handle
      end

    {:ok, state, shape_handles}
  end

  defp stub_storage(opts \\ [], stubs) do
    patch_calls(Electric.ShapeCache.Storage, opts, stubs)
  end

  defp expect_storage(opts \\ [], expectations) do
    expect_calls(Electric.ShapeCache.Storage, opts, expectations)
  end
end
