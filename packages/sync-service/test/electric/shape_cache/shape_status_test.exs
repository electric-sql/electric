defmodule Electric.ShapeCache.ShapeStatusTest do
  use ExUnit.Case, async: true
  use Support.Mock

  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes.Shape

  import Mox

  setup :verify_on_exit!

  defp shape! do
    assert {:ok, %Shape{where: %{query: "value = 'test'"}} = shape} =
             Shape.new("other_table", inspector: {__MODULE__, []}, where: "value = 'test'")

    shape
  end

  defp shape2! do
    assert {:ok, %Shape{where: nil} = shape} =
             Shape.new("public.table", inspector: {__MODULE__, []})

    shape
  end

  defp shape!(where) do
    assert {:ok, %Shape{where: %{query: ^where}} = shape} =
             Shape.new("other_table", inspector: {__MODULE__, []}, where: where)

    shape
  end

  defp table_name,
    do: :"#{__MODULE__}-#{System.unique_integer([:positive, :monotonic])}"

  defp new_state(_ctx, opts \\ []) do
    table = Keyword.get(opts, :table, table_name())

    Mock.Storage
    |> stub(:metadata_backup_dir, fn _ -> nil end)
    |> expect(:get_all_stored_shapes, 1, fn _ -> {:ok, Access.get(opts, :stored_shapes, %{})} end)

    shape_status_opts =
      ShapeStatus.opts(
        storage: {Mock.Storage, []},
        shape_meta_table: table
      )

    :ok = ShapeStatus.initialise(shape_status_opts)

    shapes = Keyword.get(opts, :shapes, [])

    shape_handles =
      for shape <- shapes do
        {:ok, shape_handle} = ShapeStatus.add_shape(shape_status_opts, shape)
        shape_handle
      end

    {:ok, shape_status_opts, shape_handles}
  end

  test "starts empty", ctx do
    {:ok, state, []} = new_state(ctx)
    assert [] = ShapeStatus.list_shapes(state)
  end

  test "can recover shapes from storage", ctx do
    {:ok, state, []} = new_state(ctx)
    shape = shape!()
    assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
    assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)

    {:ok, state, []} =
      new_state(ctx,
        stored_shapes: %{
          shape_handle => shape
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

  @timeout 120_000
  @tag timeout: @timeout
  test "delete lots of shapes", ctx do
    methods = [
      %{
        name: "one by one",
        fun: fn shape_handles, state ->
          for shape_handle <- shape_handles do
            assert {:ok, _shape} = ShapeStatus.remove_shape(state, shape_handle)
          end
        end
      },
      %{
        name: "batch delete",
        fun: fn shape_handles, state ->
          assert :ok = ShapeStatus.remove_shapes(state, shape_handles)
        end
      },
      %{
        name: "batch delete with lookup",
        fun: fn shape_handles, state ->
          assert :ok = ShapeStatus.remove_shapes_with_lookup(state, shape_handles)
        end
      }
    ]

    for method <- methods do
      {:ok, state, []} = new_state(ctx)
      shape_count = 30_000
      delete_count = 1000

      shape_handles =
        for i <- 1..shape_count do
          shape = shape!("#{i} = #{i}")
          assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
          shape_handle
        end

      read_tasks =
        for _ <- 1..10 do
          Task.async(fn ->
            Enum.map(1..1000, fn _ ->
              {μs, _} =
                :timer.tc(fn ->
                  ShapeStatus.get_existing_shape(state, Enum.random(shape_handles))
                end)

              μs
            end)
          end)
        end

      create_tasks =
        for j <- 1..5 do
          Task.async(fn ->
            Enum.map(1..100, fn i ->
              shape = shape!("#{shape_count + j * 100 + i} = #{shape_count + j * 100 + i}")
              {μs, _} = :timer.tc(fn -> ShapeStatus.add_shape(state, shape) end)
              μs
            end)
          end)
        end

      to_delete = shape_handles |> Enum.take_random(delete_count)

      {μs, _} = :timer.tc(fn -> method.fun.(to_delete, state) end)

      max_create_time = Task.await_many(create_tasks) |> Enum.concat() |> Enum.max()

      assert shape_count - delete_count + 500 == length(ShapeStatus.list_shapes(state))

      read_times =
        Task.await_many(read_tasks)
        |> Enum.concat()

      max_read_time = Enum.max(read_times)
      avg_read_time = Enum.sum(read_times) / length(read_times)

      IO.puts("""
      #{method.name}:
        Deleted #{length(to_delete)} shapes in #{μs / 1_000} ms
        Max read time during delete: #{max_read_time / 1_000} ms
        Avg read time during delete: #{avg_read_time / 1_000} ms
        Max create time during delete: #{max_create_time / 1_000} ms
      """)
    end
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

  test "get_existing_shape/2 with shape_handle", ctx do
    shape = shape!()
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape])

    refute ShapeStatus.get_existing_shape(state, "1234")

    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(state, shape)
    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(state, shape_handle)

    assert {:ok, ^shape} = ShapeStatus.remove_shape(state, shape_handle)
    refute ShapeStatus.get_existing_shape(state, shape)
    refute ShapeStatus.get_existing_shape(state, shape_handle)
  end

  test "get_existing_shape/2 public api", ctx do
    shape = shape!()
    table = table_name()

    {:ok, state, [shape_handle]} = new_state(ctx, table: table, shapes: [shape])

    refute ShapeStatus.get_existing_shape(table, "1234")

    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(table, shape)
    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(table, shape_handle)

    assert {:ok, ^shape} = ShapeStatus.remove_shape(state, shape_handle)
    refute ShapeStatus.get_existing_shape(table, shape)
    refute ShapeStatus.get_existing_shape(table, shape_handle)
  end

  test "latest_offset", ctx do
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])
    assert :error = ShapeStatus.latest_offset(state, "sdfsodf")

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
    table_name = table_name()
    {:ok, _state, [shape_handle]} = new_state(ctx, table: table_name, shapes: [shape!()])
    assert :error = ShapeStatus.latest_offset(table_name, "sdfsodf")

    assert ShapeStatus.latest_offset(table_name, shape_handle) ==
             {:ok, LogOffset.last_before_real_offsets()}

    offset = LogOffset.new(100, 3)

    assert ShapeStatus.set_latest_offset(table_name, "not my shape", offset)

    assert ShapeStatus.set_latest_offset(table_name, shape_handle, offset)
    assert ShapeStatus.latest_offset(table_name, shape_handle) == {:ok, offset}
  end

  test "initialise_shape/4", ctx do
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])
    offset = LogOffset.new(100, 3)
    assert :ok = ShapeStatus.initialise_shape(state, shape_handle, 1234, offset)
    assert ShapeStatus.latest_offset(state, shape_handle) == {:ok, offset}
    assert ShapeStatus.snapshot_xmin(state, shape_handle) == {:ok, 1234}
  end

  test "snapshot_xmin/2", ctx do
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])

    # set_snapshot_xmin for an unknown shape silently does nothing
    # this is because real-world race conditions mean that we may
    # still receive updates on a shape that is in the process of
    # being deleted
    assert ShapeStatus.set_snapshot_xmin(state, "sdfsodf", 1234)

    assert :error = ShapeStatus.snapshot_xmin(state, "sdfsodf")
    assert {:ok, nil} == ShapeStatus.snapshot_xmin(state, shape_handle)
    assert ShapeStatus.set_snapshot_xmin(state, shape_handle, 1234)
    assert {:ok, 1234} == ShapeStatus.snapshot_xmin(state, shape_handle)
  end

  test "snapshot_started?/2", ctx do
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])

    refute ShapeStatus.snapshot_started?(state, "sdfsodf")
    refute ShapeStatus.snapshot_started?(state.shape_meta_table, "sdfsodf")
    refute ShapeStatus.snapshot_started?(state, shape_handle)

    ShapeStatus.mark_snapshot_started(state, shape_handle)

    assert ShapeStatus.snapshot_started?(state, shape_handle)
    assert ShapeStatus.snapshot_started?(state.shape_meta_table, shape_handle)
  end

  describe "least_recently_used/2" do
    test "returns last shape update_last_read_time_to_now was called on", ctx do
      {:ok, state, []} = new_state(ctx)
      {:ok, shape1} = ShapeStatus.add_shape(state, shape!())
      {:ok, shape2} = ShapeStatus.add_shape(state, shape2!())
      ShapeStatus.update_last_read_time_to_now(state, shape2)
      Process.sleep(10)
      ShapeStatus.update_last_read_time_to_now(state, shape1)

      assert [%{shape_handle: ^shape2}] = ShapeStatus.least_recently_used(state, _count = 1)
    end

    test "returns shape first created if update_last_read_time_to_now has not been called", ctx do
      {:ok, state, []} = new_state(ctx)
      {:ok, shape1} = ShapeStatus.add_shape(state, shape!())
      {:ok, _shape2} = ShapeStatus.add_shape(state, shape2!())

      assert [%{shape_handle: ^shape1}] = ShapeStatus.least_recently_used(state, _count = 1)
    end

    test "returns empty list if no shapes have been added", ctx do
      {:ok, state, []} = new_state(ctx)

      assert [] == ShapeStatus.least_recently_used(state, _count = 1)
    end

    test "returns empty list if all shapes have been deleted", ctx do
      {:ok, state, []} = new_state(ctx)
      {:ok, shape1} = ShapeStatus.add_shape(state, shape!())
      {:ok, shape2} = ShapeStatus.add_shape(state, shape2!())
      ShapeStatus.remove_shape(state, shape1)
      ShapeStatus.remove_shape(state, shape2)

      assert [] == ShapeStatus.least_recently_used(state, _count = 1)
    end
  end

  describe "shape storage and backup" do
    test "can set and consume shape storage state", ctx do
      {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])

      assert :ok = ShapeStatus.set_shape_storage_state(state, shape_handle, %{foo: :bar})
      assert %{foo: :bar} = ShapeStatus.consume_shape_storage_state(state, shape_handle)
      # entry is deleted after consumption
      assert nil == ShapeStatus.consume_shape_storage_state(state, shape_handle)

      # unknown shape returns nil
      assert nil == ShapeStatus.consume_shape_storage_state(state, "missing")
    end

    test "removing shape clears stored shape storage state", ctx do
      {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])
      assert :ok = ShapeStatus.set_shape_storage_state(state, shape_handle, :some_state)
      assert {:ok, _shape} = ShapeStatus.remove_shape(state, shape_handle)
      # cleanup removes backup entry so nothing to consume
      assert nil == ShapeStatus.consume_shape_storage_state(state, shape_handle)
    end

    test "terminate stores backup and initialise loads from backup instead of storage", _ctx do
      backup_base_dir =
        Path.join(System.tmp_dir!(), "shape_status_test_#{System.unique_integer([:positive])}")

      table = table_name()

      # First lifecycle: no shapes in storage, start empty, add a shape, terminate to create backup
      Mock.Storage
      |> stub(:metadata_backup_dir, fn _ -> backup_base_dir end)
      |> expect(:get_all_stored_shapes, 1, fn _ -> {:ok, %{}} end)
      |> stub(:get_all_stored_shape_handles, fn _ -> {:ok, MapSet.new()} end)

      state =
        ShapeStatus.opts(
          storage: {Mock.Storage, []},
          shape_meta_table: table
        )

      assert :ok = ShapeStatus.initialise(state)
      shape = shape!()
      assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
      assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)

      # Persist backup
      assert :ok = ShapeStatus.terminate(state)

      backup_file =
        Path.join([backup_base_dir, "shape_status_backups", "shape_status_v1.ets.backup"])

      assert File.exists?(backup_file)

      # Simulate restart: remove ETS table (would be removed with process exit in real system)
      :ets.delete(table)

      # Second lifecycle: should load from backup (so must NOT call get_all_stored_shapes)
      Mock.Storage
      |> stub(:metadata_backup_dir, fn _ -> backup_base_dir end)
      |> stub(:get_all_stored_shapes, fn _ ->
        flunk("get_all_stored_shapes should not be called when backup exists")
      end)
      |> expect(:get_all_stored_shape_handles, 1, fn _ -> {:ok, MapSet.new([shape_handle])} end)

      state2 =
        ShapeStatus.opts(
          storage: {Mock.Storage, []},
          shape_meta_table: table
        )

      assert :ok = ShapeStatus.initialise(state2)
      assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state2)
      # consuming backup directory should have removed it after load
      refute File.exists?(backup_file)
    end

    test "backup restore aborted on storage integrity failure", _ctx do
      backup_base_dir =
        Path.join(System.tmp_dir!(), "shape_status_test_#{System.unique_integer([:positive])}")

      table = table_name()

      # First lifecycle: create backup containing one shape
      Mock.Storage
      |> stub(:metadata_backup_dir, fn _ -> backup_base_dir end)
      |> expect(:get_all_stored_shapes, 1, fn _ -> {:ok, %{}} end)
      |> stub(:get_all_stored_shape_handles, fn _ -> {:ok, MapSet.new()} end)

      state =
        ShapeStatus.opts(
          storage: {Mock.Storage, []},
          shape_meta_table: table
        )

      assert :ok = ShapeStatus.initialise(state)
      shape = shape!()
      assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
      assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)
      assert :ok = ShapeStatus.terminate(state)

      backup_file =
        Path.join([backup_base_dir, "shape_status_backups", "shape_status_v1.ets.backup"])

      assert File.exists?(backup_file)

      :ets.delete(table)

      # Second lifecycle: integrity check fails because storage reports NO handles
      Mock.Storage
      |> stub(:metadata_backup_dir, fn _ -> backup_base_dir end)
      |> expect(:get_all_stored_shape_handles, 1, fn _ -> {:ok, MapSet.new()} end)
      # After integrity failure, initialise will call load/1 -> get_all_stored_shapes
      |> expect(:get_all_stored_shapes, 1, fn _ -> {:ok, %{}} end)

      state2 =
        ShapeStatus.opts(
          storage: {Mock.Storage, []},
          shape_meta_table: table
        )

      assert :ok = ShapeStatus.initialise(state2)
      # Shape from backup should NOT be present after failed integrity
      assert [] == ShapeStatus.list_shapes(state2)
      refute File.exists?(backup_file)
    end
  end

  def load_column_info(1338, _),
    do:
      {:ok,
       [
         %{name: "id", type: :int8, type_id: {1, 1}, pk_position: 0, is_generated: false},
         %{name: "value", type: :text, type_id: {2, 2}, pk_position: nil, is_generated: false}
       ]}

  def load_column_info(1337, _),
    do: {:ok, [%{name: "id", type: :int8, type_id: {1, 1}, pk_position: 0, is_generated: false}]}

  def load_relation_oid({"public", "table"}, _), do: {:ok, {1337, {"public", "table"}}}

  def load_relation_oid({"public", "other_table"}, _),
    do: {:ok, {1338, {"public", "other_table"}}}
end
