defmodule Electric.ShapeCache.ShapeStatusTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit, assert_expectations: true

  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes.Shape

  import Support.ComponentSetup
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

  setup [:with_stack_id_from_test, :with_async_deleter]

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
          shape_handle => {:ok, shape},
          "invalid" => {:error, :corrupted}
        }
      )

    assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)

    assert [^shape_handle] =
             ShapeStatus.list_shape_handles_for_relations(state, [
               {shape.root_table_id, {"public", "other_table"}}
             ])
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

  test "fetch_handle_by_shape/2", ctx do
    {:ok, state, []} = new_state(ctx)
    shape = shape!()

    assert :error = ShapeStatus.fetch_handle_by_shape(state, shape)

    assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)

    assert {:ok, ^shape_handle} = ShapeStatus.fetch_handle_by_shape(state, shape)

    assert {:ok, ^shape} = ShapeStatus.remove_shape(state, shape_handle)
    assert :error = ShapeStatus.fetch_handle_by_shape(state, shape)
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

    assert :ok = ShapeStatus.validate_shape_handle(state, shape_handle1, shape1)
    assert :ok = ShapeStatus.validate_shape_handle(state, shape_handle2, shape2)

    # not a valid handle
    assert :error = ShapeStatus.validate_shape_handle(state, "not-the-handle", shape1)
    # wrong handle for the shape
    assert :error = ShapeStatus.validate_shape_handle(state, shape_handle1, shape2)
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
            case ShapeStatus.fetch_handle_by_shape(state, shape) do
              :error -> ShapeStatus.add_shape(state, shape)
              _ -> :ok
            end
          end
        end)

      remove_tasks =
        for _ <- 1..1000 do
          Task.async(fn ->
            case ShapeStatus.fetch_handle_by_shape(state, shape) do
              :error -> :ok
              {:ok, handle} -> ShapeStatus.remove_shape(state, handle)
            end
          end)
        end

      Task.await_many([add_task | remove_tasks], 20_000)
    end
  end

  describe "shape storage and backup" do
    setup ctx do
      Electric.StackConfig.put(ctx.stack_id, Electric.ShapeCache.Storage, {Mock.Storage, []})

      stub_storage([force: true],
        for_shape: fn shape_handle, _opts -> shape_handle end
      )

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
      assert {:ok, ^shape_handle} = ShapeStatus.fetch_handle_by_shape(state, shape)
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
             ]
             |> Enum.sort() == ShapeStatus.list_shapes(state) |> Enum.sort()

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
          %{not_backed_up_shape_handle => {:ok, not_backed_up_shape}}
        end
      )

      assert :ok = ShapeStatus.initialize_from_storage(state)
      # after reconciliation, only the to_keep_shape and not_backed_up_shape remain
      assert [
               {to_keep_shape_handle, to_keep_shape},
               {not_backed_up_shape_handle, not_backed_up_shape}
             ]
             |> Enum.sort() == ShapeStatus.list_shapes(state) |> Enum.sort()

      refute File.exists?(backup_dir)
    end

    test "backup restore removes shapes whose inner shapes were invalidated", %{state: state} do
      backup_base_dir =
        Path.join(System.tmp_dir!(), "shape_status_test_#{System.unique_integer([:positive])}")

      stub_storage(metadata_backup_dir: fn _ -> backup_base_dir end)

      expect_storage(
        get_all_stored_shape_handles: fn _ -> {:ok, MapSet.new()} end,
        get_stored_shapes: fn _, _ -> %{} end
      )

      :ok = ShapeStatus.initialize_from_storage(state)

      # Create a shape with a subquery
      outer_shape =
        %{shape_dependencies: [inner_shape]} =
        Shape.new!("public.items",
          where: "id IN (SELECT id FROM other_table)",
          inspector: @inspector
        )

      {:ok, inner_handle} = ShapeStatus.add_shape(state, inner_shape)
      outer_shape = %{outer_shape | shape_dependencies_handles: [inner_handle]}
      {:ok, outer_handle} = ShapeStatus.add_shape(state, outer_shape)

      # Also add an independent shape that should survive
      independent_shape = shape!("independent")
      assert {:ok, independent_handle} = ShapeStatus.add_shape(state, independent_shape)

      # Verify all shapes are present
      shapes = ShapeStatus.list_shapes(state)
      assert length(shapes) == 3

      # Save backup with all three shapes
      assert :ok = ShapeStatus.save_checkpoint(state)

      backup_dir = Path.join([backup_base_dir, "shape_status_backups"])
      assert File.exists?(backup_dir)

      ShapeStatus.remove(state)

      # Now restore simulating that the outer shape's storage still exists 
      # but the inner shape's storage has gone
      stub_storage([force: true],
        metadata_backup_dir: fn _ -> backup_base_dir end,
        cleanup!: fn _, _ -> :ok end
      )

      expect_storage([force: true],
        get_all_stored_shape_handles: fn _ ->
          # Only independent and outer shapes have storage - the inner shape has gone
          {:ok, MapSet.new([independent_handle, outer_handle])}
        end
      )

      assert :ok = ShapeStatus.initialize_from_storage(state)

      # The outer shape should be removed because its dependency was invalidated
      # Only the independent shape should remain
      remaining_shapes = ShapeStatus.list_shapes(state)

      assert [{^independent_handle, ^independent_shape}] = remaining_shapes,
             "Parent shape with invalid dependency should have been removed. Got: #{inspect(remaining_shapes)}"

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

    stub_storage([force: true],
      metadata_backup_dir: fn _ -> nil end,
      for_shape: fn shape_handle, _opts -> shape_handle end
    )

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
