defmodule Electric.ShapeCache.ShapeStatusTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit, assert_expectations: true

  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes.Shape

  import Support.ComponentSetup
  import Support.TestUtils, only: [expect_storage: 2, patch_storage: 1]

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

  @moduletag :tmp_dir

  setup [:with_stack_id_from_test, :with_async_deleter, :with_shape_db]

  test "starts empty", ctx do
    {:ok, state, []} = new_state(ctx)
    assert [] = ShapeStatus.list_shapes(state)
  end

  test "deletes any orphaned shape data if empty", ctx do
    expect_storage([force: true],
      cleanup_all!: fn _ ->
        :ok
      end
    )

    {:ok, _state, []} = new_state(ctx)
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

    assert :ok = ShapeStatus.remove_shape(state, shape_handle_1)
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

    assert :ok = ShapeStatus.remove_shape(state, shape_handle)
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

    test "does not return shapes which have only just been created and didn't have update_last_read_time_to_now called",
         %{
           state: state
         } do
      {:ok, _} = ShapeStatus.add_shape(state, shape!())
      {:ok, _} = ShapeStatus.add_shape(state, shape2!())

      assert {[], _} = ShapeStatus.least_recently_used(state, _count = 1)
    end

    test "returns empty list if no shapes have been added", %{state: state} do
      assert {[], _} = ShapeStatus.least_recently_used(state, _count = 1)
    end

    test "returns empty list if all shapes have been deleted", %{state: state} do
      {:ok, shape1} = ShapeStatus.add_shape(state, shape!())
      {:ok, shape2} = ShapeStatus.add_shape(state, shape2!())

      now = System.monotonic_time()
      ShapeStatus.update_last_read_time(state, shape2, now)
      ShapeStatus.update_last_read_time(state, shape1, now + 10)

      ShapeStatus.remove_shape(state, shape1)
      ShapeStatus.remove_shape(state, shape2)

      assert {[], +0.0} = ShapeStatus.least_recently_used(state, _count = 1)
    end

    test "returns all shapes when count exceeds total shapes", %{state: state} do
      {:ok, shape1} = ShapeStatus.add_shape(state, shape!())
      {:ok, shape2} = ShapeStatus.add_shape(state, shape2!())

      now = System.monotonic_time()
      ShapeStatus.update_last_read_time(state, shape2, now)
      ShapeStatus.update_last_read_time(state, shape1, now + 10)

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

    @tag slow: true
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

    stored_shapes = Access.get(opts, :stored_shapes, [])

    try do
      patch_storage(
        cleanup_all!: fn _ ->
          :ok
        end
      )
    rescue
      # ignore any existing mocking on this function
      ArgumentError -> :ok
    end

    :ok = ShapeStatus.initialize(ctx.stack_id)

    for {handle, shape} <- stored_shapes do
      {:ok, _hash} = ShapeStatus.ShapeDb.add_shape(ctx.stack_id, shape, handle)
    end

    shapes = Keyword.get(opts, :shapes, [])

    shape_handles =
      for shape <- shapes do
        {:ok, shape_handle} = ShapeStatus.add_shape(ctx.stack_id, shape)
        shape_handle
      end

    {:ok, ctx.stack_id, shape_handles}
  end
end
