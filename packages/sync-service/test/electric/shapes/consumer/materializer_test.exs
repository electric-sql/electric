defmodule Electric.Shapes.Consumer.MaterializerTest do
  use ExUnit.Case, async: true
  import Support.ComponentSetup
  use Repatch.ExUnit

  alias Electric.LogItems
  alias Electric.Replication.Changes
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.ConsumerRegistry
  alias Electric.Shapes.Consumer.Materializer

  setup [:with_stack_id_from_test, :with_in_memory_storage, :with_consumer_registry]

  setup %{storage: storage, stack_id: stack_id} = ctx do
    ConsumerRegistry.register_consumer(self(), "test", stack_id)

    Storage.for_shape("test", storage) |> Storage.start_link()
    Storage.for_shape("test", storage) |> Storage.mark_snapshot_as_started()

    snapshot_data =
      Map.get(ctx, :snapshot_data, [])
      |> case do
        [] -> []
        [x | _] = items when is_map(x) -> make_snapshot_data(items)
        [x | _] = items when is_binary(x) -> items
        {items, opts} -> make_snapshot_data(items, opts)
      end

    Storage.for_shape("test", storage)
    |> then(&Storage.make_new_snapshot!(snapshot_data, &1))

    {:ok, shape_handle: "test"}
  end

  test "can get ready",
       %{storage: storage, stack_id: stack_id, shape_handle: shape_handle} = ctx do
    {:ok, _pid} =
      Materializer.start_link(%{
        stack_id: stack_id,
        shape_handle: shape_handle,
        storage: storage,
        columns: ["value"],
        materialized_type: {:array, :int8}
      })

    respond_to_call(:await_snapshot_start, :started)
    respond_to_call(:subscribe_materializer, :ok)

    assert Materializer.wait_until_ready(ctx) == :ok
  end

  test "new changes are materialized correctly",
       %{storage: storage, stack_id: stack_id, shape_handle: shape_handle} = ctx do
    {:ok, _pid} =
      Materializer.start_link(%{
        stack_id: stack_id,
        shape_handle: shape_handle,
        storage: storage,
        columns: ["value"],
        materialized_type: {:array, :int8}
      })

    respond_to_call(:await_snapshot_start, :started)
    respond_to_call(:subscribe_materializer, :ok)

    assert Materializer.wait_until_ready(ctx) == :ok

    Materializer.new_changes(ctx, [
      %Changes.NewRecord{key: "1", record: %{"value" => "1"}},
      %Changes.NewRecord{key: "2", record: %{"value" => "2"}},
      %Changes.NewRecord{key: "3", record: %{"value" => "3"}}
    ])

    assert Materializer.get_link_values(ctx) == MapSet.new([1, 2, 3])
  end

  describe "materializing non-pk selected columns" do
    test "runtime insert of a new value is seen & causes a move-in", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(ctx, [
        %Changes.NewRecord{key: "1", record: %{"value" => "1"}}
      ])

      assert Materializer.get_link_values(ctx) == MapSet.new([1])

      assert_receive {:materializer_changes, _, %{move_in: ["1"]}}
    end

    @tag snapshot_data: [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}]
    test "on-load insert of a new value is seen & does not cause a move-in", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}]
    test "runtime update of a value is seen & causes a move-out & move-in", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(
        ctx,
        [
          %Changes.UpdatedRecord{
            record: %{"id" => "1", "value" => "11"},
            old_record: %{"id" => "1", "value" => "10"}
          }
        ]
        |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([11])

      assert_receive {:materializer_changes, _, %{move_out: ["10"], move_in: ["11"]}}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}},
           Changes.UpdatedRecord.new(
             record: %{"id" => "1", "value" => "11"},
             old_record: %{"id" => "1", "value" => "10"}
           )
         ]
    test "on-load update of a value is seen & does not cause events", ctx do
      ctx = with_materializer(ctx)
      assert Materializer.get_link_values(ctx) == MapSet.new([11])
      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}]
    test "runtime delete of a value is seen & causes a move-out", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(
        ctx,
        [%Changes.DeletedRecord{old_record: %{"id" => "1", "value" => "10"}}] |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([])

      assert_receive {:materializer_changes, _, %{move_out: ["10"]}}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}},
           %Changes.DeletedRecord{old_record: %{"id" => "1", "value" => "10"}}
         ]
    test "on-load delete of a value is seen & does not cause events", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([])

      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}]
    test "insert of a value that's already present in the shape does not cause events", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(
        ctx,
        [%Changes.NewRecord{record: %{"id" => "2", "value" => "10"}}] |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}},
           %Changes.NewRecord{record: %{"id" => "2", "value" => "20"}}
         ]
    test "update of a value to a present value causes just a move-out", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10, 20])

      Materializer.new_changes(
        ctx,
        [
          %Changes.UpdatedRecord{
            record: %{"id" => "1", "value" => "20"},
            old_record: %{"id" => "1", "value" => "10"}
          }
        ]
        |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([20])

      assert_received {:materializer_changes, _, %{move_out: ["10"]}}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}},
           %Changes.NewRecord{record: %{"id" => "2", "value" => "10"}}
         ]
    test "update of a value to a non-present value causes a move-in", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      Materializer.new_changes(
        ctx,
        [
          %Changes.UpdatedRecord{
            record: %{"id" => "1", "value" => "20"},
            old_record: %{"id" => "1", "value" => "10"}
          }
        ]
        |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([10, 20])

      assert_received {:materializer_changes, _, %{move_in: ["20"]}}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}},
           %Changes.NewRecord{record: %{"id" => "2", "value" => "20"}},
           %Changes.NewRecord{record: %{"id" => "3", "value" => "10"}}
         ]
    test "update between otherwise present values causes no events", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10, 20])

      Materializer.new_changes(
        ctx,
        [
          %Changes.UpdatedRecord{
            record: %{"id" => "1", "value" => "20"},
            old_record: %{"id" => "1", "value" => "10"}
          }
        ]
        |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([10, 20])

      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}},
           %Changes.NewRecord{record: %{"id" => "2", "value" => "10"}}
         ]
    test "delete of an otherwise present value causes no events", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(
        ctx,
        [%Changes.DeletedRecord{old_record: %{"id" => "1", "value" => "10"}}] |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}},
           %Changes.NewRecord{record: %{"id" => "2", "value" => "10"}}
         ]
    test "insert of an otherwise present value causes no events", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(
        ctx,
        [%Changes.NewRecord{record: %{"id" => "3", "value" => "10"}}] |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}
         ]
    test "insert of a PK we've already seen raises", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      pid = GenServer.whereis(Materializer.name(ctx))
      Process.unlink(pid)

      try do
        Materializer.new_changes(
          ctx,
          [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}] |> prep_changes()
        )
      catch
        :exit, {{reason, _}, _} ->
          assert reason.message =~ ~r/Key .* already exists/
      end
    end

    test "delete of a PK we've not seen throws an error", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([])

      pid = GenServer.whereis(Materializer.name(ctx))
      Process.unlink(pid)

      try do
        Materializer.new_changes(
          ctx,
          [%Changes.DeletedRecord{old_record: %{"id" => "1", "value" => "10"}}] |> prep_changes()
        )
      catch
        :exit, {{reason, _}, _} ->
          assert %KeyError{key: _} = reason
      end
    end

    test "moves are correctly tracked across multiple calls", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(ctx, [
        %Changes.NewRecord{key: "1", record: %{"value" => "1"}},
        %Changes.NewRecord{key: "2", record: %{"value" => "2"}},
        %Changes.NewRecord{key: "3", record: %{"value" => "1"}}
      ])

      assert Materializer.get_link_values(ctx) == MapSet.new([1, 2])

      assert_receive {:materializer_changes, _, %{move_in: ["2", "1"]}}

      Materializer.new_changes(ctx, [
        %Changes.UpdatedRecord{
          key: "2",
          record: %{"value" => "3"},
          old_record: %{"value" => "2"}
        },
        %Changes.DeletedRecord{key: "3", old_record: %{"value" => "1"}},
        %Changes.UpdatedRecord{key: "1", record: %{"other" => "1"}, old_record: %{"other" => "0"}}
      ])

      assert Materializer.get_link_values(ctx) == MapSet.new([1, 3])

      assert_receive {:materializer_changes, _, %{move_out: ["2"], move_in: ["3"]}}
    end
  end

  defp respond_to_call(request, response) do
    receive do
      {:"$gen_call", {from, ref}, {^request, _arg}} ->
        send(from, {ref, response})

      {:"$gen_call", {from, ref}, ^request} ->
        send(from, {ref, response})
    end
  end

  defp with_materializer(ctx, opts \\ []) do
    {:ok, _pid} =
      Materializer.start_link(%{
        stack_id: ctx.stack_id,
        shape_handle: ctx.shape_handle,
        storage: ctx.storage,
        columns: Keyword.get(opts, :columns, ["value"]),
        materialized_type: Keyword.get(opts, :materialized_type, {:array, :int8})
      })

    respond_to_call(:await_snapshot_start, :started)
    respond_to_call(:subscribe_materializer, :ok)

    assert Materializer.wait_until_ready(ctx) == :ok
    Materializer.subscribe(ctx)

    ctx
  end

  defp make_snapshot_data(changes, opts \\ []) do
    pk_cols = Keyword.get(opts, :pk_cols, ["id"])

    changes
    |> prep_changes(opts)
    |> Enum.flat_map(&LogItems.from_change(&1, 1, pk_cols, :default))
    |> Enum.map(fn {_offset, item} -> Jason.encode!(item) end)
  end

  defp prep_changes(changes, opts \\ []) do
    pk_cols = Keyword.get(opts, :pk_cols, ["id"])
    relation = Keyword.get(opts, :relation, {"public", "test_table"})

    changes
    |> Enum.map(&Map.put(&1, :relation, relation))
    |> Enum.map(&Map.put(&1, :log_offset, Electric.Replication.LogOffset.first()))
    |> Enum.map(&Changes.fill_key(&1, pk_cols))
  end
end
