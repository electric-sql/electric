defmodule Electric.ShapeCache.ShapeStatusTest do
  use ExUnit.Case, async: true
  use Support.Mock

  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes.Shape

  import Mox

  setup :verify_on_exit!

  @inspector {__MODULE__, []}

  defp shape!, do: shape!("test")

  defp shape!(val) do
    where = "value = '#{val}'"

    assert {:ok, %Shape{where: %{query: ^where}} = shape} =
             Shape.new("other_table", inspector: {__MODULE__, []}, where: where)

    shape
  end

  defp shape2! do
    assert {:ok, %Shape{where: nil} = shape} =
             Shape.new("public.table", inspector: {__MODULE__, []})

    shape
  end

  defp table_name,
    do: :"#{__MODULE__}-#{System.unique_integer([:positive, :monotonic])}"

  defp last_used_table_name(meta_table),
    do: String.to_atom(Atom.to_string(meta_table) <> ":last_used")

  defp shape_status_opts(opts) do
    meta_table = Keyword.get_lazy(opts, :table, fn -> table_name() end)

    %{
      storage: {Mock.Storage, []},
      shape_meta_table: meta_table,
      shape_last_used_table: last_used_table_name(meta_table)
    }
  end

  defp delete_tables(meta_table) do
    :ets.delete(meta_table)
    :ets.delete(last_used_table_name(meta_table))
  end

  defp new_state(_ctx, opts \\ []) do
    Mock.Storage
    |> stub(:metadata_backup_dir, fn _ -> nil end)
    |> expect(:get_all_stored_shapes, 1, fn _ -> {:ok, Access.get(opts, :stored_shapes, %{})} end)

    state = shape_status_opts(opts)

    :ok = ShapeStatus.initialize_from_storage(state, state.storage)

    shapes = Keyword.get(opts, :shapes, [])

    shape_handles =
      for shape <- shapes do
        {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
        shape_handle
      end

    {:ok, state, shape_handles}
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
          shape_handle => {shape, true}
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

  test "get_shape_by_handle/2", ctx do
    shape = shape!()
    table = table_name()
    {:ok, _state, [shape_handle]} = new_state(ctx, table: table, shapes: [shape])

    assert {:ok, ^shape} = ShapeStatus.get_shape_by_handle(table, shape_handle)
    assert {:error, _msg} = ShapeStatus.get_shape_by_handle(table, "not-my-handle")
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

  describe "list_shapes/2" do
    test "returns shapes with dependencies in a topological order", ctx do
      {:ok, state, []} = new_state(ctx)

      outer =
        %{shape_dependencies: [inner]} =
        Shape.new!("public.table",
          where: "id IN (SELECT id FROM other_table)",
          inspector: @inspector
        )

      {:ok, shape2} = ShapeStatus.add_shape(state, outer)
      {:ok, shape1} = ShapeStatus.add_shape(state, inner)

      assert [{^shape1, _}, {^shape2, _}] = ShapeStatus.list_shapes(state)
    end
  end

  describe "least_recently_used/2" do
    test "returns the shape that was least recently updated", ctx do
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

      state = shape_status_opts(table: table)

      assert :ok = ShapeStatus.initialize_from_storage(state, state.storage)
      shape = shape!()
      assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
      assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)

      # Persist backup
      assert :ok = ShapeStatus.terminate(state, ShapeStatus.backup_dir(state.storage))

      backup_file =
        Path.join([backup_base_dir, "shape_status_backups", "shape_status_v1.ets.backup"])

      assert File.exists?(backup_file)

      # Simulate restart: remove ETS table (would be removed with process exit in real system)
      delete_tables(table)

      # Second lifecycle: should load from backup (so must NOT call get_all_stored_shapes)
      Mock.Storage
      |> stub(:metadata_backup_dir, fn _ -> backup_base_dir end)
      |> stub(:get_all_stored_shapes, fn _ ->
        flunk("get_all_stored_shapes should not be called when backup exists")
      end)
      |> expect(:get_all_stored_shape_handles, 1, fn _ -> {:ok, MapSet.new([shape_handle])} end)

      state2 = shape_status_opts(table: table)

      assert :ok = ShapeStatus.initialize_from_storage(state2, state2.storage)
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

      state = shape_status_opts(table: table)

      assert :ok = ShapeStatus.initialize_from_storage(state, state.storage)
      shape = shape!()
      assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
      assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)
      assert :ok = ShapeStatus.terminate(state, ShapeStatus.backup_dir(state.storage))

      backup_file =
        Path.join([backup_base_dir, "shape_status_backups", "shape_status_v1.ets.backup"])

      assert File.exists?(backup_file)

      delete_tables(table)

      # Second lifecycle: integrity check fails because storage reports NO handles
      Mock.Storage
      |> stub(:metadata_backup_dir, fn _ -> backup_base_dir end)
      |> expect(:get_all_stored_shape_handles, 1, fn _ -> {:ok, MapSet.new()} end)
      # After integrity failure, initialise will call load/1 -> get_all_stored_shapes
      |> expect(:get_all_stored_shapes, 1, fn _ -> {:ok, %{}} end)

      state2 = shape_status_opts(table: table)

      assert :ok = ShapeStatus.initialize_from_storage(state2, state2.storage)
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

  def load_supported_features(_), do: {:ok, %{supports_generated_column_replication: true}}
end
