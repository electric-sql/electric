defmodule Electric.ShapeCache.ShapeStatus.ShapeDbTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.ShapeStatus.ShapeDb.InMemory
  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Sqlite

  import Support.ComponentSetup, only: [with_stack_id_from_test: 1]

  @moduletag :tmp_dir

  @stub_inspector Support.StubInspector.new(
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

  for module <- [InMemory, Sqlite] do
    module_name = module |> Module.split() |> List.last()

    describe "#{module_name}" do
      setup ctx do
        start_impl(unquote(module), ctx)
      end

      test "add_shape inserts shape data", %{impl: impl, stack_id: stack_id} do
        assert {:ok, []} = impl.list_shapes(stack_id)

        shape1 = Shape.new!("items", inspector: @stub_inspector)
        handle1 = "handle-1"
        {:ok, _hash1} = impl.add_shape(stack_id, shape1, handle1)
        assert {:ok, [{^handle1, ^shape1}]} = impl.list_shapes(stack_id)

        shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 1")
        handle2 = "handle-2"
        {:ok, _hash2} = impl.add_shape(stack_id, shape2, handle2)
        assert {:ok, [{^handle1, ^shape1}, {^handle2, ^shape2}]} = impl.list_shapes(stack_id)
      end

      test "add_shape returns consistent hash for same shape", %{impl: impl, stack_id: stack_id} do
        shape = Shape.new!("items", inspector: @stub_inspector)

        {:ok, hash1} = impl.add_shape(stack_id, shape, "handle-1")
        impl.reset(stack_id)
        {:ok, hash2} = impl.add_shape(stack_id, shape, "handle-2")

        assert hash1 == hash2
      end

      test "handle_exists?", %{impl: impl, stack_id: stack_id} do
        shape = Shape.new!("items", inspector: @stub_inspector)
        handle = "handle-1"

        refute impl.handle_exists?(stack_id, handle)
        {:ok, _} = impl.add_shape(stack_id, shape, handle)
        assert impl.handle_exists?(stack_id, handle)
      end

      test "shape_handles_for_relations", %{impl: impl, stack_id: stack_id} do
        shape1 = Shape.new!("items", inspector: @stub_inspector)
        handle1 = "handle-1"
        {:ok, _} = impl.add_shape(stack_id, shape1, handle1)

        shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 1")
        handle2 = "handle-2"
        {:ok, _} = impl.add_shape(stack_id, shape2, handle2)

        shape3 = Shape.new!("other_table", inspector: @stub_inspector)
        handle3 = "handle-3"
        {:ok, _} = impl.add_shape(stack_id, shape3, handle3)

        assert {:ok, [^handle1, ^handle2]} =
                 impl.shape_handles_for_relations(stack_id, [{1, {"public", "items"}}])

        assert {:ok, [^handle3]} =
                 impl.shape_handles_for_relations(stack_id, [{2, {"public", "other_table"}}])

        assert {:ok, [^handle1, ^handle2, ^handle3]} =
                 impl.shape_handles_for_relations(stack_id, [
                   {1, {"public", "items"}},
                   {2, {"public", "other_table"}}
                 ])
      end

      test "remove_shape", %{impl: impl, stack_id: stack_id} do
        shape1 = Shape.new!("items", inspector: @stub_inspector)
        handle1 = "handle-1"
        {:ok, _} = impl.add_shape(stack_id, shape1, handle1)

        shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 1")
        handle2 = "handle-2"
        {:ok, _} = impl.add_shape(stack_id, shape2, handle2)

        shape3 = Shape.new!("other_table", inspector: @stub_inspector)
        handle3 = "handle-3"
        {:ok, _} = impl.add_shape(stack_id, shape3, handle3)

        assert {:ok, [{^handle1, ^shape1}, {^handle2, ^shape2}, {^handle3, ^shape3}]} =
                 impl.list_shapes(stack_id)

        :ok = impl.remove_shape(stack_id, handle1)

        assert {:ok, [{^handle2, ^shape2}, {^handle3, ^shape3}]} = impl.list_shapes(stack_id)

        assert {:ok, [^handle2, ^handle3]} =
                 impl.shape_handles_for_relations(stack_id, [
                   {1, {"public", "items"}},
                   {2, {"public", "other_table"}}
                 ])

        :ok = impl.remove_shape(stack_id, handle3)
        assert {:ok, [{^handle2, ^shape2}]} = impl.list_shapes(stack_id)

        :ok = impl.remove_shape(stack_id, handle2)
        assert {:ok, []} = impl.list_shapes(stack_id)

        assert {:ok, []} =
                 impl.shape_handles_for_relations(stack_id, [{1, {"public", "items"}}])
      end

      test "remove non-existing shape", %{impl: impl, stack_id: stack_id} do
        shape = Shape.new!("items", inspector: @stub_inspector)
        {:ok, _} = impl.add_shape(stack_id, shape, "handle-1")
        assert {:ok, 1} = impl.count_shapes(stack_id)

        assert {:error, {:enoshape, "no-such-handle"}} =
                 impl.remove_shape(stack_id, "no-such-handle")

        assert {:ok, 1} = impl.count_shapes(stack_id)
      end

      test "handle_for_shape/2", %{impl: impl, stack_id: stack_id} do
        shape1 = Shape.new!("items", inspector: @stub_inspector)
        handle1 = "handle-1"
        {:ok, _} = impl.add_shape(stack_id, shape1, handle1)
        shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 99")

        assert {:ok, ^handle1} = impl.handle_for_shape(stack_id, shape1)
        assert :error = impl.handle_for_shape(stack_id, shape2)
      end

      test "handle_for_shape_critical/2", %{impl: impl, stack_id: stack_id} do
        shape1 = Shape.new!("items", inspector: @stub_inspector)
        handle1 = "handle-1"
        {:ok, _} = impl.add_shape(stack_id, shape1, handle1)
        shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 99")

        assert {:ok, ^handle1} = impl.handle_for_shape_critical(stack_id, shape1)
        assert :error = impl.handle_for_shape_critical(stack_id, shape2)
      end

      test "shape_for_handle/2", %{impl: impl, stack_id: stack_id} do
        shape = Shape.new!("items", inspector: @stub_inspector)
        handle = "handle-1"
        {:ok, _} = impl.add_shape(stack_id, shape, handle)

        assert {:ok, ^shape} = impl.shape_for_handle(stack_id, handle)
        assert :error = impl.shape_for_handle(stack_id, "no-such-handle")
      end

      test "reduce_shapes/3", %{impl: impl, stack_id: stack_id} do
        {handles, _} =
          Enum.map(1..100, fn n ->
            shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
            handle = "handle-#{n}"
            {:ok, _} = impl.add_shape(stack_id, shape, handle)
            {handle, shape}
          end)
          |> Enum.unzip()

        result =
          impl.reduce_shapes(stack_id, MapSet.new(), fn {handle, %Shape{}}, acc ->
            MapSet.put(acc, handle)
          end)

        assert result == MapSet.new(handles)
      end

      test "reduce_shape_meta/3", %{impl: impl, stack_id: stack_id, flush: flush} do
        expected =
          Enum.map(1..100, fn n ->
            shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
            handle = "handle-#{n}"
            {:ok, hash} = impl.add_shape(stack_id, shape, handle)

            if rem(n, 2) == 0 do
              :ok = impl.mark_snapshot_complete(stack_id, handle)
              {handle, hash, true}
            else
              {handle, hash, false}
            end
          end)

        # Allow implementations with a write buffer to flush before reading
        flush.()

        result =
          impl.reduce_shape_meta(stack_id, MapSet.new(), fn {handle, hash, complete}, acc ->
            MapSet.put(acc, {handle, hash, complete})
          end)

        assert result == MapSet.new(expected)
      end

      test "count_shapes/1", %{impl: impl, stack_id: stack_id} do
        assert {:ok, 0} = impl.count_shapes(stack_id)

        Enum.each(1..100, fn n ->
          shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
          {:ok, _} = impl.add_shape(stack_id, shape, "handle-#{n}")
          assert {:ok, n} == impl.count_shapes(stack_id)
        end)

        Enum.each(100..1//-1, fn n ->
          :ok = impl.remove_shape(stack_id, "handle-#{n}")
          assert {:ok, n - 1} == impl.count_shapes(stack_id)
        end)

        assert {:ok, 0} = impl.count_shapes(stack_id)
      end

      test "mark_snapshot_complete/2", %{impl: impl, stack_id: stack_id} do
        assert :error = impl.mark_snapshot_complete(stack_id, "no-such-handle")

        shape1 = Shape.new!("items", inspector: @stub_inspector)
        handle1 = "handle-1"
        {:ok, _} = impl.add_shape(stack_id, shape1, handle1)
        assert :ok = impl.mark_snapshot_complete(stack_id, handle1)

        shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 2")
        handle2 = "handle-2"
        {:ok, _} = impl.add_shape(stack_id, shape2, handle2)
        assert :ok = impl.mark_snapshot_complete(stack_id, handle2)
      end

      test "validate_existing_shapes/1", %{impl: impl, stack_id: stack_id} do
        valid_shapes =
          Enum.map(1..10, fn n ->
            shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
            handle = "handle-#{n}"
            {:ok, _} = impl.add_shape(stack_id, shape, handle)
            :ok = impl.mark_snapshot_complete(stack_id, handle)
            {handle, shape}
          end)

        not_completed =
          Enum.map(21..30, fn n ->
            shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
            handle = "handle-#{n}"
            {:ok, _} = impl.add_shape(stack_id, shape, handle)
            {handle, shape}
          end)

        {remove_handles, _} = Enum.unzip(not_completed)
        {valid_handles, _} = Enum.unzip(valid_shapes)

        {:ok, invalid_handles, 10} = impl.validate_existing_shapes(stack_id)

        assert MapSet.new(invalid_handles) == MapSet.new(remove_handles)

        assert impl.reduce_shapes(stack_id, MapSet.new(), fn {handle, %Shape{}}, acc ->
                 MapSet.put(acc, handle)
               end) == MapSet.new(valid_handles)
      end

      test "reset/1", %{impl: impl, stack_id: stack_id} do
        assert {:ok, 0} = impl.count_shapes(stack_id)

        Enum.each(1..10, fn n ->
          shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
          handle = "handle-#{n}"
          {:ok, _} = impl.add_shape(stack_id, shape, handle)
          :ok = impl.mark_snapshot_complete(stack_id, handle)
        end)

        assert {:ok, 10} = impl.count_shapes(stack_id)
        assert :ok = impl.reset(stack_id)
        assert {:ok, 0} = impl.count_shapes(stack_id)
        assert {:ok, []} = impl.list_shapes(stack_id)
      end
    end
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp start_impl(InMemory, ctx) do
    start_supervised!(
      {InMemory.Supervisor, stack_id: ctx.stack_id},
      id: "shape_db"
    )

    {:ok, %{impl: InMemory, flush: fn -> :ok end}}
  end

  defp start_impl(Sqlite, ctx) do
    shape_db_opts = Map.get(ctx, :shape_db_opts, [])

    start_supervised!(
      {Sqlite.Supervisor,
       [
         stack_id: ctx.stack_id,
         shape_db_opts:
           Keyword.merge(
             [storage_dir: ctx.tmp_dir, manual_flush_only: true, read_pool_size: 1],
             shape_db_opts
           )
       ]},
      id: "shape_db"
    )

    {:ok, %{impl: Sqlite, flush: fn -> Sqlite.WriteBuffer.flush_sync(ctx.stack_id) end}}
  end
end
