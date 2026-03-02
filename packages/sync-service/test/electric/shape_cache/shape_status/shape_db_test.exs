defmodule Electric.ShapeCache.ShapeStatus.ShapeDbTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.ShapeStatus.ShapeDb

  import Support.ComponentSetup

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

  setup [:with_stack_id_from_test, :with_shape_db]

  test "add_shape inserts persistent shape data", ctx do
    assert {:ok, []} = ShapeDb.list_shapes(ctx.stack_id)
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"

    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)

    assert {:ok, [{^handle1, ^shape1}]} = ShapeDb.list_shapes(ctx.stack_id)

    shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 1")
    handle2 = "handle-2"

    {:ok, _hash2} = ShapeDb.add_shape(ctx.stack_id, shape2, handle2)

    assert {:ok, [{^handle1, ^shape1}, {^handle2, ^shape2}]} = ShapeDb.list_shapes(ctx.stack_id)
  end

  test "handle_exists?", ctx do
    assert {:ok, []} = ShapeDb.list_shapes(ctx.stack_id)
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"

    refute ShapeDb.handle_exists?(ctx.stack_id, handle1)
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)
    assert ShapeDb.handle_exists?(ctx.stack_id, handle1)
  end

  test "shape_handles_for_relations", ctx do
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)

    shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 1")
    handle2 = "handle-2"
    {:ok, _hash2} = ShapeDb.add_shape(ctx.stack_id, shape2, handle2)

    shape3 = Shape.new!("other_table", inspector: @stub_inspector)
    handle3 = "handle-3"
    {:ok, _hash3} = ShapeDb.add_shape(ctx.stack_id, shape3, handle3)

    assert {:ok, [^handle1, ^handle2]} =
             ShapeDb.shape_handles_for_relations(ctx.stack_id, [{1, {"public", "items"}}])

    assert {:ok, [^handle3]} =
             ShapeDb.shape_handles_for_relations(ctx.stack_id, [{2, {"public", "other_table"}}])

    assert {:ok, [^handle1, ^handle2, ^handle3]} =
             ShapeDb.shape_handles_for_relations(ctx.stack_id, [
               {1, {"public", "items"}},
               {2, {"public", "other_table"}}
             ])
  end

  test "remove_shape", ctx do
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)

    shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 1")
    handle2 = "handle-2"
    {:ok, _hash2} = ShapeDb.add_shape(ctx.stack_id, shape2, handle2)

    shape3 = Shape.new!("other_table", inspector: @stub_inspector)
    handle3 = "handle-3"
    {:ok, _hash3} = ShapeDb.add_shape(ctx.stack_id, shape3, handle3)

    assert {:ok, [{^handle1, ^shape1}, {^handle2, ^shape2}, {^handle3, ^shape3}]} =
             ShapeDb.list_shapes(ctx.stack_id)

    :ok = ShapeDb.remove_shape(ctx.stack_id, handle1)

    assert {:ok, [{^handle2, ^shape2}, {^handle3, ^shape3}]} = ShapeDb.list_shapes(ctx.stack_id)

    assert {:ok, [^handle2, ^handle3]} =
             ShapeDb.shape_handles_for_relations(ctx.stack_id, [
               {1, {"public", "items"}},
               {2, {"public", "other_table"}}
             ])

    :ok = ShapeDb.remove_shape(ctx.stack_id, handle3)

    assert {:ok, [{^handle2, ^shape2}]} = ShapeDb.list_shapes(ctx.stack_id)

    assert {:ok, [^handle2]} =
             ShapeDb.shape_handles_for_relations(ctx.stack_id, [
               {1, {"public", "items"}},
               {2, {"public", "other_table"}}
             ])

    :ok = ShapeDb.remove_shape(ctx.stack_id, handle2)

    assert {:ok, []} =
             ShapeDb.shape_handles_for_relations(ctx.stack_id, [
               {1, {"public", "items"}},
               {2, {"public", "other_table"}}
             ])

    assert {:ok, []} = ShapeDb.list_shapes(ctx.stack_id)
  end

  test "remove non-existing shape", ctx do
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)
    assert {:ok, 1} = ShapeDb.count_shapes(ctx.stack_id)

    assert {:error, {:enoshape, "no-such-handle"}} =
             ShapeDb.remove_shape(ctx.stack_id, "no-such-handle")

    assert {:ok, 1} = ShapeDb.count_shapes(ctx.stack_id)
  end

  test "handle_for_shape/2", ctx do
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)
    shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 99")

    assert {:ok, ^handle1} = ShapeDb.handle_for_shape(ctx.stack_id, shape1)

    assert :error = ShapeDb.handle_for_shape(ctx.stack_id, shape2)
  end

  test "handle_for_shape_critical/2", ctx do
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)
    shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 99")

    assert {:ok, ^handle1} = ShapeDb.handle_for_shape_critical(ctx.stack_id, shape1)

    assert :error = ShapeDb.handle_for_shape_critical(ctx.stack_id, shape2)
  end

  test "shape_for_handle", ctx do
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)

    assert {:ok, ^shape1} = ShapeDb.shape_for_handle(ctx.stack_id, handle1)
    assert :error = ShapeDb.shape_for_handle(ctx.stack_id, "no-such-handle")
  end

  test "reduce_shapes/3", ctx do
    {handles, _shapes} =
      Enum.map(1..100, fn n ->
        shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
        handle = "handle-#{n}"
        {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)
        {handle, shape}
      end)
      |> Enum.unzip()

    assert ShapeDb.reduce_shapes(
             ctx.stack_id,
             MapSet.new(),
             fn {handle, %Shape{} = _shape}, acc -> MapSet.put(acc, handle) end
           ) == MapSet.new(handles)
  end

  test "reduce_shape_meta/3", ctx do
    expected =
      Enum.map(1..100, fn n ->
        shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
        handle = "handle-#{n}"
        {:ok, hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)

        # Mark some shapes as snapshot_complete
        if rem(n, 2) == 0 do
          :ok = ShapeDb.mark_snapshot_complete(ctx.stack_id, handle)
          {handle, hash, true}
        else
          {handle, hash, false}
        end
      end)

    # reduce_shape_meta reads snapshot state from SQLite, so flush first
    ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

    assert ShapeDb.reduce_shape_meta(
             ctx.stack_id,
             MapSet.new(),
             fn {handle, hash, snapshot_complete}, acc ->
               MapSet.put(acc, {handle, hash, snapshot_complete})
             end
           ) == MapSet.new(expected)
  end

  test "count_shapes/1", ctx do
    assert {:ok, 0} = ShapeDb.count_shapes(ctx.stack_id)

    Enum.each(1..100, fn n ->
      shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
      handle = "handle-#{n}"
      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)
      assert {:ok, n} == ShapeDb.count_shapes(ctx.stack_id)
    end)

    Enum.each(100..1//-1, fn n ->
      handle = "handle-#{n}"
      :ok = ShapeDb.remove_shape(ctx.stack_id, handle)
      assert {:ok, n - 1} == ShapeDb.count_shapes(ctx.stack_id)
    end)

    assert {:ok, 0} = ShapeDb.count_shapes(ctx.stack_id)
  end

  test "mark_snapshot_complete/2", ctx do
    assert :error = ShapeDb.mark_snapshot_complete(ctx.stack_id, "no-such-handle")

    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)

    # should allow for marking a snapshot complete before the snapshot
    # has been marked started
    assert :ok = ShapeDb.mark_snapshot_complete(ctx.stack_id, handle1)

    shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 2")
    handle2 = "handle-2"
    {:ok, _hash2} = ShapeDb.add_shape(ctx.stack_id, shape2, handle2)

    assert :ok = ShapeDb.mark_snapshot_complete(ctx.stack_id, handle2)
  end

  defp make_valid_shape(ctx, shape, handle) do
    make_shape_with_snapshot_status(ctx, shape, handle, snapshot_complete: true)
  end

  defp make_shape_with_snapshot_status(%{stack_id: stack_id}, shape, handle, opts \\ []) do
    snapshot_complete? = Keyword.get(opts, :snapshot_complete, false)

    {:ok, _hash1} = ShapeDb.add_shape(stack_id, shape, handle)

    if snapshot_complete?,
      do: :ok = ShapeDb.mark_snapshot_complete(stack_id, handle)

    {handle, shape}
  end

  defp get_snapshot_states(stack_id) do
    ShapeDb.reduce_shape_meta(stack_id, %{}, fn {handle, _hash, complete}, acc ->
      Map.put(acc, handle, complete)
    end)
  end

  test "validate_existing_shapes/1", ctx do
    valid_shapes =
      Enum.map(1..10, fn n ->
        shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
        handle = "handle-#{n}"
        make_valid_shape(ctx, shape, handle)
      end)

    not_completed =
      Enum.map(21..30, fn n ->
        shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
        handle = "handle-#{n}"
        make_shape_with_snapshot_status(ctx, shape, handle)
      end)

    {remove_handles, _shapes} = Enum.unzip(not_completed)

    {:ok, invalid_handles, 10} = ShapeDb.validate_existing_shapes(ctx.stack_id)

    assert MapSet.new(invalid_handles) == MapSet.new(remove_handles)

    {handles, _shapes} = Enum.unzip(valid_shapes)

    assert ShapeDb.reduce_shapes(
             ctx.stack_id,
             MapSet.new(),
             fn {handle, %Shape{} = _shape}, acc -> MapSet.put(acc, handle) end
           ) == MapSet.new(handles)
  end

  test "reset/1", ctx do
    assert {:ok, 0} = ShapeDb.count_shapes(ctx.stack_id)

    Enum.map(1..10, fn n ->
      shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
      handle = "handle-#{n}"
      make_valid_shape(ctx, shape, handle)
    end)

    assert {:ok, 10} = ShapeDb.count_shapes(ctx.stack_id)

    assert :ok = ShapeDb.reset(ctx.stack_id)

    assert ShapeDb.reduce_shapes(ctx.stack_id, 0, fn {_handle, %Shape{} = _shape}, acc ->
             acc + 1
           end) == 0

    assert {:ok, 0} = ShapeDb.count_shapes(ctx.stack_id)
  end

  describe "write buffer" do
    test "shapes visible while buffered and after flush", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)

      assert {:ok, [{^handle, ^shape}]} = ShapeDb.list_shapes(ctx.stack_id)
      assert {:ok, ^shape} = ShapeDb.shape_for_handle(ctx.stack_id, handle)
      assert {:ok, ^handle} = ShapeDb.handle_for_shape(ctx.stack_id, shape)

      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

      assert {:ok, [{^handle, ^shape}]} = ShapeDb.list_shapes(ctx.stack_id)
      assert {:ok, ^shape} = ShapeDb.shape_for_handle(ctx.stack_id, handle)
      assert {:ok, ^handle} = ShapeDb.handle_for_shape(ctx.stack_id, shape)
    end

    test "snapshot functions work on shapes only in SQLite", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)
      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

      # Verify initial state: not complete
      assert %{^handle => false} = get_snapshot_states(ctx.stack_id)

      assert :ok = ShapeDb.mark_snapshot_complete(ctx.stack_id, handle)
      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

      # Verify snapshot complete
      assert %{^handle => true} = get_snapshot_states(ctx.stack_id)
    end

    test "snapshot functions fail for shapes pending removal", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)
      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

      assert :ok = ShapeDb.remove_shape(ctx.stack_id, handle)

      assert :error = ShapeDb.mark_snapshot_complete(ctx.stack_id, handle)
    end

    test "remove cancels buffered add", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)
      assert {:ok, [{^handle, ^shape}]} = ShapeDb.list_shapes(ctx.stack_id)

      assert :ok = ShapeDb.remove_shape(ctx.stack_id, handle)
      assert {:ok, []} = ShapeDb.list_shapes(ctx.stack_id)

      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)
      assert {:ok, []} = ShapeDb.list_shapes(ctx.stack_id)
    end

    test "handle_exists? respects pending removes", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)
      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)
      assert ShapeDb.handle_exists?(ctx.stack_id, handle)

      assert :ok = ShapeDb.remove_shape(ctx.stack_id, handle)
      refute ShapeDb.handle_exists?(ctx.stack_id, handle)
    end

    test "pending_count_diff/1", ctx do
      assert 0 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-0"

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)

      assert 1 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)
      assert 0 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      assert :ok = ShapeDb.remove_shape(ctx.stack_id, handle)

      assert -1 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)
      assert 0 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      {_handles1, _shapes} =
        Enum.map(1..10, fn n ->
          shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
          handle = "handle-#{n}"

          make_shape_with_snapshot_status(ctx, shape, handle, snapshot_complete: false)
        end)
        |> Enum.unzip()

      {handles2, _shapes} =
        Enum.map(11..20, fn n ->
          shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
          handle = "handle-#{n}"

          make_shape_with_snapshot_status(ctx, shape, handle, snapshot_complete: false)
        end)
        |> Enum.unzip()

      assert 20 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      Enum.each(handles2, &ShapeDb.remove_shape(ctx.stack_id, &1))

      assert 10 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

      assert 0 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)
    end

    test "duplicate removal operations do not block the write queue", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-0"

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)

      assert 1 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)
      assert 0 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)
      assert :ok = ShapeDb.remove_shape(ctx.stack_id, handle)

      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)
      assert 0 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      ShapeDb.WriteBuffer.remove_shape(ctx.stack_id, handle)
      assert -1 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)
      assert 0 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)
    end

    test "failing to mark a snapshot completed does not block the write queue", ctx do
      handle = "handle-0"
      ShapeDb.WriteBuffer.queue_snapshot_complete(ctx.stack_id, handle)
      assert 1 = ShapeDb.WriteBuffer.pending_operations_count(ctx.stack_id)
      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)
      assert 0 = ShapeDb.WriteBuffer.pending_operations_count(ctx.stack_id)
    end
  end

  describe "exclusive mode" do
    @describetag shape_db_opts: [exclusive_mode: true]

    @tag shape_db_opts: [exclusive_mode: false]
    test "when disabled read and write connections are different", ctx do
      assert {:ok, read_conn} =
               ShapeDb.Connection.checkout!(ctx.stack_id, :read_call, fn %{conn: conn} ->
                 {:ok, conn}
               end)

      assert {:ok, write_conn} =
               ShapeDb.Connection.checkout_write!(ctx.stack_id, :write_call, fn %{conn: conn} ->
                 {:ok, conn}
               end)

      refute read_conn == write_conn

      assert {:ok, [path]} =
               ShapeDb.Connection.checkout!(ctx.stack_id, :read_call, fn %{conn: conn} ->
                 ShapeDb.Connection.fetch_one(conn, "SELECT file FROM pragma_database_list", [])
               end)

      assert path =~ ~r/meta\/shape-db/
    end

    test "returns the same connection for both read and write calls", ctx do
      assert {:ok, read_conn} =
               ShapeDb.Connection.checkout!(ctx.stack_id, :read_call, fn %{conn: conn} ->
                 {:ok, conn}
               end)

      assert {:ok, write_conn} =
               ShapeDb.Connection.checkout_write!(ctx.stack_id, :write_call, fn %{conn: conn} ->
                 {:ok, conn}
               end)

      assert read_conn == write_conn
    end

    @tag shape_db_opts: [exclusive_mode: false]
    test "when disabled sets journal_mode=WAL", ctx do
      assert {:ok, ["wal"]} =
               ShapeDb.Connection.checkout!(ctx.stack_id, :read_call, fn %{conn: conn} ->
                 ShapeDb.Connection.fetch_one(conn, "PRAGMA journal_mode", [])
               end)
    end

    test "sets journal_mode=DELETE", ctx do
      assert {:ok, ["delete"]} =
               ShapeDb.Connection.checkout!(ctx.stack_id, :read_call, fn %{conn: conn} ->
                 ShapeDb.Connection.fetch_one(conn, "PRAGMA journal_mode", [])
               end)
    end

    test "includes read-mode queries", ctx do
      assert {:ok, 0} = ShapeDb.count_shapes(ctx.stack_id)
    end

    @tag shape_db_opts: [exclusive_mode: true, storage_dir: ":memory:"]
    test "allows for an in-memory database", ctx do
      # file is empty for in-memory
      assert {:ok, [[""]]} =
               ShapeDb.Connection.checkout!(ctx.stack_id, :read_call, fn %{conn: conn} ->
                 ShapeDb.Connection.fetch_all(
                   conn,
                   "SELECT file FROM pragma_database_list WHERE name = 'main'",
                   []
                 )
               end)
    end
  end

  describe "statistics" do
    @tag shape_db_opts: [enable_memory_stats?: true]
    test "export memory and disk usage when enabled", ctx do
      assert {:ok, %{total_memory: memory, disk_size: disk_size}} =
               ShapeDb.statistics(ctx.stack_id)

      assert memory > 0
      assert disk_size > 0
    end

    test "only exports disk usage by default", ctx do
      assert {:ok, %{total_memory: 0, disk_size: disk_size}} = ShapeDb.statistics(ctx.stack_id)
      assert disk_size > 0
    end
  end

  describe "recovery" do
    test "resets state when db file is corrupted", ctx do
      {:ok, path} = ShapeDb.Connection.db_path(storage_dir: ctx.tmp_dir)
      assert {:ok, 0} = ShapeDb.count_shapes(ctx.stack_id)

      stop_supervised!(ctx.shape_db)

      File.write!(path, "invalid!")

      assert {:ok, _pid} =
               start_supervised(
                 {Electric.ShapeCache.ShapeStatus.ShapeDb.Supervisor,
                  [
                    stack_id: ctx.stack_id,
                    shape_db_opts: [
                      storage_dir: ctx.tmp_dir,
                      manual_flush_only: true,
                      read_pool_size: 1
                    ]
                  ]},
                 id: "shape_db"
               )
    end

    @tag shape_db_opts: [exclusive_mode: true]
    test "resets state when db file is corrupted in exclusive mode", ctx do
      {:ok, path} = ShapeDb.Connection.db_path(storage_dir: ctx.tmp_dir)
      assert {:ok, 0} = ShapeDb.count_shapes(ctx.stack_id)

      stop_supervised!(ctx.shape_db)

      File.write!(path, "invalid!")

      assert {:ok, _pid} =
               start_supervised(
                 {Electric.ShapeCache.ShapeStatus.ShapeDb.Supervisor,
                  [
                    stack_id: ctx.stack_id,
                    shape_db_opts: [
                      storage_dir: ctx.tmp_dir,
                      manual_flush_only: true,
                      read_pool_size: 1
                    ]
                  ]},
                 id: "shape_db"
               )
    end
  end
end
