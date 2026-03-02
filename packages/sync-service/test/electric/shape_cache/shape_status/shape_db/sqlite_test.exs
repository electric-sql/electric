defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.SqliteTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Shape
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

  setup [:with_stack_id_from_test, :with_sqlite_shape_db]

  defp with_sqlite_shape_db(ctx) do
    shape_db_opts = Map.get(ctx, :shape_db_opts, [])

    start_supervised!(
      {Sqlite.Supervisor,
       [
         stack_id: ctx.stack_id,
         shape_db_opts:
           Keyword.merge(
             [
               storage_dir: ctx.tmp_dir,
               manual_flush_only: true,
               read_pool_size: 1
             ],
             shape_db_opts
           )
       ]},
      id: "shape_db"
    )

    %{shape_db: "shape_db"}
  end

  defp get_snapshot_states(stack_id) do
    Sqlite.reduce_shape_meta(stack_id, %{}, fn {handle, _hash, complete}, acc ->
      Map.put(acc, handle, complete)
    end)
  end

  describe "write buffer" do
    test "shapes visible while buffered and after flush", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = Sqlite.add_shape(ctx.stack_id, shape, handle)

      assert {:ok, [{^handle, ^shape}]} = Sqlite.list_shapes(ctx.stack_id)
      assert {:ok, ^shape} = Sqlite.shape_for_handle(ctx.stack_id, handle)
      assert {:ok, ^handle} = Sqlite.handle_for_shape(ctx.stack_id, shape)

      Sqlite.WriteBuffer.flush_sync(ctx.stack_id)

      assert {:ok, [{^handle, ^shape}]} = Sqlite.list_shapes(ctx.stack_id)
      assert {:ok, ^shape} = Sqlite.shape_for_handle(ctx.stack_id, handle)
      assert {:ok, ^handle} = Sqlite.handle_for_shape(ctx.stack_id, shape)
    end

    test "snapshot functions work on shapes only in SQLite", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = Sqlite.add_shape(ctx.stack_id, shape, handle)
      Sqlite.WriteBuffer.flush_sync(ctx.stack_id)

      assert %{^handle => false} = get_snapshot_states(ctx.stack_id)

      assert :ok = Sqlite.mark_snapshot_complete(ctx.stack_id, handle)
      Sqlite.WriteBuffer.flush_sync(ctx.stack_id)

      assert %{^handle => true} = get_snapshot_states(ctx.stack_id)
    end

    test "snapshot functions fail for shapes pending removal", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = Sqlite.add_shape(ctx.stack_id, shape, handle)
      Sqlite.WriteBuffer.flush_sync(ctx.stack_id)

      assert :ok = Sqlite.remove_shape(ctx.stack_id, handle)

      assert :error = Sqlite.mark_snapshot_complete(ctx.stack_id, handle)
    end

    test "remove cancels buffered add", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = Sqlite.add_shape(ctx.stack_id, shape, handle)
      assert {:ok, [{^handle, ^shape}]} = Sqlite.list_shapes(ctx.stack_id)

      assert :ok = Sqlite.remove_shape(ctx.stack_id, handle)
      assert {:ok, []} = Sqlite.list_shapes(ctx.stack_id)

      Sqlite.WriteBuffer.flush_sync(ctx.stack_id)
      assert {:ok, []} = Sqlite.list_shapes(ctx.stack_id)
    end

    test "handle_exists? respects pending removes", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = Sqlite.add_shape(ctx.stack_id, shape, handle)
      Sqlite.WriteBuffer.flush_sync(ctx.stack_id)
      assert Sqlite.handle_exists?(ctx.stack_id, handle)

      assert :ok = Sqlite.remove_shape(ctx.stack_id, handle)
      refute Sqlite.handle_exists?(ctx.stack_id, handle)
    end

    test "pending_count_diff/1", ctx do
      assert 0 = Sqlite.WriteBuffer.pending_count_diff(ctx.stack_id)

      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-0"

      {:ok, _hash} = Sqlite.add_shape(ctx.stack_id, shape, handle)

      assert 1 = Sqlite.WriteBuffer.pending_count_diff(ctx.stack_id)

      Sqlite.WriteBuffer.flush_sync(ctx.stack_id)
      assert 0 = Sqlite.WriteBuffer.pending_count_diff(ctx.stack_id)

      assert :ok = Sqlite.remove_shape(ctx.stack_id, handle)

      assert -1 = Sqlite.WriteBuffer.pending_count_diff(ctx.stack_id)

      Sqlite.WriteBuffer.flush_sync(ctx.stack_id)
      assert 0 = Sqlite.WriteBuffer.pending_count_diff(ctx.stack_id)

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

      assert 20 = Sqlite.WriteBuffer.pending_count_diff(ctx.stack_id)

      Enum.each(handles2, &Sqlite.remove_shape(ctx.stack_id, &1))

      assert 10 = Sqlite.WriteBuffer.pending_count_diff(ctx.stack_id)

      Sqlite.WriteBuffer.flush_sync(ctx.stack_id)

      assert 0 = Sqlite.WriteBuffer.pending_count_diff(ctx.stack_id)
    end

    test "duplicate removal operations do not block the write queue", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-0"

      {:ok, _hash} = Sqlite.add_shape(ctx.stack_id, shape, handle)

      assert 1 = Sqlite.WriteBuffer.pending_count_diff(ctx.stack_id)

      Sqlite.WriteBuffer.flush_sync(ctx.stack_id)
      assert 0 = Sqlite.WriteBuffer.pending_count_diff(ctx.stack_id)
      assert :ok = Sqlite.remove_shape(ctx.stack_id, handle)

      Sqlite.WriteBuffer.flush_sync(ctx.stack_id)
      assert 0 = Sqlite.WriteBuffer.pending_count_diff(ctx.stack_id)

      Sqlite.WriteBuffer.remove_shape(ctx.stack_id, handle)
      assert -1 = Sqlite.WriteBuffer.pending_count_diff(ctx.stack_id)

      Sqlite.WriteBuffer.flush_sync(ctx.stack_id)
      assert 0 = Sqlite.WriteBuffer.pending_count_diff(ctx.stack_id)
    end

    test "failing to mark a snapshot completed does not block the write queue", ctx do
      handle = "handle-0"
      Sqlite.WriteBuffer.queue_snapshot_complete(ctx.stack_id, handle)
      assert 1 = Sqlite.WriteBuffer.pending_operations_count(ctx.stack_id)
      Sqlite.WriteBuffer.flush_sync(ctx.stack_id)
      assert 0 = Sqlite.WriteBuffer.pending_operations_count(ctx.stack_id)
    end
  end

  describe "exclusive mode" do
    @describetag shape_db_opts: [exclusive_mode: true]

    @tag shape_db_opts: [exclusive_mode: false]
    test "when disabled read and write connections are different", ctx do
      assert {:ok, read_conn} =
               Sqlite.Connection.checkout!(ctx.stack_id, :read_call, fn %{conn: conn} ->
                 {:ok, conn}
               end)

      assert {:ok, write_conn} =
               Sqlite.Connection.checkout_write!(ctx.stack_id, :write_call, fn %{conn: conn} ->
                 {:ok, conn}
               end)

      refute read_conn == write_conn

      assert {:ok, [path]} =
               Sqlite.Connection.checkout!(ctx.stack_id, :read_call, fn %{conn: conn} ->
                 Sqlite.Connection.fetch_one(conn, "SELECT file FROM pragma_database_list", [])
               end)

      assert path =~ ~r/meta\/shape-db/
    end

    test "returns the same connection for both read and write calls", ctx do
      assert {:ok, read_conn} =
               Sqlite.Connection.checkout!(ctx.stack_id, :read_call, fn %{conn: conn} ->
                 {:ok, conn}
               end)

      assert {:ok, write_conn} =
               Sqlite.Connection.checkout_write!(ctx.stack_id, :write_call, fn %{conn: conn} ->
                 {:ok, conn}
               end)

      assert read_conn == write_conn
    end

    @tag shape_db_opts: [exclusive_mode: false]
    test "when disabled sets journal_mode=WAL", ctx do
      assert {:ok, ["wal"]} =
               Sqlite.Connection.checkout!(ctx.stack_id, :read_call, fn %{conn: conn} ->
                 Sqlite.Connection.fetch_one(conn, "PRAGMA journal_mode", [])
               end)
    end

    test "sets journal_mode=DELETE", ctx do
      assert {:ok, ["delete"]} =
               Sqlite.Connection.checkout!(ctx.stack_id, :read_call, fn %{conn: conn} ->
                 Sqlite.Connection.fetch_one(conn, "PRAGMA journal_mode", [])
               end)
    end

    test "includes read-mode queries", ctx do
      assert {:ok, 0} = Sqlite.count_shapes(ctx.stack_id)
    end

    @tag shape_db_opts: [exclusive_mode: true, storage_dir: ":memory:"]
    test "allows for an in-memory database", ctx do
      assert {:ok, [[""]]} =
               Sqlite.Connection.checkout!(ctx.stack_id, :read_call, fn %{conn: conn} ->
                 Sqlite.Connection.fetch_all(
                   conn,
                   "SELECT file FROM pragma_database_list WHERE name = 'main'",
                   []
                 )
               end)
    end
  end

  describe "statistics" do
    alias Electric.ShapeCache.ShapeStatus.ShapeDb.Sqlite.Statistics

    @tag shape_db_opts: [enable_stats?: true, enable_memory_stats?: true]
    test "export memory and disk usage when enabled", ctx do
      {:ok, stats} = Statistics.current(ctx.stack_id)
      enabled = Statistics.stats_enabled(ctx.stack_id)

      if enabled.disk, do: assert(stats.disk_size > 0)
      if enabled.memory, do: assert(stats.total_memory > 0)
    end

    @tag shape_db_opts: [enable_stats?: true]
    test "only exports disk usage by default", ctx do
      {:ok, stats} = Statistics.current(ctx.stack_id)
      enabled = Statistics.stats_enabled(ctx.stack_id)

      assert stats.total_memory == 0
      if enabled.disk, do: assert(stats.disk_size > 0)
    end

    @tag shape_db_opts: [enable_stats?: false]
    test "returns empty values if not enabled", ctx do
      assert {:ok, %{total_memory: 0, disk_size: 0}} = Statistics.current(ctx.stack_id)
    end
  end

  describe "recovery" do
    test "resets state when db file is corrupted", ctx do
      {:ok, path} = Sqlite.Connection.db_path(storage_dir: ctx.tmp_dir)
      assert {:ok, 0} = Sqlite.count_shapes(ctx.stack_id)

      stop_supervised!(ctx.shape_db)

      File.write!(path, "invalid!")

      assert {:ok, _pid} =
               start_supervised(
                 {Sqlite.Supervisor,
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
      {:ok, path} = Sqlite.Connection.db_path(storage_dir: ctx.tmp_dir)
      assert {:ok, 0} = Sqlite.count_shapes(ctx.stack_id)

      stop_supervised!(ctx.shape_db)

      File.write!(path, "invalid!")

      assert {:ok, _pid} =
               start_supervised(
                 {Sqlite.Supervisor,
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

  describe "error handling" do
    test "errors raised within transaction do not cause errors attempting to rollback", ctx do
      assert_raise RuntimeError, "source error", fn ->
        Sqlite.Connection.checkout_write!(ctx.stack_id, :raising, fn %{conn: conn} ->
          # commit the txn so that attempting to rollback after the exception
          # will return an error
          :ok = Sqlite.Connection.execute(conn, "COMMIT")
          raise RuntimeError, "source error"
        end)
      end
    end
  end

  defp make_shape_with_snapshot_status(%{stack_id: stack_id}, shape, handle, opts) do
    snapshot_complete? = Keyword.get(opts, :snapshot_complete, false)

    {:ok, _hash} = Sqlite.add_shape(stack_id, shape, handle)

    if snapshot_complete?,
      do: :ok = Sqlite.mark_snapshot_complete(stack_id, handle)

    {handle, shape}
  end
end
